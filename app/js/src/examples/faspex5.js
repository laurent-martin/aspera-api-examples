#!/usr/bin/env node
// laurent.martin.aspera@fr.ibm.com
// Send a package using Faspex 5 API (upload files from local/remote source)

import { TransferClient } from '../utils/transfer_client.js';
import { Configuration, logger } from '../utils/configuration.js';
import { Rest } from '../utils/rest.js';

// Faspex 5 API base path
const F5_API_PATH_V5 = '/api/v5';
const F5_API_PATH_TOKEN = '/auth/token';
// number of parallel transfer sessions (typically, 1)
const transferSessions = 1;

const config = new Configuration();
const transferClient = new TransferClient(config);

// Initialize Faspex 5 API client
const f5Api = new Rest(`${config.getParam('faspex5', 'url')}${F5_API_PATH_V5}`);
f5Api.setVerify(config.getParam('faspex5', 'verify', true));
f5Api.setAuthBearer({
    token_url: `${config.getParam('faspex5', 'url')}${F5_API_PATH_TOKEN}`,
    key_pem_path: config.getParam('faspex5', 'private_key'),
    client_id: config.getParam('faspex5', 'client_id'),
    client_secret: config.getParam('faspex5', 'client_secret'),
    iss: config.getParam('faspex5', 'client_id'),
    aud: config.getParam('faspex5', 'client_id'),
    sub: `user:${config.getParam('faspex5', 'username')}`,
});
await f5Api.setDefaultScope();

// Create a new package
logger.info('Creating package');
const packageInfo = await f5Api.create('packages', {
    title: "Node.js package example",
    recipients: [{ name: config.getParam('faspex5', 'username') }]  // Send to myself (for test)
});

// Build payload to specify files to send
const uploadRequest = {};
config.addSources(uploadRequest, 'paths');

// Get transfer spec
logger.info('Getting transfer spec');
const tSpec = await f5Api.create(`packages/${packageInfo.id}/transfer_spec/upload?transfer_type=connect`, uploadRequest);

// Optional: multi-session support
if (transferSessions !== 1) {
    tSpec.multi_session = transferSessions;
    tSpec.multi_session_threshold = 500000;
}

// Add file list in transfer spec
config.addSources(tSpec, 'paths');

// Start the transfer using the transfer client
try {
    logger.info('Uploading files');
    await transferClient.startTransferAndWait(tSpec);
} finally {
    await transferClient.shutdown();
}

