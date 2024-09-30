#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Upload files to COS using COS embedded Aspera and Transfer SDK and transfer spec v2
import utils.configuration
import utils.transfer_client

config = utils.configuration.Configuration()
transfer_client = utils.transfer_client.TransferClient(config).startup()

try:
    # get file to upload from command line
    files_to_upload = config.file_list()
    destination_folder = '/'

    # prepare transfer spec v2 for COS
    t_spec = {
        'title': 'send to COS using ts v2',
        'session_initiation': {
            'icos': {
                'api_key': config.param('cos', 'key'),
                'bucket': config.param('cos', 'bucket'),
                'ibm_service_instance_id': config.param('cos', 'crn'),
                'ibm_service_endpoint': config.param('cos', 'endpoint'),
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
    transfer_client.start_transfer_and_wait(t_spec)
finally:
    transfer_client.shutdown()
