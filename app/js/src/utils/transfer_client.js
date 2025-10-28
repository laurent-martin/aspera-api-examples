#!/usr/bin/env node
// laurent.martin.aspera@fr.ibm.com

import fs from 'fs';
import path from 'path';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { spawn } from 'child_process';
import { logger } from './configuration.js';
import readline from 'readline';

const ASCP_LOG_FILE = "aspera-scp-transfer.log";

/**
 * Transfer client using the Aspera Transfer SDK.
 */
export class TransferClient {
	constructor(config) {
		this.config = config;
		const SDK_URL = new URL(this.config.getParam('trsdk', 'url'));
		this.serverAddress = SDK_URL.hostname;
		this.serverPort = parseInt(SDK_URL.port);
		this.transferDaemonProcess = null;
		this.transferService = null;
		this.daemonName = path.basename(config.getPath("sdk_daemon"));
		this.daemonLog = path.resolve(this.config.logFolder, this.daemonName + ".log");
	}

	/**
	 * Start the transfer daemon and connect to it.
	 * @param {*} readyCallback 
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
			logger.debug('Starting daemon...');
			this.transferDaemonProcess = spawn(DAEMON_EXE, args, {
				stdio: ['ignore', fs.openSync(outFile, 'w'), fs.openSync(errFile, 'w')],
			});
			this.transferDaemonProcess.on('error', (error) => logger.error(`Error starting the child process: ${error.message}`));
			this.transferDaemonProcess.on('exit', (code) => {
				logger.debug(`daemon exited (${code})`);
				if (!this.transferService) throw new Error('daemon exited before being ready');
			});
			logger.debug(`Started ${this.daemonName} with pid ${this.transferDaemonProcess.pid}`);
			if (!this.serverPort) {
				await new Promise(resolve => setTimeout(resolve, 2000));
				const fileStream = fs.createReadStream(this.daemonLog);
				const rl = readline.createInterface({ input: fileStream });
				let lastLine = '';
				for await (const line of rl) {
					if (line.trim()) lastLine = line;
				}
				const logInfo = JSON.parse(lastLine);
				const match = /:(\d+)/.exec(logInfo.msg);
				if (!match) throw new Error('Could not read listening port from log file');
				this.serverPort = parseInt(match[1], 10);
				logger.info(`Allocated server port: ${this.serverPort}`);
			}
			await this.initializeGrpcClient(readyCallback);
		} catch (error) {
			logger.error('Error in startConnectDaemon:', error);
		}
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

	initializeGrpcClient(readyCallback) {
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
				readyCallback();
				resolve();
			});
		});
	}

	shutdownDaemon(okCallback) {
		logger.debug('Stopping daemon...');
		this.transferDaemonProcess.on('exit', () => okCallback());
		this.transferDaemonProcess.kill('SIGINT');
	}

	startTransferAndWait(transferSpec, successCallback) {
		const ts = JSON.stringify(transferSpec);
		logger.debug(`transfer spec: ${ts}`);

		const startTransferRequest = {
			transferType: 'FILE_REGULAR',
			transferSpec: ts,
		};

		const eventStream = this.transferService.startTransferWithMonitor(startTransferRequest, (err) => {
			if (err) {
				logger.error('Error starting transfer:', err);
				throw err;
			}
		});

		eventStream.on('data', (data) => {
			if (data.transferInfo) {
				const add = data.status === 'RUNNING' ? ` ${data.transferInfo.averageRateKbps / 1000} Mbps` : '';
				logger.info(`Transfer: ${data.status}${add}`);
			}
			if (data.transferEvent === 'SESSION_STOP' && data.status === 'COMPLETED') {
				successCallback();
			} else if (data.transferEvent === 'SESSION_ERROR' && data.status === 'FAILED') {
				throw new Error('ERROR: An error occurred during transfer session');
			}
		});
	}
}
