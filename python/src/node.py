#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Upload files using an Aspera Transfer token, generated using node API (upload_setup)
import utils.test_environment
import utils.rest
import logging

test_env = utils.test_environment.TestEnvironment().setup()

try:
    # get node information from config file
    config = test_env.get_configuration('node')

    node_api = utils.rest.Rest(
        config['url'],
        user=config['user'],
        password=config['pass'],
        # verify certificate if not explicitly set to False
        verify=not ('verify' in config and config['verify'] is False),
    )

    # call Node API with a single transfer request to get one transfer spec with Aspera token
    logging.info('Generating transfer spec')
    response_data = node_api.post('files/upload_setup', {
        'transfer_requests': [
            {'transfer_request': {'paths': [{'destination': config['folder_upload']}]}}
        ]
    })

    # extract the single transfer spec (we sent a single transfer request)
    t_spec = response_data['transfer_specs'][0]['transfer_spec']

    # add file list in transfer spec
    t_spec['paths'] = []
    for f in test_env.file_list():
        t_spec['paths'].append({'source': f})

    # start transfer, here we use the FASP Manager, but the newer Transfer SDK can be used as well
    test_env.start_transfer_and_wait(t_spec)
finally:
    test_env.shutdown()
