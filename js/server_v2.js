#!/usr/bin/env node
// laurent.martin.aspera@fr.ibm.com
const test_environment = require('./test_environment.js')
const assert = require('assert')

// get file list from command line arguments
const files = process.argv.slice(2)

assert(files.length, 'ERROR: Provide at least one file path to transfer')

// get destination server from example config
const server_url = new URL(test_environment.config.server.url)
assert(server_url.protocol === 'ssh:', 'ERROR: Expecting SSH protocol')

// create transfer spec version 2
const transferSpecV2 = {
	direction: 'send',
	remote_host: server_url.hostname,
	session_initiation: {
		ssh: {
			ssh_port: parseInt(server_url.port),
			remote_user: test_environment.config.server.user,
			remote_password: test_environment.config.server.pass
		}
	},
	security: {
		cipher: 'aes-256'
	},
	assets: {
		destination_root: '/Upload',
		paths: files.map((file) => { return { source: file } })
	}
}

test_environment.connect_to_api(() => {
	test_environment.start_transfer_and_wait(transferSpecV2, () => {
		test_environment.shutdown_api(() => {
			console.log('Done!')
			process.exit(0)
		})
	})
})

