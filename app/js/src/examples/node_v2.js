#!/usr/bin/env node
// laurent.martin.aspera@fr.ibm.com
const test_environment = require('../utils/test_environment');

const config = test_environment.config;

// create transfer spec version 2
const transferSpecV2 = {
	title: 'send using Node API and ts v2',
	session_initiation: {
		node_api: {
			url: config.node.url,
			headers: [
				test_environment.basicAuthHeaderKeyValue(config.node.username, config.node.password)
			]
		}
	},
	direction: 'send',
	assets: {
		destination_root: config.node.folder_upload,
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

