#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Send a package using Faspex 4 API v3
import test_environment
import requests
import requests.auth
import logging
import json
import sys

# files to send
package_files = sys.argv[1:]

# package creation information for Faspex API v3
delivery_info = {
    "delivery": {
        "title": "Sent from python example",
        "recipients": ["admin"],
        "sources": [{
            "paths": package_files
        }]
    }
}

# create package and get information for file upload
response = requests.post(
    test_environment.CONFIG['faspex']['url'] + '/send',
    auth=requests.auth.HTTPBasicAuth(test_environment.CONFIG['faspex']['user'],
                                     test_environment.CONFIG['faspex']['pass']),
    data=json.dumps(delivery_info),
    headers={
        "Content-Type": "application/json",
        "Accept": "application/json"
    },
    verify=False)
response_data = response.json()

logging.debug("resp=%s", response_data)

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
