#!/usr/bin/env node
// laurent.martin.aspera@fr.ibm.com
// Upload files using an Aspera Transfer token, generated using Node API (upload_setup)

import { config, basicAuthHeaderKeyValue, addSources, startTransferAndWait, connectToAPI, shutdownAPI } from '../utils/test_environment.js';
import ky from 'ky';

// Set up Node API with basic authentication
const nodeApiUrl = config.node.url;
const authHeader = basicAuthHeaderKeyValue(config.node.username, config.node.password);
const verify = config.node.verify ?? true;

try {
	console.log('Generating transfer spec');

	// Prepare the request for the transfer spec
	const response = await ky.post(`${nodeApiUrl}/files/upload_setup`, {
		headers: {
			'Content-Type': 'application/json',
			'Authorization': authHeader.value  // Using the generated authorization header
		},
		json: {
			transfer_requests: [
				{ transfer_request: { paths: [{ destination: config.node.folder_upload }] } }
			]
		},
		retry: { limit: 0 },  // Optional: Disable retries if desired
		https: {
			rejectUnauthorized: verify  // Used for SSL verification
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

