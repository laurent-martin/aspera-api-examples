#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Upload files to COS using COS embedded Aspera and Aspera Gen3 Node API
import test_environment
import helper_aspera_cos
import requests
import json

# get file to upload from command line
files_to_upload = test_environment.file_list
destination_folder = '/'

# get Aspera Transfer Service Node information using service credential file
# config=test_environment.CONFIG['coscreds']
# with open(config['service_credential_file']) as f:
#    credentials = json.load(f)
# info=helper_aspera_cos.from_service_credentials(credentials=credentials,region=config['region'])
# node_info=helper_aspera_cos.node(bucket=config['bucket'],endpoint=info['endpoint'],key=info['key'],crn=info['crn'])

# get Aspera Transfer Service Node information for specified COS bucket
config = test_environment.CONFIG['cos']
node_info = helper_aspera_cos.node(
    bucket=config['bucket'],
    endpoint=config['endpoint'],
    key=config['key'],
    crn=config['crn'],
    auth=config['auth'],
)

# prepare node API request for upload_setup
upload_setup_request = {
    'transfer_requests': [
        {'transfer_request': {'paths': [{'destination': destination_folder}]}}
    ]
}

request_headers = {'Content-Type': 'application/json', 'Accept': 'application/json'}

request_headers.update(node_info['headers'])

# call Node API with one transfer request to get one transfer spec
response = requests.post(
    node_info['url'] + '/files/upload_setup',
    auth=node_info['auth'],
    data=json.dumps(upload_setup_request),
    headers=request_headers,
)
if response.status_code != 200:
    raise Exception('error')

response_data = response.json()

# extract the single transfer spec (we sent a single transfer request)
t_spec = response_data['transfer_specs'][0]['transfer_spec']

# add COS specific authorization info
t_spec.update(node_info['tspec'])

# add file list in transfer spec
t_spec['paths'] = []
for f in files_to_upload:
    t_spec['paths'].append({'source': f})

# start transfer
test_environment.start_transfer_and_wait(t_spec)
