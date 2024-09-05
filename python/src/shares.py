#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Upload files to Aspera Shares (similar as node api)
import utils.tools
import utils.transfer_client
import utils.rest
import logging

test_env = utils.tools.Tools()
transfer_client = utils.transfer_client.TransferClient(test_env).startup()

try:
    # get file to upload from command line
    files_to_upload = test_env.file_list()

    # get Shares information from config file
    config = test_env.conf('shares')

    shares_api = utils.rest.Rest(
        base_url=f'{config['url']}/node_api',
        user=config['user'],
        password=config['pass'],
        # verify certificate if not explicitly set to False
        verify=not ('verify' in config and config['verify'] is False),
    )

    # call Node API with a single transfer request to get one transfer spec with Aspera token
    logging.info('Generating transfer spec')
    response_data = shares_api.post('files/upload_setup', {
        'transfer_requests': [
            {'transfer_request': {'paths': [{'destination': config['folder_upload']}]}}
        ]
    })

    # extract the single transfer spec (we sent a single transfer request)
    t_spec = response_data['transfer_specs'][0]['transfer_spec']

    # add file list in transfer spec
    t_spec['paths'] = []
    for f in files_to_upload:
        t_spec['paths'].append({'source': f})

    # start transfer, using Transfer SDK
    transfer_client.start_transfer_and_wait(t_spec)
finally:
    transfer_client.shutdown()
