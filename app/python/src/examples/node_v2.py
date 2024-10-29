#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Upload files using node API and transfer spec v2
import utils.configuration
import utils.transfer_client

config = utils.configuration.Configuration()
transfer_client = utils.transfer_client.TransferClient(config).startup()

try:
    # prepare transfer spec v2 for COS
    t_spec = {
        'title': 'send using Node API and ts v2',
        'session_initiation': {
            'node_api': {
                'url': config.param('node', 'url'),
                'headers': [
                    utils.configuration.basic_auth_header_key_value(config.param('node', 'username'), config.param('node', 'password'))
                ]
            }
        },
        'direction': 'send',
        'assets': {
            'destination_root': config.param('node', 'folder_upload'),
            'paths': []
        },
    }

    # add file list in transfer spec
    config.add_sources(t_spec, 'assets.paths')

    # start transfer, using Transfer SDK
    transfer_client.start_transfer_and_wait(t_spec)
finally:
    transfer_client.shutdown()
