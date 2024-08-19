#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Upload files using node API and transfer spec v2
import test_environment
# import base64
import logging


# get file to upload from command line
files_to_upload = test_environment.file_list

# get node information from config file
config = test_environment.get_configuration('node')

# prepare transfer spec v2 for COS
t_spec = {
    'title': 'send using Node API and ts v2',
    'direction': 'send',
    'assets': {
        'destination_root': config['folder_upload'],
    },
    'session_initiation': {
        'node_api': {
            'url': config['url'],
            'headers': [
                test_environment.basic_auth_header_key_value(config['user'], config['pass'])
            ]
        }
    }
}

# add file list in transfer spec
t_spec['assets']['paths'] = []
for f in files_to_upload:
    t_spec['assets']['paths'].append({'source': f})
logging.debug(t_spec)

# start transfer, using Transfer SDK
test_environment.start_transfer_and_wait(t_spec)
