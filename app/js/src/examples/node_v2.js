#!/usr/bin/env node
// laurent.martin.aspera@fr.ibm.com
import { TransferClient } from '../utils/transfer_client.js';
import { Configuration, logger } from '../utils/configuration.js';

const config = new Configuration();
const transferClient = new TransferClient(config);

// create transfer spec version 2
const transferSpecV2 = {
	title: 'send using Node API and ts v2',
	session_initiation: {
		node_api: {
			url: config.getParam('node','url'),
			headers: [
				Configuration.basicAuthHeaderKeyValue(config.getParam('node','username'), config.getParam('node','password'))
			]
		}
	},
	direction: 'send',
	assets: {
		destination_root: config.getParam('node','folder_upload'),
		paths: []
	}
}

config.addSources(transferSpecV2, 'assets.paths')

transferClient.startConnectDaemon(() => {
	transferClient.startTransferAndWait(transferSpecV2, () => {
		transferClient.shutdownDaemon(() => {
			logger.info('Done!')
			process.exit(0)
		})
	})
})
