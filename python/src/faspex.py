#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Send a package using Faspex 4 API v3
import test_environment
import requests
import requests.auth
import logging
import json

# get configuration parameters from config file
config = test_environment.CONFIG['faspex']

# verify certificate if not explicitly set to False
verify_cert = not ('verify' in config and config['verify'] is False)

# files to send
package_files = test_environment.file_list

# package creation information for Faspex API v3 : POST /send
delivery_info = {
    'delivery': {
        'title': 'Sent from python example',
        'recipients': ['admin'],
        'sources': [{'paths': package_files}],
    }
}

# create package and get information for file upload (transfer spec)
response = requests.post(
    config['url'] + '/send',
    auth=requests.auth.HTTPBasicAuth(config['user'], config['pass']),
    headers={'Content-Type': 'application/json', 'Accept': 'application/json'},
    data=json.dumps(delivery_info),
    verify=verify_cert
)
response_data = response.json()

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
test_environment.start_transfer_and_wait(t_spec)
