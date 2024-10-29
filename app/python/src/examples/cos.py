#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Upload files to COS using COS embedded Aspera and Aspera Gen3 Node API
import utils.configuration
import utils.transfer_client
import utils.helper_aspera_cos
import utils.rest

destination_folder = '/'

config = utils.configuration.Configuration()
transfer_client = utils.transfer_client.TransferClient(config).startup()

try:
    # get Aspera Transfer Service Node information using service credential file
    # config=config.param('coscreds')
    # with open(config.param('cos','service_credential_file']) as f:
    #    credentials = json.load(f)
    # info=utils.helper_aspera_cos.from_service_credentials(credentials=credentials,region=config.param('cos','region'])
    # cos_node_info=utils.helper_aspera_cos.node(bucket=config.param('cos','bucket'],endpoint=info['endpoint'],key=info['key'],crn=info['crn'])

    # get Aspera Transfer Service Node information for specified COS bucket
    cos_node_info = utils.helper_aspera_cos.node(
        bucket=config.param('cos', 'bucket'),
        endpoint=config.param('cos', 'endpoint'),
        key=config.param('cos', 'key'),
        crn=config.param('cos', 'crn'),
        auth=config.param('cos', 'auth'),
    )

    node_api = utils.rest.Rest(cos_node_info['url'])
    node_api.setAuthBasic(cos_node_info['auth'][0], cos_node_info['auth'][1])
    node_api.addHeaders(cos_node_info['headers'])

    # call Node API with one transfer request to get one transfer spec
    response_data = node_api.post('files/upload_setup', {
        'transfer_requests': [
            {'transfer_request': {'paths': [{'destination': destination_folder}]}}
        ]
    })

    # extract the single transfer spec (we sent a single transfer request)
    t_spec = response_data['transfer_specs'][0]['transfer_spec']

    # add COS specific authorization info
    t_spec.update(cos_node_info['tspec'])

    # add file list in transfer spec
    config.add_sources(t_spec, 'paths')

    # start transfer
    transfer_client.start_transfer_and_wait(t_spec)
finally:
    transfer_client.shutdown()
