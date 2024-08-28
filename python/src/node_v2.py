#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Upload files using node API and transfer spec v2
import utils.test_environment
import logging

test_env = utils.test_environment.TestEnvironment()

# get file to upload from command line
files_to_upload = test_env.file_list()

# get node information from config file
config = test_env.get_configuration('node')

# prepare transfer spec v2 for COS
t_spec = {
    'title': 'send using Node API and ts v2',
    'session_initiation': {
        'node_api': {
            'url': config['url'],
            'headers': [
                test_env.basic_auth_header_key_value(config['user'], config['pass'])
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
for f in files_to_upload:
    t_spec['assets']['paths'].append({'source': f})

# start transfer, using Transfer SDK
test_env.start_transfer_and_wait(t_spec)
