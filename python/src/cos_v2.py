#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Upload files to COS using COS embedded Aspera and Transfer SDK and transfer spec v2
import utils.test_environment
import logging

test_env = utils.test_environment.TestEnvironment().setup()

try:
    # get node information from config file
    config = test_env.get_configuration('cos')

    # get file to upload from command line
    files_to_upload = test_env.file_list()
    destination_folder = '/'

    # prepare transfer spec v2 for COS
    t_spec = {
        'title': 'send to COS using ts v2',
        'session_initiation': {
            'icos': {
                'api_key': config['key'],
                'bucket': config['bucket'],
                'ibm_service_instance_id': config['crn'],
                'ibm_service_endpoint': config['endpoint'],
            }
        },
        'direction': 'send',
        'assets': {
            'destination_root': destination_folder,
            'paths': []
        },
    }

    # add file list in transfer spec
    for f in files_to_upload:
        t_spec['assets']['paths'].append({'source': f})

    # start transfer, using Transfer SDK
    test_env.start_transfer_and_wait(t_spec)
finally:
    test_env.shutdown()
