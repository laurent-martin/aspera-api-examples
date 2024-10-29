#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Send a package using Faspex 4 API v3
import utils.configuration
import utils.transfer_client
import utils.rest
import logging as log

config = utils.configuration.Configuration()
transfer_client = utils.transfer_client.TransferClient(config).startup()

try:
    faspex_api = utils.rest.Rest(config.param('faspex', 'url'))
    faspex_api.setAuthBasic(config.param('faspex', 'username'), config.param('faspex', 'password'))
    faspex_api.setVerify(config.param('faspex', 'verify', True))

    # package creation information for Faspex API v3 : POST /send
    log.info('Creating package')
    response_data = faspex_api.create('send', {
        'delivery': {
            'title': 'Sent from python example',
            'recipients': ['admin'],
            'sources': [{'paths': config.file_list()}],
        }
    })
    log.debug('resp=%s', response_data)

    if 'error' in response_data:
        raise Exception(response_data['error']['internal_message'])

    # get transfer spec returned by Faspex
    t_spec = response_data['xfer_sessions'][0]

    # add file list in transfer spec
    config.add_sources(t_spec, 'paths')

    # send files into package
    transfer_client.start_transfer_and_wait(t_spec)
finally:
    transfer_client.shutdown()
