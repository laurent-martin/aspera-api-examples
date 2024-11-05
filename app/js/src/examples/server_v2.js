#!/usr/bin/env node
// laurent.martin.aspera@fr.ibm.com
const test_environment = require('../utils/test_environment');
const assert = require('assert')

// get destination server from example config
const server_config = test_environment.config.server;
const server_url = new URL(server_config.url)
assert(server_url.protocol === 'ssh:', 'ERROR: Expecting SSH protocol')

// create transfer spec version 2
const transferSpecV2 = {
	direction: 'send',
	remote_host: server_url.hostname,
	session_initiation: {
		ssh: {
			ssh_port: parseInt(server_url.port),
			remote_user: server_config.username,
			remote_password: server_config.password
		}
	},
	security: {
		cipher: 'aes-256'
	},
	assets: {
		destination_root: server_config.folder_upload,
		paths: []
	}
}

test_environment.addSources(transferSpecV2, 'assets.paths')

test_environment.connect_to_api(() => {
	test_environment.start_transfer_and_wait(transferSpecV2, () => {
		test_environment.shutdown_api(() => {
			console.log('Done!')
			process.exit(0)
		})
	})
})

