#!/usr/bin/env node
// laurent.martin.aspera@fr.ibm.com
// Upload files using an Aspera Transfer token, generated using Node API (upload_setup)

import { config, basicAuthorization, addSources, startTransferAndWait, connectToAPI, shutdownAPI } from '../utils/test_environment.js';
import ky from 'ky';

try {
	console.log('Generating transfer spec V1 from node');

	// Prepare the request for the transfer spec
	const response = await ky.post(`${config.node.url}/files/upload_setup`, {
		headers: {
			'Content-Type': 'application/json',
			'Authorization': basicAuthorization(config.node.username, config.node.password)
		},
		json: {
			transfer_requests: [
				{ transfer_request: { paths: [{ destination: config.node.folder_upload }] } }
			]
		},
		retry: { limit: 0 },  // Optional: Disable retries if desired
		https: {
			rejectUnauthorized: config.node.verify ?? true
		}
	}).json();

	// Extract the single transfer spec from the response data
	const tSpec = response.transfer_specs[0].transfer_spec;

	// Add file list to the transfer spec
	addSources(tSpec, 'paths');

	// Start the transfer using the transfer client
	connectToAPI(() => {
		startTransferAndWait(tSpec, () => {
			shutdownAPI(() => {
				console.log('Done!');
				process.exit(0);
			});
		});
	});
} catch (error) {
	console.error('Error during transfer:', error);
}

