#!/usr/bin/env node
// laurent.martin.aspera@fr.ibm.com
import { TransferClient } from '../utils/transfer_client.js';
import { Configuration, logger } from '../utils/configuration.js';

const config = new Configuration();
const transferClient = new TransferClient(config);

// get destination server from example config
const server_url = new URL(config.getParam('server','url'))
if (server_url.protocol !== 'ssh:') throw new Error(`Expecting SSH URL: ${server_url}`)

// create transfer spec version 2
const transferSpecV2 = {
	direction: 'send',
	remote_host: server_url.hostname,
	session_initiation: {
		ssh: {
			ssh_port: parseInt(server_url.port),
			remote_user: config.getParam('server','username'),
			remote_password: config.getParam('server','password')
		}
	},
	security: {
		cipher: 'aes-256'
	},
	assets: {
		destination_root: config.getParam('server','folder_upload'),
		paths: []
	}
}

config.addSources(transferSpecV2, 'assets.paths')

try {
	logger.info('Uploading files');
	await transferClient.startTransferAndWait(transferSpecV2);
} finally {
	await transferClient.shutdown();
}
