#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Use Node API with COS credentials
import utils.test_environment
import utils.helper_aspera_cos
import requests

test_env = utils.test_environment.TestEnvironment()

# get Aspera Transfer Service Node information for specified COS bucket
config = test_env.get_configuration('cos')

node_info = utils.helper_aspera_cos.node(
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
    url=f'{node_info["url"]}/ops/transfers',
    auth=node_info['auth'],
    headers=request_headers
)
if response.status_code != 200:
    raise Exception('an error occurred')

print(response.json())
