#!/usr/bin/env node
// laurent.martin.aspera@fr.ibm.com
// cspell:ignore transferd trapi oneofs Mbps

import fs from 'fs';
import path from 'path';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { spawn } from 'child_process';
import { logger, logDump } from './configuration.js';

const ASCP_LOG_FILE = "aspera-scp-transfer.log";
// default port of transferd if not specified in URL
const TRANSFERD_DEFAULT_PORT = 55002;
// max wait time for the daemon to write its port file
const STARTUP_TIMEOUT_MS = 10000;
// max wait time for the connection to the daemon
const CONNECT_TIMEOUT_MS = 5000;
// max wait time for the daemon to stop gracefully
const SHUTDOWN_TIMEOUT_MS = 10000;
// extension of the port file, written in `runtime_dir` with port 0: `transferd.<port>.optport`
const PORT_FILE_EXTENSION = '.optport';

/**
 * Client of the Aspera Transfer Daemon (transferd): start the daemon, start transfers and wait for their end.
 *
 * Methods return promises: errors are raised as rejections.
 */
export class TransferClient {
	/**
	 * Create a transfer client.
	 * @param {import('./configuration.js').Configuration} config configuration of the samples
	 */
	constructor(config) {
		this.config = config;
		const SDK_URL = new URL(this.config.getParam('trsdk', 'url'));
		this.serverAddress = SDK_URL.hostname;
		this.serverPort = SDK_URL.port === '' ? TRANSFERD_DEFAULT_PORT : parseInt(SDK_URL.port, 10);
		this.transferDaemonProcess = null;
		// resolved when the daemon process has exited
		this.daemonExited = null;
		// error when the daemon exited unexpectedly
		this.daemonError = null;
		// true when daemon exit is expected
		this.stopping = false;
		// called with an error if the daemon exits during a transfer
		this.abortTransfer = null;
		this.transferService = null;
		this.daemonName = path.basename(config.getPath("sdk_daemon"));
		// folder of the configuration, output and logs of the daemon: a new one for each start
		this.daemonFolder = null;
		this.daemonLog = null;
		// `runtime_dir` of the daemon, where it writes its port file: only with port 0
		this.runtimeDir = null;
	}

	/**
	 * Start the daemon and connect to it, if not already done.
	 * On failure, the daemon is stopped.
	 * @returns {Promise<void>}
	 */
	async startup() {
		if (this.transferService) return;
		try {
			await this.startDaemon();
			await this.connectToDaemon();
		} catch (error) {
			// do not leave the daemon running
			await this.shutdown();
			throw error;
		}
	}

	/**
	 * Start the daemon, with its configuration, output and logs in a new folder of the log folder.
	 * @returns {Promise<void>}
	 */
	async startDaemon() {
		// samples run at the same time do not share files
		this.daemonFolder = fs.mkdtempSync(path.resolve(this.config.logFolder, `${this.daemonName}.`));
		const ASCP_LOG = path.resolve(this.daemonFolder, ASCP_LOG_FILE);
		const FILE_BASE = path.resolve(this.daemonFolder, this.daemonName);
		const DAEMON_CONF_FILE = `${FILE_BASE}.conf`;
		const outFile = `${FILE_BASE}.out`;
		const errFile = `${FILE_BASE}.err`;
		this.daemonLog = `${FILE_BASE}.log`;
		if (this.serverPort === 0) {
			// the daemon writes its port file in this folder: of this daemon only, readable only by the user
			this.runtimeDir = path.resolve(this.daemonFolder, 'run');
			fs.mkdirSync(this.runtimeDir, { mode: 0o700 });
		}
		const DAEMON_EXE = this.config.getPath('sdk_daemon');
		const args = ['--config', DAEMON_CONF_FILE];
		logDump('Daemon command', `${DAEMON_EXE} ${args.join(' ')}`);
		logDump('Daemon out', outFile);
		logDump('Daemon err', errFile);
		logDump('Daemon log', this.daemonLog);
		logDump('Ascp log', ASCP_LOG);
		this.createConfigFile(DAEMON_CONF_FILE);
		logger.info('Starting daemon');
		this.stopping = false;
		this.daemonError = null;
		const outFd = fs.openSync(outFile, 'w');
		const errFd = fs.openSync(errFile, 'w');
		const daemon = spawn(DAEMON_EXE, args, {
			stdio: ['ignore', outFd, errFd],
		});
		// the child process has its own copy of the file descriptors
		fs.closeSync(outFd);
		fs.closeSync(errFd);
		this.transferDaemonProcess = daemon;
		this.daemonExited = new Promise((resolve) => {
			// `exit` is not emitted if the process could not be started
			daemon.on('error', (error) => {
				this.daemonFailed(`Failed to start daemon: ${error.message}`);
				resolve();
			});
			daemon.on('exit', (code, signal) => {
				if (!this.stopping) this.daemonFailed(`Daemon exited with code ${code ?? signal}, see log: ${this.daemonLog}`);
				resolve();
			});
		});
		await this.waitDaemonListening();
	}

