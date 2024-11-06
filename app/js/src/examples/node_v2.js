#!/usr/bin/env node
// laurent.martin.aspera@fr.ibm.com
import { config, basicAuthHeaderKeyValue, addSources, startTransferAndWait, startConnectDaemon, shutdownDaemon } from '../utils/test_environment.js';

// create transfer spec version 2
const transferSpecV2 = {
	title: 'send using Node API and ts v2',
	session_initiation: {
		node_api: {
			url: config.node.url,
			headers: [
				basicAuthHeaderKeyValue(config.node.username, config.node.password)
			]
		}
	},
	direction: 'send',
	assets: {
		destination_root: config.node.folder_upload,
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
