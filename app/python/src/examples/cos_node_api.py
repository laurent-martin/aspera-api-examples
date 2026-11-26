#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Use Node API with COS credentials
import utils.configuration
import utils.helper_aspera_cos
import utils.rest
import logging as log

config = utils.configuration.Configuration()

# get Aspera Transfer Service Node information for specified COS bucket
node_info = utils.helper_aspera_cos.node(
    bucket=config.param('cos', 'bucket'),
    endpoint=config.param('cos', 'endpoint'),
    key=config.param('cos', 'key'),
    crn=config.param('cos', 'crn'),
    auth=config.param('cos', 'auth'),
)

node_api = utils.rest.Rest(node_info['url'])
node_api.setAuthBasic(node_info['auth'][0], node_info['auth'][1])
node_api.addHeaders(node_info['headers'])

# call Aspera Node API: list transfers that occurred in the last day.
# filtering options possible.
transfer_list = node_api.read('ops/transfers')

utils.configuration.log_dump('Transfers', transfer_list, log.INFO)