	/**
	 * Record an unexpected stop of the daemon, and abort the current transfer, if any.
	 * @param {string} message error message
	 */
	daemonFailed(message) {
		this.daemonError = new Error(message);
		this.abortTransfer?.(this.daemonError);
	}

	/**
	 * Wait for the daemon to listen, and get the port if dynamically allocated (port 0).
	 * With port 0, the daemon writes its port in a file of its `runtime_dir` once it listens.
	 * This requires transferd 1.1.7 or later.
	 * @returns {Promise<void>}
	 */
	async waitDaemonListening() {
		const deadline = Date.now() + STARTUP_TIMEOUT_MS;
		while (true) {
			if (this.daemonError) throw this.daemonError;
			// fixed port: readiness is checked on connection
			if (this.serverPort !== 0) return;
			const port = TransferClient.readPortFile(this.runtimeDir);
			if (port !== null) {
				this.serverPort = port;
				return;
			}
			if (Date.now() > deadline) throw new Error(`Port file not found in ${this.runtimeDir}: transferd 1.1.7 or later is required`);
			await new Promise(resolve => setTimeout(resolve, 200));
		}
	}

	/**
	 * Read the port of the daemon in its port file `transferd.<port>.optport`, in its `runtime_dir`.
	 * The daemon creates the file, then writes the port: an empty file is not ready yet.
	 * @param {string} runtimeDir `runtime_dir` of the daemon
	 * @returns {number|null} port, or none if not written (yet)
	 */
	static readPortFile(runtimeDir) {
		const portFiles = fs.readdirSync(runtimeDir)
			.filter((name) => name.endsWith(PORT_FILE_EXTENSION))
			.map((name) => path.join(runtimeDir, name));
		if (portFiles.length === 0) return null;
		if (portFiles.length > 1) throw new Error(`Several port files in ${runtimeDir}`);
		const content = fs.readFileSync(portFiles[0], 'utf8');
		if (content === '') return null;
		if (!/^[0-9]+$/.test(content)) throw new Error(`No port in file ${portFiles[0]}`);
		return parseInt(content, 10);
	}

	/**
	 * Convert the log level of ascp from name to number.
	 * @param {string} ascpLevel `info`, `debug` or `trace`
	 * @returns {number} 0, 1 or 2
	 */
	static getAscpLogLevel(ascpLevel) {
		switch (ascpLevel) {
			case 'info': return 0;
			case 'debug': return 1;
			case 'trace': return 2;
			default: throw new Error(`Invalid ascp_level: ${ascpLevel}`);
		}
	}

	/**
	 * Create the configuration file of the daemon.
	 * See: https://developer.ibm.com/apis/catalog/aspera--aspera-transfer-sdk/Configuration%20File
	 * @param {string} target_file path of the configuration file
	 */
	createConfigFile(target_file) {
		var daemonConf = {
			address: this.serverAddress,
			port: this.serverPort,
			log_directory: this.daemonFolder,
			log_level: this.config.getParam('trsdk', 'level'),
			fasp_runtime: {
				use_embedded: true,
				log: {
					dir: this.daemonFolder,
					level: TransferClient.getAscpLogLevel(this.config.getParam('trsdk', 'ascp_level')),
				},
			},
		};
		if (this.runtimeDir !== null) daemonConf.runtime_dir = this.runtimeDir;
		fs.writeFileSync(target_file, JSON.stringify(daemonConf));
	}

	/**
	 * Connect to the daemon.
	 * @returns {Promise<void>}
	 */
	connectToDaemon() {
		return new Promise((resolve, reject) => {
			const packageDefinition = protoLoader.loadSync(this.config.getPath('proto'), {
				keepCase: true,
				longs: String,
				enums: String,
				defaults: true,
				oneofs: true,
			});
			const trapi = grpc.loadPackageDefinition(packageDefinition).transferd.api;
			const address = `${this.serverAddress}:${this.serverPort}`;
			const transferService = new trapi.TransferService(address, grpc.credentials.createInsecure());
			transferService.waitForReady(Date.now() + CONNECT_TIMEOUT_MS, (error) => {
				if (error) {
					transferService.close();
					return reject(this.daemonError ?? new Error(`Failed to connect to daemon: ${address}`));
				}
				this.transferService = transferService;
				logger.info(`Connected to daemon: ${address}`);
				resolve();
			});
		});
	}

