#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Upload files using node API and transfer spec v2
import utils.tools
import utils.transfer_client

test_env = utils.tools.Tools()
transfer_client = utils.transfer_client.TransferClient(test_env).setup()

try:
    # get node information from config file
    config = test_env.conf('node')

    # prepare transfer spec v2 for COS
    t_spec = {
        'title': 'send using Node API and ts v2',
        'session_initiation': {
            'node_api': {
                'url': config['url'],
                'headers': [
                    utils.tools.basic_auth_header_key_value(config['user'], config['pass'])
                ]
            }
        },
        'direction': 'send',
        'assets': {
            'destination_root': config['folder_upload'],
            'paths': []
        },
    }

    # add file list in transfer spec
    for f in test_env.file_list():
        t_spec['assets']['paths'].append({'source': f})

    # start transfer, using Transfer SDK
    transfer_client.start_transfer_and_wait(t_spec)
finally:
    transfer_client.shutdown()
