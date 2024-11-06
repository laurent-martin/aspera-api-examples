#!/usr/bin/env node
// laurent.martin.aspera@fr.ibm.com
// Upload files using an Aspera Transfer token, generated using Node API (upload_setup)

import { config, basicAuthorization, addSources, startTransferAndWait, startConnectDaemon, shutdownDaemon } from '../utils/test_environment.js';
import ky from 'ky';

const node_api = ky.extend({
	prefixUrl: config.node.url,
	headers: {
		'Content-Type': 'application/json',
		'Authorization': basicAuthorization(config.node.username, config.node.password)
	},
	https: {
		rejectUnauthorized: config.node.verify ?? true
	}
});

console.log('Generating transfer spec V1 from node');

// Get upload authorization for given destination
const response = await node_api.post('files/upload_setup', {
	json: {
		transfer_requests: [
			{ transfer_request: { paths: [{ destination: config.node.folder_upload }] } }
		]
	}
}).json();

// Extract the single transfer spec from the response data
const tSpec = response.transfer_specs[0].transfer_spec;

// Add file list to the transfer spec
addSources(tSpec, 'paths');

// Start the transfer using the transfer client
startConnectDaemon(() => {
	startTransferAndWait(tSpec, () => {
		shutdownDaemon(() => {
			console.log('Done!');
			process.exit(0);
		});
	});
});
