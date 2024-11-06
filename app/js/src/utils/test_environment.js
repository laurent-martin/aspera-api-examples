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

// Helper functions

// Ensures that the provided directory exists
const resolveDirectory = (dirEnvVar) => {
	const dir = process.env[dirEnvVar];
	if (!dir) throw new Error(`Environment variable ${dirEnvVar} is not set.`);
	const resolvedDir = path.resolve(dir);
	if (!fs.existsSync(resolvedDir) || !fs.lstatSync(resolvedDir).isDirectory()) {
		throw new Error(`The folder specified by ${dirEnvVar} does not exist or is not a directory: ${resolvedDir}`);
	}
	return resolvedDir;
};

// Loads YAML files
const loadYAML = (filePath) => yaml.load(fs.readFileSync(filePath, 'utf8'));

// gRPC client setup
const setupGRPCClient = (url, packageDefinition) => {
	const grpcUrl = new URL(url);
	assert(grpcUrl.protocol === 'grpc:', "Expecting gRPC protocol");
	return new grpc.Client(`${grpcUrl.hostname}:${grpcUrl.port}`, grpc.credentials.createInsecure());
};

// Configuration & Paths
const paths_file = 'config/paths.yaml';
const topFolder = resolveDirectory('DIR_TOP');
export const tmpFolder = os.tmpdir();

const getPath = (name) => path.join(topFolder, paths[name]);

const paths = loadYAML(path.join(topFolder, paths_file));
export const config = loadYAML(getPath('main_config'));

// Initialize constants
const daemonName = "asperatransferd";
const daemonExe = getPath("sdk_daemon", topFolder);
const grpcUrl = new URL(config['trsdk']['url']);
const daemonConfFile = path.join(getPath('temp', topFolder), 'daemon.json');

// gRPC package and stub setup
const packageDefinition = protoLoader.loadSync(getPath('proto', topFolder), {
	keepCase: true,
	longs: String,
	enums: String,
	defaults: true,
	oneofs: true
});
const transfersdk = grpc.loadPackageDefinition(packageDefinition).transfersdk;

// State variables
let client = null;
let sdkProcess = null;

// Command-line arguments
const fileList = process.argv.slice(2);
assert(fileList.length, 'ERROR: Provide at least one file path to transfer');

// Connect to the API
export const connectToAPI = (readyCallback) => {
	const ascpLevel = config["trsdk"]["ascp_level"];
	let ascpIntLevel;
	switch (ascpLevel) {
		case 'info': ascpIntLevel = 0; break;
		case 'debug': ascpIntLevel = 1; break;
		case 'trace': ascpIntLevel = 2; break;
		default: throw new Error("Invalid ascp_level: " + ascpLevel);
	}

	const daemonConf = {
		address: grpcUrl.hostname,
		port: parseInt(grpcUrl.port),
		log_directory: os.tmpdir(),
		log_level: config["trsdk"]["level"],
		fasp_runtime: {
			use_embedded: true,
			log: {
				dir: os.tmpdir(),
				level: ascpIntLevel,
			},
		},
	};

	fs.writeFileSync(daemonConfFile, JSON.stringify(daemonConf));
	const args = ['-c', daemonConfFile];
	const outFile = path.join(os.tmpdir(), 'daemon.out');
	const errFile = path.join(os.tmpdir(), 'daemon.err');

	console.log(`Starting: ${daemonExe} ${args.join(' ')}`);
	console.log(`stderr: ${errFile}`);
	console.log(`stdout: ${outFile}`);

	sdkProcess = spawn(daemonExe, args, {
		stdio: ['ignore', fs.openSync(outFile, 'w'), fs.openSync(errFile, 'w')],
	});

	sdkProcess.on('error', (error) => console.error(`Error starting the child process: ${error.message}`));
	sdkProcess.on('exit', (code) => {
		console.log(`transferd exited (${code})`);
		if (!client) throw new Error("transferd exited before being ready");
	});

	console.log(`Started ${daemonName} with pid ${sdkProcess.pid}`);

	// Connect to gRPC API
	setTimeout(() => {
		client = new transfersdk.TransferService(`${grpcUrl.hostname}:${grpcUrl.port}`, grpc.credentials.createInsecure());
		client.waitForReady((new Date()).getTime() + 5000, (err) => {
			if (err) {
				console.log("No server found...");
				return;
			}
			console.log("Connected...");
		});
		readyCallback();
	}, 5000);
}

// Shutdown the API
export const shutdownAPI = (okCallback) => {
	console.log("Stopping transferd...");
	sdkProcess.on('exit', () => okCallback());
	sdkProcess.kill(2);
}

// Start a transfer and wait for the result
export const startTransferAndWait = (transferSpec, successCallback) => {
	const ts = JSON.stringify(transferSpec);
	console.log("transfer spec: %s", ts);

	const startTransferRequest = {
		transferType: 'FILE_REGULAR',
		transferSpec: ts,
	};

	const eventStream = client.startTransferWithMonitor(startTransferRequest, (err, data) => {
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

// Basic Authorization for headers
export const basicAuthorization = (username, password) =>
	'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')

// Basic Auth Header for transfer SDK
export const basicAuthHeaderKeyValue = (username, password) => ({
	key: 'Authorization',
	value: basicAuthorization(username, password),
})

// Add sources to a transfer spec
export const addSources = (tSpec, path, destination = null) => {
	const keys = path.split('.');
	let currentNode = tSpec;

	for (let i = 0; i < keys.length - 1; i++) {
		const key = keys[i];
		if (typeof currentNode[key] === 'object' && currentNode[key] !== null) {
			currentNode = currentNode[key];
		} else {
			throw new Error(`Key is not a dictionary: ${key}`);
		}
	}

	const lastKey = keys[keys.length - 1];
	const paths = currentNode[lastKey] = [];
	fileList.forEach((file) => {
		const source = { source: file };
		if (destination) {
			source.destination = path.basename(file);
		}
		paths.push(source);
	});
}
