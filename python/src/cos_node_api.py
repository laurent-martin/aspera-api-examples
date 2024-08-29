#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Use Node API with COS credentials
import utils.test_environment
import utils.helper_aspera_cos
import utils.rest
import logging

test_env = utils.test_environment.TestEnvironment()

try:
    # get Aspera Transfer Service Node information for specified COS bucket
    config = test_env.get_configuration('cos')

    node_info = utils.helper_aspera_cos.node(
        bucket=config['bucket'],
        endpoint=config['endpoint'],
        key=config['key'],
        crn=config['crn'],
        auth=config['auth'],
    )

    node_api = utils.rest.Rest(
        base_url=node_info['url'],
        auth=node_info['auth'],
        headers=node_info['headers'],
    )

    # call Aspera Node API: list transfers that occurred in the last day.
    # filtering options possible.
    transfer_list = node_api.get('ops/transfers')

    logging.info('transfers: %s', transfer_list)

finally:
    # no need shutdown, as we did not setup a server
    pass
