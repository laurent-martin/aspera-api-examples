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

api_base_url = f'{config["url"]}/node_api'
destination_folder = config['share']

# prepare transfer spec v2 for COS
t_spec = {
    'title': 'send using Node API and ts v2',
    'direction': 'send',
    'assets': {
        'destination_root': destination_folder,
    },
    'session_initiation': {
        'node_api': {
            'url': api_base_url,
            'headers': [
                test_environment.basic_auth_header_key_value(config['user'], config['pass'])
            ]
        }
    }
}

# add file list in transfer spec
t_spec['assets']['paths'] = []
for f in files_to_upload:
    # note: Shares API requires both source and destination to be set (unlike real node api)
    basename = f.split('/')[-1]
    t_spec['assets']['paths'].append(
        {'source': f,
         'destination': basename})
logging.debug(t_spec)

# start transfer, using Transfer SDK
test_environment.start_transfer_and_wait(t_spec)
