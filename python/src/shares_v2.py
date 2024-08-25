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
destination_folder = config['folder_upload']
# if '/' not in destination_folder:
#    destination_folder = f'{config['folder_upload']}/'
# share_name, subfolder = destination_folder.split('/', 1)


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
        'destination_root': destination_folder,
        'paths': []
    }
}

# add file list in transfer spec
for f in files_to_upload:
    # note: Shares API requires both source and destination to be set (unlike real node api)
    destination = f.split('/')[-1]
    # if subfolder:
    # destination = f'{destination_folder}/{destination}'
    t_spec['assets']['paths'].append(
        {'source': f,
         'destination': destination})

# start transfer, using Transfer SDK
test_environment.start_transfer_and_wait(t_spec)
