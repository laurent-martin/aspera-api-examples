#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Use Node API with COS credentials
import utils.configuration
import utils.transfer_client
import utils.helper_aspera_cos
import utils.rest
import logging as log

config = utils.configuration.Configuration()
transfer_client = utils.transfer_client.TransferClient(config)

try:
    node_info = utils.helper_aspera_cos.node(
        bucket=config.param('cos', 'bucket'),
        endpoint=config.param('cos', 'endpoint'),
        key=config.param('cos', 'key'),
        crn=config.param('cos', 'crn'),
        auth=config.param('cos', 'auth'),
    )

    node_api = utils.rest.Rest(
        base_url=node_info['url'],
        auth=node_info['auth'],
        headers=node_info['headers'],
    )

    # call Aspera Node API: list transfers that occurred in the last day.
    # filtering options possible.
    transfer_list = node_api.get('ops/transfers')

    log.info('transfers: %s', transfer_list)

finally:
    # no need shutdown, as we did not setup a server
    pass
