#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Upload files Shares (Node) API and transfer spec v2
# Note: Transfer SDK may have a bug that make this work only if the share name is equal to the folder name on node.
import test_environment
import base64
import logging

# get file to upload from command line
files_to_upload = test_environment.file_list

# get Shares information from config file
config = test_environment.get_configuration('shares')

shares_api_url = f'{config['url']}/node_api'

# prepare transfer spec v2 for COS
t_spec = {
    'title': 'send using Node API and ts v2',
    'session_initiation': {
        'node_api': {
            'url': shares_api_url,
            'headers': [
                test_environment.basic_auth_header_key_value(config['user'], config['pass'])
            ]
        }
    },
    'direction': 'send',
    'assets': {
        'destination_root': config['share'],
        'paths': []
    }
}

# add file list in transfer spec
for f in files_to_upload:
    # note: Shares API requires both source and destination to be set (unlike real node api)
    basename = f.split('/')[-1]
    t_spec['assets']['paths'].append(
        {'source': f,
         'destination': basename})

# start transfer, using Transfer SDK
test_environment.start_transfer_and_wait(t_spec)
