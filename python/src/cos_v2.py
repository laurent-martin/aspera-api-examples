#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Upload files to COS using COS embedded Aspera and Transfer SDK and transfer spec v2
import test_environment
import logging


# get file to upload from command line
files_to_upload = test_environment.file_list

# get node information from config file
config = test_environment.CONFIG['cos']
destination_folder = '/'

# prepare transfer spec v2 for COS
t_spec = {
    'title': 'send to COS using ts v2',
    'direction': 'send',
    'assets': {
        'destination_root': destination_folder,
    },
    'session_initiation': {
        'icos': {
            'api_key': config['key'],
            'bucket': config['bucket'],
            'ibm_service_instance_id': config['crn'],
            'ibm_service_endpoint': config['endpoint'],
        }
    },
}

# add file list in transfer spec
t_spec['assets']['paths'] = []
for f in files_to_upload:
    t_spec['assets']['paths'].append({'source': f})
logging.debug(t_spec)

# start transfer, using Transfer SDK
test_environment.start_transfer_and_wait(t_spec)
