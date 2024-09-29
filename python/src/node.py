#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Upload files using an Aspera Transfer token, generated using node API (upload_setup)
import utils.configuration
import utils.transfer_client
import utils.rest
import logging as log

config = utils.configuration.Configuration()
transfer_client = utils.transfer_client.TransferClient(config).startup()

try:
    node_api = utils.rest.Rest(
        config.param('node', 'url'),
        user=config.param('node', 'username'),
        password=config.param('node', 'password'),
        # verify certificate if not explicitly set to False
        verify=config.param('node', 'verify', True),
    )

    # call Node API with a single transfer request to get one transfer spec with Aspera token
    log.info('Generating transfer spec')
    response_data = node_api.post('files/upload_setup', {
        'transfer_requests': [
            {'transfer_request': {'paths': [{'destination': config.param('node', 'folder_upload')}]}}
        ]
    })

    # extract the single transfer spec (we sent a single transfer request)
    t_spec = response_data['transfer_specs'][0]['transfer_spec']

    # add file list in transfer spec
    t_spec['paths'] = []
    for f in config.file_list():
        t_spec['paths'].append({'source': f})

    # start transfer, here we use the FASP Manager, but the newer Transfer SDK can be used as well
    transfer_client.start_transfer_and_wait(t_spec)
finally:
    transfer_client.shutdown()
