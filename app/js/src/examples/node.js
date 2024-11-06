#!/usr/bin/env node
// laurent.martin.aspera@fr.ibm.com
// Upload files using an Aspera Transfer token, generated using Node API (upload_setup)

import { TransferClient } from '../utils/transfer_client.js';
import { Configuration } from '../utils/configuration.js';
import ky from 'ky';

const config = new Configuration();
const transferClient = new TransferClient(config);

const node_api = ky.extend({
	prefixUrl: config.getParam('node','url'),
	headers: {
		'Content-Type': 'application/json',
		'Authorization': Configuration.basicAuthorization(config.getParam('node','username'), config.getParam('node','password'))
	},
	https: {
		rejectUnauthorized: config.getParam('node','verify') ?? true
	}
});

console.log('Generating transfer spec V1 from node');

// Get upload authorization for given destination
const response = await node_api.post('files/upload_setup', {
	json: {
		transfer_requests: [
			{ transfer_request: { paths: [{ destination: config.getParam('node','folder_upload') }] } }
		]
	}
}).json();

// Extract the single transfer spec from the response data
const tSpec = response.transfer_specs[0].transfer_spec;

// Add file list to the transfer spec
config.addSources(tSpec, 'paths');

// Start the transfer using the transfer client
transferClient.startConnectDaemon(() => {
	transferClient.startTransferAndWait(tSpec, () => {
		transferClient.shutdownDaemon(() => {
			console.log('Done!');
			process.exit(0);
		});
	});
});
