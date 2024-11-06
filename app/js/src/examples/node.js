#!/usr/bin/env node
// laurent.martin.aspera@fr.ibm.com
// Upload files using an Aspera Transfer token, generated using Node API (upload_setup)

import { TransferClient } from '../utils/transfer_client.js';
import { Configuration, logger } from '../utils/configuration.js';
import { Rest } from '../utils/rest.js';

const config = new Configuration();
const transferClient = new TransferClient(config);

const node_api = new Rest(config.getParam('node', 'url'));
node_api.setAuthBasic(config.getParam('node', 'username'), config.getParam('node', 'password'));
node_api.setVerify(config.getParam('node', 'verify'));

logger.info('Generating transfer spec V1 from node');

// Get upload authorization for given destination folder
const response = await node_api.create('files/upload_setup', {
	transfer_requests: [
		{ transfer_request: { paths: [{ destination: config.getParam('node', 'folder_upload') }] } }
	]
});

// Extract the single transfer spec from the response data
const tSpec = response.transfer_specs[0].transfer_spec;

// Add file list to the transfer spec
config.addSources(tSpec, 'paths');

// Start the transfer using the transfer client
transferClient.startConnectDaemon(() => {
	transferClient.startTransferAndWait(tSpec, () => {
		transferClient.shutdownDaemon(() => {
			logger.info('Done!');
			process.exit(0);
		});
	});
});
