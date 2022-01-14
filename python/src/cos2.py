#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
import test_environment
import helper_aspera_cos
import logging
import json
import sys

if test_environment.CONFIG['sdk'] != "transfer":
    raise Exception('Example only for transfer SDK using transfer spec v2')

# get file to upload from command line
files_to_upload = sys.argv[1:]
destination_folder = '/'

# get Aspera Transfer Service Node information for specified COS bucket
config = test_environment.CONFIG['cos']

# prepare transfer spec v2 for COS
t_spec = {
    'title':'send to COS using tsv2',
    'direction':'send',
    'assets':{
        'destination_root':destination_folder,
    },
    'session_initiation':{
        'icos': {
            'api_key': config['key'],
            'bucket': config['bucket'],
            'ibm_service_instance_id': config['crn'],
            'ibm_service_endpoint': config['endpoint']
        }
    }
}

# add file list in transfer spec
t_spec['assets']['paths'] = []
for f in files_to_upload:
    t_spec['assets']['paths'].append({'source':f})

# start transfer, using Transfer SDK
test_environment.start_transfer_and_wait(t_spec)