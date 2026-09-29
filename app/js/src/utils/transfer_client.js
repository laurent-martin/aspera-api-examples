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
// max wait time for the daemon to log its listening port
const STARTUP_TIMEOUT_MS = 10000;
// max wait time for the connection to the daemon
const CONNECT_TIMEOUT_MS = 5000;
// max wait time for the daemon to stop gracefully
const SHUTDOWN_TIMEOUT_MS = 10000;
// API port in daemon log (text or JSON log format), e.g. `API Server: Listening on 127.0.0.1:55002 ...`
const LISTENING_PORT_REGEX = /API Server: Listening on [^\s"]+:(\d+)/;

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
		this.daemonLog = path.resolve(this.config.logFolder, this.daemonName + ".log");
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
	 * Start the daemon, with output and logs in the log folder.
	 * @returns {Promise<void>}
	 */
	async startDaemon() {
		const ASCP_LOG = path.resolve(this.config.logFolder, ASCP_LOG_FILE);
		const FILE_BASE = path.resolve(this.config.logFolder, this.daemonName);
		const DAEMON_CONF_FILE = `${FILE_BASE}.conf`;
		const outFile = `${FILE_BASE}.out`;
		const errFile = `${FILE_BASE}.err`;
		const DAEMON_EXE = this.config.getPath('sdk_daemon');
		const args = ['--config', DAEMON_CONF_FILE];
		logDump('Daemon command', `${DAEMON_EXE} ${args.join(' ')}`);
		logDump('Daemon out', outFile);
		logDump('Daemon err', errFile);
		logDump('Daemon log', this.daemonLog);
		logDump('Ascp log', ASCP_LOG);
		this.createConfigFile(DAEMON_CONF_FILE);
		// the log file may contain lines of previous executions: only read new lines
		const logOffset = fs.existsSync(this.daemonLog) ? fs.statSync(this.daemonLog).size : 0;
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
		await this.waitDaemonListening(logOffset);
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
	 * The port is read from the daemon log: requires log level `info` or more verbose.
	 * @param {number} logOffset only read the daemon log after this offset
	 * @returns {Promise<void>}
	 */
	async waitDaemonListening(logOffset) {
		const deadline = Date.now() + STARTUP_TIMEOUT_MS;
		while (true) {
			if (this.daemonError) throw this.daemonError;
			// fixed port: readiness is checked on connection
			if (this.serverPort !== 0) return;
			const port = TransferClient.findListeningPort(this.daemonLog, logOffset);
			if (port !== null) {
				this.serverPort = port;
				return;
			}
			if (Date.now() > deadline) throw new Error(`Listening port not found in daemon log: ${this.daemonLog}`);
			await new Promise(resolve => setTimeout(resolve, 200));
		}
	}

	/**
	 * Find the API listening port in the daemon log, after the given offset.
	 * @param {string} logFile path of the daemon log
	 * @param {number} offset only read the daemon log after this offset
	 * @returns {number|null} port, or none if not found (yet)
	 */
	static findListeningPort(logFile, offset) {
		if (!fs.existsSync(logFile)) return null;
		const content = fs.readFileSync(logFile);
		// log file was truncated
		if (content.length < offset) offset = 0;
		const match = LISTENING_PORT_REGEX.exec(content.subarray(offset).toString('utf8'));
		return match ? parseInt(match[1], 10) : null;
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
			log_directory: this.config.logFolder,
			log_level: this.config.getParam('trsdk', 'level'),
			fasp_runtime: {
				use_embedded: true,
				log: {
					dir: this.config.logFolder,
					level: TransferClient.getAscpLogLevel(this.config.getParam('trsdk', 'ascp_level')),
				},
			},
		};
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
			// server streaming call: events and errors are received on the stream
			const eventStream = this.transferService.startTransferWithMonitor(startTransferRequest);
			let finished = false;
			const finish = (error) => {
				if (finished) return;
				finished = true;
				this.abortTransfer = null;
				// stop monitoring: the resulting `error` event (cancelled) is ignored
				eventStream.cancel();
				if (error) reject(error); else resolve();
			};
			// the daemon may exit during the transfer
			this.abortTransfer = finish;

			eventStream.on('data', (data) => {
				const rate = data.status === 'RUNNING' ? ` ${(Number(data.transferInfo?.averageRateKbps ?? 0) / 1000).toFixed(1)} Mbps` : '';
				logger.info(`Transfer: ${data.status}${rate}`);
				if (data.status === 'FAILED') {
					// `error` is empty on session errors: the cause is in transfer or session information
					const description = [data.error?.description, data.sessionInfo?.errorDesc, data.transferInfo?.errorDescription]
						.map((text) => text?.trim()).find(Boolean) ?? 'unknown error';
					finish(new Error(`Transfer failed: ${description}`));
				} else if (data.transferEvent === 'SESSION_STOP' && data.status === 'COMPLETED') {
					finish();
				}
			});
			eventStream.on('error', (error) => finish(new Error(`Transfer monitoring failed: ${error.message}`)));
			eventStream.on('end', () => finish(new Error('Transfer monitoring ended before transfer completion')));
		});
	}
}
