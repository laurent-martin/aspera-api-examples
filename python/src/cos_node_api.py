#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Use Node API with COS credentials
import test_environment
import helper_aspera_cos
import requests

# get Aspera Transfer Service Node information for specified COS bucket
config = test_environment.CONFIG['cos']
node_info = helper_aspera_cos.node(
    bucket=config['bucket'],
    endpoint=config['endpoint'],
    key=config['key'],
    crn=config['crn'],
    auth=config['auth'],
)

# headers for HTTP request
request_headers = {'Content-Type': 'application/json', 'Accept': 'application/json'}

# update with generated credentials
request_headers.update(node_info['headers'])

# call Aspera Node API: list transfers that occurred in the last day.
# filtering options possible.
response = requests.get(
    node_info['url'] + '/ops/transfers', auth=node_info['auth'], headers=request_headers
)
if response.status_code != 200:
    raise Exception('an error occurred')

print(response.json())
