#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Aspera on Cloud
# Send a package to shared inbox (name in config file) in given workspace (name in config file)
import test_environment
import requests
import requests.auth
import logging
import jwt
import calendar
import time
import uuid

# take 5 minutes back to account for time offset
JWT_NOT_BEFORE_OFFSET_SEC = 300
# one hour validity
JWT_EXPIRY_OFFSET_SEC = 3600

# AoC API : https://developer.ibm.com/apis/catalog?search=%22aspera%20on%20cloud%20api%22
AOC_API_BASE = 'https://api.ibmaspera.com/api/v1/'

# Arg1: name of package
package_name = 'sample package'

# Arg2: number of // transfer sessions (typically, 1)
transfer_sessions = 1

# Arg3 and next: list of files to send
package_files = test_environment.file_list

# get configuration parameters from config file
config = test_environment.CONFIG['aoc']


def get_bearer(scope):
    '''generate a bearer token for given scope using AoC API'''
    with open(config['private_key']) as fin:
        private_key_pem = fin.read()

    seconds_since_epoch = int(calendar.timegm(time.gmtime()))

    jwt_payload = {
        'iss': config['client_id'],  # issuer
        'sub': config['user_email'],  # subject
        'aud': 'https://api.asperafiles.com/api/v1/oauth2/token',  # audience
        'nbf': seconds_since_epoch - JWT_NOT_BEFORE_OFFSET_SEC,  # not before
        'exp': seconds_since_epoch + JWT_EXPIRY_OFFSET_SEC,  # expiration
        'org': config['org'],
    }
    logging.debug(jwt_payload)

    data = {
        'scope': scope,
        'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        'assertion': jwt.encode(jwt_payload, private_key_pem, algorithm='RS256'),
    }

    response = requests.post(
        url=f'{AOC_API_BASE}oauth2/{config["org"]}/token',
        auth=requests.auth.HTTPBasicAuth(config['client_id'], config['client_secret']),
        data=data,
        headers={
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
        },
    )
    response.raise_for_status()
    response_data = response.json()

    return f'Bearer {response_data["access_token"]}'


# Headers for authorization to AoC API
# bearer token is valid for some time and can (should) be re-used, until expired, then refresh it
request_headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': get_bearer('user:all'),
}

# simple api call:
# response = requests.get(f'{AOC_API_BASE}self', headers=request_headers)

# Get workspace information (workspace name in config file)
response = requests.get(
    url=f'{AOC_API_BASE}workspaces',
    headers=request_headers,
    params={'q': config['workspace']},
)
response.raise_for_status()
response_data = response.json()
logging.debug(response_data)
if len(response_data) != 1:
    raise Exception('Error: length = %s' % len(response_data))
workspace_info = response_data[0]

# Get dropbox information (shared inbox name in config file)
response = requests.get(
    url=f'{AOC_API_BASE}dropboxes',
    headers=request_headers,
    params={'current_workspace_id': workspace_info['id'], 'q': config['shared_inbox']},
)
response.raise_for_status()
response_data = response.json()
logging.debug(response_data)
if len(response_data) != 1:
    raise Exception('Error: length = %s' % len(response_data))
dropbox_info = response_data[0]

# build package creation information
package_creation = {
    'workspace_id': workspace_info['id'],
    'recipients': [{'id': dropbox_info['id'], 'type': 'dropbox'}],
    'name': package_name,
    'note': 'My package note',
}

#  create a new package (this allocates a reception folder on package storage)
response = requests.post(
    url=f'{AOC_API_BASE}packages',
    headers=request_headers,
    json=package_creation
)
response.raise_for_status()
package_info = response.json()
logging.debug(package_info)

#  get node information for the node on which package must be created
response = requests.get(
    url=f'{AOC_API_BASE}nodes/{package_info["node_id"]}',
    headers=request_headers
)
response.raise_for_status()
node_info = response.json()
logging.debug(node_info)

# tell Aspera how many transfers to expect in package (can also be done after transfer)
response = requests.put(
    url=f'{AOC_API_BASE}packages/{package_info["id"]}',
    headers=request_headers,
    json={'sent': True, 'transfers_expected': transfer_sessions},
)
response.raise_for_status()

# Note: generate a bearer token for the node on which package was created
# (all tags are not mandatory, but some are, like 'node')
t_spec = {
    'direction': 'send',
    'token': get_bearer('node.%s:user:all' % node_info['access_key']),
    'tags': {
        'aspera': {
            'app': 'packages',
            'files': {
                'node_id': node_info['id'],
                'package_id': package_info['id'],
                'package_name': package_info['name'],
                'package_operation': 'upload',
                'files_transfer_action': 'upload_package',
                'workspace_name': workspace_info['name'],
                'workspace_id': workspace_info['id'],
            },
            'node': {
                'access_key': node_info['access_key'],
                'file_id': package_info['contents_file_id'],
            },
            'usage_id': 'aspera.files.workspace.%s' % workspace_info['id'],
            'xfer_id': str(uuid.uuid4()),
            'xfer_retry': 3600,
        }
    },
    'remote_user': 'xfer',
    'ssh_port': 33001,
    'fasp_port': 33001,
    'remote_host': node_info['host'],
    # 'cookie': 'aspera.aoc:cGFja2FnZXM=:TGF1cmVudCBNYXJ0aW4=:bGF1cmVudC5tYXJ0aW4uYXNwZXJhQGZyLmlibS5jb20=',
    'create_dir': True,
    'target_rate_kbps': 2000000,
}

if transfer_sessions != 1:
    t_spec['multi_session'] = transfer_sessions
    t_spec['multi_session_threshold'] = 500000

# add file list in transfer spec
t_spec['paths'] = []
for f in package_files:
    t_spec['paths'].append({'source': f})

# Finally send files to package folder on server
test_environment.start_transfer_and_wait(t_spec)
