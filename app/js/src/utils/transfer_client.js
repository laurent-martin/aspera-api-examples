#!/usr/bin/env node
// laurent.martin.aspera@fr.ibm.com

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
// API port in daemon log (text or JSON log format), e.g. `API Server: Listening on 127.0.0.1:55002 ...`
const LISTENING_PORT_REGEX = /API Server: Listening on [^\s"]+:(\d+)/;

/**
 * Transfer client using the Aspera Transfer SDK.
 */
export class TransferClient {
	constructor(config) {
		this.config = config;
		const SDK_URL = new URL(this.config.getParam('trsdk', 'url'));
		this.serverAddress = SDK_URL.hostname;
		this.serverPort = SDK_URL.port === '' ? TRANSFERD_DEFAULT_PORT : parseInt(SDK_URL.port, 10);
		this.transferDaemonProcess = null;
		this.transferService = null;
		// true when daemon exit is expected
		this.stopping = false;
		this.daemonName = path.basename(config.getPath("sdk_daemon"));
		this.daemonLog = path.resolve(this.config.logFolder, this.daemonName + ".log");
	}

	/**
	 * Report a fatal error: stop the daemon and exit with a non-zero code,
	 * so that the sample is not considered successful.
	 * @param {Error|string} error
	 */
	fail(error) {
		logger.error(error instanceof Error ? error.message : String(error));
		this.stopping = true;
		const daemon = this.transferDaemonProcess;
		if (daemon && daemon.exitCode === null && daemon.signalCode === null) daemon.kill('SIGTERM');
		process.exit(1);
	}

	/**
	 * Start the transfer daemon and connect to it.
	 * Any error is fatal (see `fail`).
	 * @param {function} readyCallback called once connected to the daemon
	 */
	async startConnectDaemon(readyCallback) {
		try {
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
			const outFd = fs.openSync(outFile, 'w');
			const errFd = fs.openSync(errFile, 'w');
			this.transferDaemonProcess = spawn(DAEMON_EXE, args, {
				stdio: ['ignore', outFd, errFd],
			});
			// the child process has its own copy of the file descriptors
			fs.closeSync(outFd);
			fs.closeSync(errFd);
			this.transferDaemonProcess.on('error', (error) => this.fail(`Error starting the child process: ${error.message}`));
			this.transferDaemonProcess.on('exit', (code, signal) => {
				logger.debug(`daemon exited (${code ?? signal})`);
				if (!this.stopping) this.fail(`daemon exited unexpectedly (${code ?? signal}), check: ${this.daemonLog}`);
			});
			logger.debug(`Started ${this.daemonName} with pid ${this.transferDaemonProcess.pid}`);
			await this.waitDaemonListening(logOffset);
			await this.initializeGrpcClient();
			readyCallback();
		} catch (error) {
			this.fail(error);
		}
	}

	/**
	 * Wait for the daemon to listen, and get the port if dynamically allocated (port 0).
	 * The port is read from the daemon log: requires log level `info` or more verbose.
	 * Exit of the daemon is handled by the `exit` event.
	 * @param {number} logOffset only read the log after this offset
	 */
	async waitDaemonListening(logOffset) {
		const deadline = Date.now() + STARTUP_TIMEOUT_MS;
		// fixed port: readiness is checked on connection
		while (this.serverPort === 0) {
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

	initializeGrpcClient() {
		return new Promise((resolve, reject) => {
			const packageDefinition = protoLoader.loadSync(this.config.getPath('proto'), {
				keepCase: true,
				longs: String,
				enums: String,
				defaults: true,
				oneofs: true,
			});
			const trapi = grpc.loadPackageDefinition(packageDefinition).transferd.api;
			this.transferService = new trapi.TransferService(
				`${this.serverAddress}:${this.serverPort}`,
				grpc.credentials.createInsecure()
			);
			this.transferService.waitForReady(Date.now() + 5000, (err) => {
				if (err) {
					logger.error('No server found...', err);
					return reject(err);
				}
				logger.debug('Connected...');
				resolve();
			});
		});
	}

	shutdownDaemon(okCallback) {
		logger.debug('Stopping daemon...');
		this.stopping = true;
		this.transferService?.close();
		this.transferService = null;
		this.transferDaemonProcess.on('exit', () => okCallback());
		this.transferDaemonProcess.kill('SIGINT');
	}

	/**
	 * Start a transfer and monitor it until completion.
	 * A failed transfer is fatal (see `fail`).
	 * @param {object} transferSpec the transfer spec
	 * @param {function} successCallback called when the transfer is completed
	 */
	startTransferAndWait(transferSpec, successCallback) {
		const ts = JSON.stringify(transferSpec);
		logger.debug(`transfer spec: ${ts}`);

		const startTransferRequest = {
			transferType: 'FILE_REGULAR',
			transferSpec: ts,
		};

		// server streaming call: no callback, events and errors are received on the stream
		const eventStream = this.transferService.startTransferWithMonitor(startTransferRequest);
		let finished = false;

		eventStream.on('data', (data) => {
			if (finished) return;
			if (data.transferInfo) {
				const add = data.status === 'RUNNING' ? ` ${data.transferInfo.averageRateKbps / 1000} Mbps` : '';
				logger.info(`Transfer: ${data.status}${add}`);
			}
			if (data.status === 'FAILED') {
				finished = true;
				this.fail(`transfer failed: ${data.error?.description ?? data.transferEvent}`);
			} else if (data.transferEvent === 'SESSION_STOP' && data.status === 'COMPLETED') {
				finished = true;
				try {
					successCallback();
				} catch (error) {
					this.fail(error);
				}
			}
		});
		eventStream.on('error', (error) => {
			if (!finished) this.fail(`transfer monitoring error: ${error.message}`);
		});
		eventStream.on('end', () => {
			if (!finished) this.fail('transfer monitoring ended before transfer completion');
		});
	}
}
