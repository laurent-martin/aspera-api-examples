#!/usr/bin/env node
// laurent.martin.aspera@fr.ibm.com

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import assert from 'assert';
import os from 'os';
import { spawn } from 'child_process';

export class TransferClient {
	constructor(config) {
		this.config = config;
		this.daemonName = "asperatransferd";
		this.daemonExe = this.config.getPath("sdk_daemon");
		this.grpcUrl = new URL(this.config.getParam('trsdk','url'));
		this.daemonConfFile = path.join(this.config.getPath('temp'), 'daemon.json');
		this.client = null;
		this.sdkProcess = null;
		const packageDefinition = protoLoader.loadSync(this.config.getPath('proto'), {
			keepCase: true,
			longs: String,
			enums: String,
			defaults: true,
			oneofs: true
		});
		this.transfersdk = grpc.loadPackageDefinition(packageDefinition).transfersdk;
	}

	// Connect to the daemon and initialize gRPC client
	startConnectDaemon(readyCallback) {
		const ascpLevel = this.config.getParam("trsdk","ascp_level");
		let ascpIntLevel;
		switch (ascpLevel) {
			case 'info': ascpIntLevel = 0; break;
			case 'debug': ascpIntLevel = 1; break;
			case 'trace': ascpIntLevel = 2; break;
			default: throw new Error("Invalid ascp_level: " + ascpLevel);
		}

		const daemonConf = {
			address: this.grpcUrl.hostname,
			port: parseInt(this.grpcUrl.port),
			log_directory: os.tmpdir(),
			log_level: this.config.getParam("trsdk","level"),
			fasp_runtime: {
				use_embedded: true,
				log: {
					dir: os.tmpdir(),
					level: ascpIntLevel,
				},
			},
		};

		fs.writeFileSync(this.daemonConfFile, JSON.stringify(daemonConf));
		const args = ['-c', this.daemonConfFile];
		const outFile = path.join(os.tmpdir(), 'daemon.out');
		const errFile = path.join(os.tmpdir(), 'daemon.err');

		console.log(`Starting: ${this.daemonExe} ${args.join(' ')}`);
		console.log(`stderr: ${errFile}`);
		console.log(`stdout: ${outFile}`);

		this.sdkProcess = spawn(this.daemonExe, args, {
			stdio: ['ignore', fs.openSync(outFile, 'w'), fs.openSync(errFile, 'w')],
		});

		this.sdkProcess.on('error', (error) => console.error(`Error starting the child process: ${error.message}`));
		this.sdkProcess.on('exit', (code) => {
			console.log(`transferd exited (${code})`);
			if (!this.client) throw new Error("transferd exited before being ready");
		});

		console.log(`Started ${this.daemonName} with pid ${this.sdkProcess.pid}`);

		setTimeout(() => {
			this.client = new this.transfersdk.TransferService(`${this.grpcUrl.hostname}:${this.grpcUrl.port}`, grpc.credentials.createInsecure());
			this.client.waitForReady((new Date()).getTime() + 5000, (err) => {
				if (err) {
					console.log("No server found...");
					return;
				}
				console.log("Connected...");
			});
			readyCallback();
		}, 5000);
	}

	// Shutdown the daemon process
	shutdownDaemon(okCallback) {
		console.log("Stopping transferd...");
		this.sdkProcess.on('exit', () => okCallback());
		this.sdkProcess.kill(2);
	}

	// Start a transfer and monitor its status
	startTransferAndWait(transferSpec, successCallback) {
		const ts = JSON.stringify(transferSpec);
		console.log("transfer spec: %s", ts);

		const startTransferRequest = {
			transferType: 'FILE_REGULAR',
			transferSpec: ts,
		};

		const eventStream = this.client.startTransferWithMonitor(startTransferRequest, (err, data) => {
			console.log("error starting transfer: %s", err);
			throw err;
		});

		eventStream.on('data', (data) => {
			if (data.transferInfo) {
				console.log("Transfer %d Mbps/%d Mbps %s %s %s", data.transferInfo.averageRateKbps / 1000,
					data.transferInfo.targetRateKbps / 1000, data.transferEvent, data.status, data.transferType);
			}
			if (data.transferEvent === 'SESSION_STOP' && data.status === 'COMPLETED') {
				successCallback();
			}
			if (data.transferEvent === 'SESSION_ERROR' && data.status === 'FAILED') {
				throw new Error("ERROR: An error occurred during transfer session");
			}
		});
	}
}
