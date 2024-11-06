#!/usr/bin/env node
// laurent.martin.aspera@fr.ibm.com
import { config, addSources, startTransferAndWait, startConnectDaemon, shutdownDaemon } from '../utils/test_environment.js';
import assert from 'assert';

// get destination server from example config
const server_url = new URL(config.server.url)
assert(server_url.protocol === 'ssh:', 'ERROR: Expecting SSH protocol')

// create transfer spec version 2
const transferSpecV2 = {
	direction: 'send',
	remote_host: server_url.hostname,
	session_initiation: {
		ssh: {
			ssh_port: parseInt(server_url.port),
			remote_user: config.server.username,
			remote_password: config.server.password
		}
	},
	security: {
		cipher: 'aes-256'
	},
	assets: {
		destination_root: config.server.folder_upload,
		paths: []
	}
}

addSources(transferSpecV2, 'assets.paths')

startConnectDaemon(() => {
	startTransferAndWait(transferSpecV2, () => {
		shutdownDaemon(() => {
			console.log('Done!')
			process.exit(0)
		})
	})
})
