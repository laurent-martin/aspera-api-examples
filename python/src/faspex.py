#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Send a package using Faspex 4 API v3
import utils.tools
import utils.transfer_client
import utils.rest
import logging

test_env = utils.tools.Tools()
transfer_client = utils.transfer_client.TransferClient(test_env).startup()

try:
    # get configuration parameters from config file
    config = test_env.conf('faspex')

    faspex_api = utils.rest.Rest(
        config['url'],
        user=config['user'],
        password=config['pass'],
        # verify certificate if not explicitly set to False
        verify=not ('verify' in config and config['verify'] is False),
    )

    # files to send
    package_files = test_env.file_list()

    # package creation information for Faspex API v3 : POST /send
    logging.info('Creating package')
    response_data = faspex_api.post('send', {
        'delivery': {
            'title': 'Sent from python example',
            'recipients': ['admin'],
            'sources': [{'paths': package_files}],
        }
    })
    logging.debug('resp=%s', response_data)

    if 'error' in response_data:
        raise Exception(response_data['error']['internal_message'])

    # get transfer spec returned by Faspex
    t_spec = response_data['xfer_sessions'][0]

    # add file list in transfer spec
    t_spec['paths'] = []
    for f in package_files:
        t_spec['paths'].append({'source': f})

    # send files into package
    transfer_client.start_transfer_and_wait(t_spec)
finally:
    transfer_client.shutdown()
