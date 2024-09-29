#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Upload files Shares (Node) API and transfer spec v2
# Note: Transfer SDK may have a bug that make this work only if the share name is equal to the folder name on node.
import utils.configuration
import utils.transfer_client

config = utils.configuration.Configuration()
transfer_client = utils.transfer_client.TransferClient(config).startup()

try:
    shares_api_url = f'{config.param('shares', 'url')}/node_api'
    destination_folder = config.param('shares', 'folder_upload')
    # if '/' not in destination_folder:
    #    destination_folder = f'{config.param('shares','folder_upload']}/'
    # share_name, subfolder = destination_folder.split('/', 1)

    # prepare transfer spec v2 for COS
    t_spec = {
        'title': 'send using Node API and ts v2',
        'session_initiation': {
            'node_api': {
                'url': shares_api_url,
                'headers': [
                    tools.basic_auth_header_key_value(config.param('shares', 'username'), config.param('shares', 'password'))
                ]
            }
        },
        'direction': 'send',
        'assets': {
            'destination_root': destination_folder,
            'paths': []
        }
    }

    # add file list in transfer spec
    for f in config.file_list():
        # note: Shares API requires both source and destination to be set (unlike real node api)
        destination = f.split('/')[-1]
        # if subfolder:
        # destination = f'{destination_folder}/{destination}'
        t_spec['assets']['paths'].append(
            {'source': f,
             'destination': destination})

    # start transfer, using Transfer SDK
    transfer_client.start_transfer_and_wait(t_spec)
finally:
    transfer_client.shutdown()
