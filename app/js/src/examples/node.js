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
node_api.setVerify(config.getParam('node', 'verify', true));

// Get upload authorization for given destination folder
logger.info('Getting transfer spec');
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
try {
	logger.info('Uploading files');
	await transferClient.startTransferAndWait(tSpec);
} finally {
	await transferClient.shutdown();
}
