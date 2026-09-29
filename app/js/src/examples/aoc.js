#!/usr/bin/env node
// laurent.martin.aspera@fr.ibm.com
// Aspera on Cloud
// Send a package to shared inbox (name in config file) in given workspace (name in config file)

import { Configuration, logger } from '../utils/configuration.js';
import { TransferClient } from '../utils/transfer_client.js';
import { Rest } from '../utils/rest.js';
import { randomUUID } from 'crypto';

// AoC API base URL
const AOC_API_V1_BASE_URL = 'https://api.ibmaspera.com/api/v1';
const AOC_OAUTH_AUDIENCE = 'https://api.asperafiles.com/api/v1/oauth2/token';

// Package name and number of sessions
const packageName = 'sample package JavaScript';
const transferSessions = 1;

const config = new Configuration();
const transferClient = new TransferClient(config);

/**
 * Generate the transfer cookie of AoC, that identifies the application and the user.
 * @param {string} app AoC application, e.g. `packages`
 * @param {string} userName name of the user
 * @param {string} userId identifier of the user: email
 * @returns {string} cookie
 */
function generateCookie(app, userName, userId) {
    const encodedApp = Buffer.from(app).toString('base64');
    const encodedUserName = Buffer.from(userName).toString('base64');
    const encodedUserId = Buffer.from(userId).toString('base64');
    return `aspera.aoc:${encodedApp}:${encodedUserName}:${encodedUserId}`;
}

const aocApi = new Rest(AOC_API_V1_BASE_URL);
aocApi.setAuthBearer({
    token_url: `${AOC_API_V1_BASE_URL}/oauth2/${config.getParam('aoc', 'org')}/token`,
    key_pem_path: config.getParam('aoc', 'private_key'),
    client_id: config.getParam('aoc', 'client_id'),
    client_secret: config.getParam('aoc', 'client_secret'),
    iss: config.getParam('aoc', 'client_id'),
    aud: AOC_OAUTH_AUDIENCE,
    sub: config.getParam('aoc', 'user_email'),
    org: config.getParam('aoc', 'org'),
});
await aocApi.setDefaultScope('user:all');

// Get user info
logger.info('Getting user information');
const userInfo = await aocApi.read('self');

// Get workspace info
const workspaceName = config.getParam('aoc', 'workspace');
logger.info(`Getting workspace: ${workspaceName}`);
let responseData = await aocApi.read('workspaces', { q: workspaceName });
if (responseData.length !== 1) throw new Error(`Found ${responseData.length} workspaces for ${workspaceName}`);
const workspaceInfo = responseData[0];

// Get shared inbox info
const sharedInboxName = config.getParam('aoc', 'shared_inbox');
logger.info(`Getting shared inbox: ${sharedInboxName}`);
responseData = await aocApi.read('dropboxes', {
    current_workspace_id: workspaceInfo.id,
    q: sharedInboxName
});
if (responseData.length !== 1) throw new Error(`Found ${responseData.length} shared inboxes for ${sharedInboxName}`);
const dropboxInfo = responseData[0];

// Create a new package
logger.info('Creating package');
const packageInfo = await aocApi.create('packages', {
    workspace_id: workspaceInfo.id,
    recipients: [{ id: dropboxInfo.id, type: 'dropbox' }],
    name: packageName,
    note: 'My package note',
});

// Get node information
logger.info('Getting node information');
const nodeInfo = await aocApi.read(`nodes/${packageInfo.node_id}`);

// Set expected transfers
logger.info('Setting expected transfers');
await aocApi.update(`packages/${packageInfo.id}`, {
    sent: true,
    transfers_expected: transferSessions
});

// Generate bearer token for transfer
// Tags of the transfer spec:
// - `node`: mandatory, HSTS authorizes the bearer token for this access key and folder
// - `app`, `files`: mandatory, AoC links the transfer to the package
// - `usage_id`, `xfer_retry`: optional
const tSpec = {
    direction: 'send',
    token: await aocApi.getBearerToken(`node.${nodeInfo.access_key}:user:all`),
    tags: {
        aspera: {
            app: 'packages',
            files: {
                node_id: nodeInfo.id,
                package_id: packageInfo.id,
                package_name: packageInfo.name,
                package_operation: 'upload',
                files_transfer_action: 'upload_package',
                workspace_name: workspaceInfo.name,
                workspace_id: workspaceInfo.id
            },
            node: {
                access_key: nodeInfo.access_key,
                file_id: packageInfo.contents_file_id
            },
            usage_id: `aspera.files.workspace.${workspaceInfo.id}`,
            xfer_id: randomUUID(),
            xfer_retry: 3600
        }
    },
    remote_host: nodeInfo.host,
    remote_user: 'xfer',
    ssh_port: 33001,
    fasp_port: 33001,
    cookie: generateCookie('packages', userInfo.name, userInfo.email),
    create_dir: true,
    target_rate_kbps: 100000,
    paths: []
};

if (transferSessions !== 1) {
    tSpec.multi_session = transferSessions;
    tSpec.multi_session_threshold = 500000;
}

// Add file list to transfer spec
config.addSources(tSpec, 'paths');

// Start the transfer using the transfer client
try {
    logger.info('Uploading files');
    await transferClient.startTransferAndWait(tSpec);
} finally {
    await transferClient.shutdown();
}
