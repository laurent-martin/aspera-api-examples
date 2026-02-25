#!/usr/bin/env node
// laurent.martin.aspera@fr.ibm.com
import { TransferClient } from '../utils/transfer_client.js';
import { Configuration, logger } from '../utils/configuration.js';

const config = new Configuration();
const transferClient = new TransferClient(config);

// create transfer spec version 2
const transferSpecV2 = {
	title: 'send to COS using ts v2',
	direction: 'send',
	session_initiation: {
		icos: {
			api_key: config.getParam('cos', 'key'),
			bucket: config.getParam('cos', 'bucket'),
			ibm_service_instance_id: config.getParam('cos', 'crn'),
			ibm_service_endpoint: config.getParam('cos', 'endpoint'),
		}
	},
	assets: {
		destination_root: '/',
		paths: []
	},
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