	/**
	 * Stop the daemon, if it was started: send SIGINT, and kill it if it does not stop in time.
	 * Then delete its `runtime_dir`: a killed daemon does not delete its port file.
	 * transferd stops cleanly on SIGINT (not on SIGTERM).
	 * Windows has no SIGINT for child processes: the process is terminated.
	 * @returns {Promise<void>}
	 */
	async shutdown() {
		this.stopping = true;
		this.transferService?.close();
		this.transferService = null;
		const daemon = this.transferDaemonProcess;
		this.transferDaemonProcess = null;
		if (daemon && daemon.exitCode === null && daemon.signalCode === null) {
			logger.info('Stopping daemon');
			// transferd stops cleanly on SIGINT (not on SIGTERM), kill it if it does not stop in time
			daemon.kill('SIGINT');
			const timer = setTimeout(() => {
				logger.warn('Daemon did not stop, killing it');
				daemon.kill('SIGKILL');
			}, SHUTDOWN_TIMEOUT_MS);
			await this.daemonExited;
			clearTimeout(timer);
		}
		await this.daemonExited;
		this.daemonExited = null;
		if (this.runtimeDir !== null) {
			fs.rmSync(this.runtimeDir, { recursive: true, force: true });
			this.runtimeDir = null;
		}
	}

	/**
	 * Start the daemon if needed, start a transfer, and wait for its end.
	 * @param {object} transferSpec transfer spec
	 * @returns {Promise<void>} resolved when the transfer is completed, rejected if it fails
	 */
	async startTransferAndWait(transferSpec) {
		await this.startup();
		const ts = JSON.stringify(transferSpec);
		logDump('Transfer spec', ts);

		const startTransferRequest = {
			transferType: 'FILE_REGULAR',
			transferSpec: ts,
		};

		return new Promise((resolve, reject) => {
			// start the transfer: the daemon sends an event on each change, until the end of the transfer
			// server streaming call: events and errors are received on the stream
			const eventStream = this.transferService.startTransferWithMonitor(startTransferRequest);
			let finished = false;
			const finish = (error) => {
				if (finished) return;
				finished = true;
				this.abortTransfer = null;
				// stop monitoring, if the stream is still open: the resulting `error` event (cancelled) is ignored
				eventStream.cancel();
				if (error) reject(error); else resolve();
			};
			// the daemon may exit during the transfer
			this.abortTransfer = finish;

			eventStream.on('data', (data) => {
				const rate = data.status === 'RUNNING' ? ` ${(Number(data.transferInfo?.averageRateKbps ?? 0) / 1000).toFixed(1)} Mbps` : '';
				logger.info(`Transfer: ${data.status}${rate}`);
				// `error` is empty on session errors: the cause is in session or transfer information
				const description = () => [data.error?.description, data.sessionInfo?.errorDesc, data.transferInfo?.errorDescription]
					.map((text) => text?.trim()).find(Boolean) ?? 'unknown error';
				if (['FAILED', 'CANCELED'].includes(data.status)) {
					finish(new Error(`Transfer failed: ${description()}`));
				} else if (data.status === 'UNKNOWN_STATUS') {
					finish(new Error(`Transfer status unknown: ${description()}`));
				} else if (data.status === 'COMPLETED') {
					finish();
				}
			});
			eventStream.on('error', (error) => finish(new Error(`Transfer monitoring failed: ${error.message}`)));
			eventStream.on('end', () => finish(new Error('Transfer monitoring ended before transfer completion')));
		});
	}

	/**
	 * Get the transfer spec from the response of Node API `upload_setup` or `download_setup`, and throw an exception on error.
	 *
	 * The Node API may return an error in the response data, or an empty object, instead of an HTTP error.
	 * @param {object|null} responseData response data, for a single transfer request
	 * @returns {object} transfer spec
	 */
	static transferSpecFromSetup(responseData) {
		const result = responseData?.transfer_specs?.[0] ?? {};
		const error = responseData?.error ?? result.error;
		if (error) {
			throw new Error(`Node API error: ${error.user_message}`);
		}
		if (!result.transfer_spec) {
			throw new Error('No transfer spec in Node API response');
		}
		return result.transfer_spec;
	}
}
