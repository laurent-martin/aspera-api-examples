#!/usr/bin/env node
// laurent.martin.aspera@fr.ibm.com
// cspell:ignore transferd trapi oneofs Mbps

import fs from 'fs';
import path from 'path';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { spawn } from 'child_process';
import { logger } from './configuration.js';

const ASCP_LOG_FILE = "aspera-scp-transfer.log";
// default port of transferd if not specified in URL
const TRANSFERD_DEFAULT_PORT = 55002;
// max wait time for the daemon to log its listening port
const STARTUP_TIMEOUT_MS = 10000;
// max wait time for the connection to the daemon
const CONNECT_TIMEOUT_MS = 5000;
// API port in daemon log (text or JSON log format), e.g. `API Server: Listening on 127.0.0.1:55002 ...`
const LISTENING_PORT_REGEX = /API Server: Listening on [^\s"]+:(\d+)/;

/**
 * Transfer client using the Aspera Transfer SDK.
 *
 * Methods return promises: errors are raised as rejections.
 */
export class TransferClient {
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
	 * Start the transfer daemon and connect to it, if not already done.
	 * On failure, the daemon is stopped.
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
	 * Start the transfer daemon.
	 */
	async startDaemon() {
		const ASCP_LOG = path.resolve(this.config.logFolder, ASCP_LOG_FILE);
		const FILE_BASE = path.resolve(this.config.logFolder, this.daemonName);
		const DAEMON_CONF_FILE = `${FILE_BASE}.conf`;
		const outFile = `${FILE_BASE}.out`;
		const errFile = `${FILE_BASE}.err`;
		const DAEMON_EXE = this.config.getPath('sdk_daemon');
		const args = ['-c', DAEMON_CONF_FILE];
		const command = `${DAEMON_EXE} ${args.join(' ')}`;
		logger.debug(`daemon out: ${outFile}`);
		logger.debug(`daemon err: ${errFile}`);
		logger.debug(`daemon log: ${this.daemonLog}`);
		logger.debug(`  ascp log: ${ASCP_LOG}`);
		logger.debug(`   command: ${command}`);
		this.createConfigFile(DAEMON_CONF_FILE);
		// the log file may contain lines of previous executions: only read new lines
		const logOffset = fs.existsSync(this.daemonLog) ? fs.statSync(this.daemonLog).size : 0;
		logger.debug('Starting daemon...');
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
				this.daemonFailed(`Error starting the daemon: ${error.message}`);
				resolve();
			});
			daemon.on('exit', (code, signal) => {
				logger.debug(`daemon exited (${code ?? signal})`);
				if (!this.stopping) this.daemonFailed(`daemon exited unexpectedly (${code ?? signal}), check: ${this.daemonLog}`);
				resolve();
			});
		});
		logger.debug(`Started ${this.daemonName} with pid ${daemon.pid}`);
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
	 * @param {number} logOffset only read the log after this offset
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
				logger.info(`Allocated server port: ${this.serverPort}`);
				return;
			}
			if (Date.now() > deadline) throw new Error(`Listening port not found in daemon log after ${STARTUP_TIMEOUT_MS} ms: ${this.daemonLog}`);
			await new Promise(resolve => setTimeout(resolve, 200));
		}
	}

	/**
	 * Find the API listening port in the daemon log, after the given offset.
	 * @param {string} logFile the daemon log file
	 * @param {number} offset only read the log after this offset
	 * @returns {number|null} the port, or null if not found (yet)
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
	 * Get the integer value of the ascp_level parameter.
	 * @param {string} ascpLevel The ascp_level
	 * @returns {number} The integer value of the ascp_level parameter
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
	 * Build the daemon configuration file
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
	 * Connect to the daemon (wait until it listens).
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
			const transferService = new trapi.TransferService(
				`${this.serverAddress}:${this.serverPort}`,
				grpc.credentials.createInsecure()
			);
			transferService.waitForReady(Date.now() + CONNECT_TIMEOUT_MS, (error) => {
				if (error) {
					transferService.close();
					return reject(this.daemonError ?? new Error(`Failed to connect to daemon: ${error.message}`));
				}
				this.transferService = transferService;
				logger.debug('Connected...');
				resolve();
			});
		});
	}

	/**
	 * Stop the daemon, if started, and wait for its termination.
	 */
	async shutdown() {
		this.stopping = true;
		this.transferService?.close();
		this.transferService = null;
		const daemon = this.transferDaemonProcess;
		this.transferDaemonProcess = null;
		if (daemon && daemon.exitCode === null && daemon.signalCode === null) {
			logger.debug('Stopping daemon...');
			daemon.kill('SIGINT');
		}
		await this.daemonExited;
		this.daemonExited = null;
	}

	/**
	 * Start a transfer and monitor it until completion.
	 * The daemon is started if needed.
	 * @param {object} transferSpec the transfer spec
	 * @returns {Promise<void>} resolved when the transfer is completed, rejected if it fails
	 */
	async startTransferAndWait(transferSpec) {
		await this.startup();
		const ts = JSON.stringify(transferSpec);
		logger.debug(`transfer spec: ${ts}`);

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
				if (data.transferInfo) {
					const add = data.status === 'RUNNING' ? ` ${data.transferInfo.averageRateKbps / 1000} Mbps` : '';
					logger.info(`Transfer: ${data.status}${add}`);
				}
				if (data.status === 'FAILED') {
					// `error` is empty on session errors: the cause is in transfer or session information
					const description = [data.error?.description, data.sessionInfo?.errorDesc, data.transferInfo?.errorDescription]
						.map((text) => text?.trim()).find(Boolean) ?? data.transferEvent;
					finish(new Error(`transfer failed: ${description}`));
				} else if (data.transferEvent === 'SESSION_STOP' && data.status === 'COMPLETED') {
					finish();
				}
			});
			eventStream.on('error', (error) => finish(new Error(`transfer monitoring error: ${error.message}`)));
			eventStream.on('end', () => finish(new Error('transfer monitoring ended before transfer completion')));
		});
	}
}
