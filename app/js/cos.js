#!/usr/bin/env node
// laurent.martin.aspera@fr.ibm.com
const test_environment = require('./test_environment.js')
const assert = require('assert')

// get file list from command line arguments
const files = process.argv.slice(2)

assert(files.length, 'ERROR: Provide at least one file path to transfer')

const config = test_environment.config.cos

// create transfer spec version 2
const transferSpecV2 = {
	title: 'send to COS using ts v2',
	direction: 'send',
	session_initiation: {
		icos: {
			api_key: config['key'],
			bucket: config['bucket'],
			ibm_service_instance_id: config['crn'],
			ibm_service_endpoint: config['endpoint'],
		}
	},
	assets: {
		destination_root: '/',
		paths: files.map((file) => { return { source: file } })
	},
}

test_environment.connect_to_api(() => {
	test_environment.start_transfer_and_wait(transferSpecV2, () => {
		test_environment.shutdown_api(() => {
			console.log('Done!')
			process.exit(0)
		})
	})
})
