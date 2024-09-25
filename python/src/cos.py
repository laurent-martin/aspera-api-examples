#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Upload files to COS using COS embedded Aspera and Aspera Gen3 Node API
import utils.configuration
import utils.transfer_client
import utils.helper_aspera_cos
import utils.rest

destination_folder = '/'

test_env = utils.configuration.Configuration()
transfer_client = utils.transfer_client.TransferClient(test_env).startup()

try:
    # get file to upload from command line
    files_to_upload = test_env.file_list()

    # get Aspera Transfer Service Node information using service credential file
    # config=test_env.conf('coscreds')
    # with open(config['service_credential_file']) as f:
    #    credentials = json.load(f)
    # info=utils.helper_aspera_cos.from_service_credentials(credentials=credentials,region=config['region'])
    # cos_node_info=utils.helper_aspera_cos.node(bucket=config['bucket'],endpoint=info['endpoint'],key=info['key'],crn=info['crn'])

    # get configuration parameters from config file
    config = test_env.conf('cos')

    # get Aspera Transfer Service Node information for specified COS bucket
    cos_node_info = utils.helper_aspera_cos.node(
        bucket=config['bucket'],
        endpoint=config['endpoint'],
        key=config['key'],
        crn=config['crn'],
        auth=config['auth'],
    )

    node_api = utils.rest.Rest(
        base_url=cos_node_info['url'],
        auth=cos_node_info['auth'],
        headers=cos_node_info['headers'],
    )

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
    t_spec['paths'] = []
    for f in files_to_upload:
        t_spec['paths'].append({'source': f})

    # start transfer
    transfer_client.start_transfer_and_wait(t_spec)
finally:
    transfer_client.shutdown()
