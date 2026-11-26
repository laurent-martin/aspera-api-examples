#!/usr/bin/env node
// Upload files to an HSTS with SSH credentials, with the Transfer Daemon API only (gRPC).
// Read this sample first: the other samples use the helper class TransferClient, which does the same steps.
// The class Configuration only reads the parameters of the test environment: replace config.getParam(...) with your values.
// cspell:ignore transferd
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { once } from 'events';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { Configuration, logger } from '../utils/configuration.js';

// address of the gRPC API, set in the default configuration file of the SDK: etc/transferd.json
const DAEMON_ADDRESS = '127.0.0.1:55002';

const config = new Configuration();

// 1. Start the Transfer Daemon. Without option, transferd reads etc/transferd.json of the SDK.
//    In production, the daemon can also run as a service, started separately.
const daemonOut = path.join(os.tmpdir(), 'transferd_minimal.out');
logger.info('Starting daemon');
const outFd = fs.openSync(daemonOut, 'w');
const daemon = spawn(config.getPath('sdk_daemon'), [], { stdio: ['ignore', outFd, outFd] });
fs.closeSync(outFd);
const daemonExited = once(daemon, 'exit');
let client = null;
try {
	// 2. Connect to the gRPC API of the daemon: the stub code is generated at runtime from transferd.proto
	// defaults: fields with the default value are present, e.g. status UNKNOWN_STATUS
	const proto = protoLoader.loadSync(config.getPath('proto'), { keepCase: true, enums: String, longs: Number, defaults: true });
	const transferd = grpc.loadPackageDefinition(proto).transferd.api;
	client = new transferd.TransferService(DAEMON_ADDRESS, grpc.credentials.createInsecure());
	await new Promise((resolve, reject) => client.waitForReady(Date.now() + 10000, (error) => error
		? reject(new Error(`Failed to connect to daemon: ${DAEMON_ADDRESS}, see: ${daemonOut}`))
		: resolve()));
	logger.info(`Connected to daemon: ${DAEMON_ADDRESS}`);

	// 3. Build the transfer spec: upload (send) with SSH credentials
	const serverUrl = new URL(config.getParam('server', 'url'));
	const transferSpec = {
		direction: 'send',
		remote_host: serverUrl.hostname,
		ssh_port: parseInt(serverUrl.port, 10),
		remote_user: config.getParam('server', 'username'),
		remote_password: config.getParam('server', 'password'),
		destination_root: config.getParam('server', 'folder_upload'),
		// files to transfer: arguments of the command line
		paths: process.argv.slice(2).map((file) => ({ source: file })),
	};

	// 4. Start the transfer and follow it: the daemon sends an event on each change, until the end of the transfer
	logger.info('Uploading files');
	const events = client.startTransferWithMonitor({
		transferType: 'FILE_REGULAR',
		config: {},
		transferSpec: JSON.stringify(transferSpec),
	});
	let completed = false;
	for await (const event of events) {
		logger.info(`Transfer: ${event.status} ${event.transferInfo?.bytesTransferred ?? 0} bytes`);
		// the cause of an error is in error, or else in transferInfo
		const description = (event.error?.description || event.transferInfo?.errorDescription || '').trim();
		if (['FAILED', 'CANCELED'].includes(event.status)) throw new Error(`Transfer failed: ${description}`);
		if (event.status === 'UNKNOWN_STATUS') throw new Error(`Transfer status unknown: ${description}`);
		completed = event.status === 'COMPLETED';
		if (completed) break;
	}
	// the stream ended before the end of the transfer
	if (!completed) throw new Error('Transfer monitoring ended before transfer completion');
} finally {
	// 5. Stop the daemon: transferd stops cleanly on SIGINT (Windows: terminated)
	client?.close();
	logger.info('Stopping daemon');
	daemon.kill('SIGINT');
	await daemonExited;
}
