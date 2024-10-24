#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Upload files to Aspera Shares (similar as node api)
import utils.configuration
import utils.transfer_client
import utils.rest
import logging

config = utils.configuration.Configuration()
transfer_client = utils.transfer_client.TransferClient(config).startup()

try:
    shares_api = utils.rest.Rest(f"{config.param('shares', 'url')}/node_api")
    shares_api.setAuthBasic(config.param('shares', 'username'), config.param('shares', 'password'))
    shares_api.setVerify(config.param('shares', 'verify', True))

    # call Node API with a single transfer request to get one transfer spec with Aspera token
    logging.info('Generating transfer spec')
    response_data = shares_api.create('files/upload_setup', {
        'transfer_requests': [
            {'transfer_request': {'paths': [{'destination': config.param('shares', 'folder_upload')}]}}
        ]
    })

    # extract the single transfer spec (we sent a single transfer request)
    t_spec = response_data['transfer_specs'][0]['transfer_spec']

    # add file list in transfer spec
    config.add_sources(t_spec, 'paths')

    # start transfer, using Transfer SDK
    transfer_client.start_transfer_and_wait(t_spec)
finally:
    transfer_client.shutdown()
