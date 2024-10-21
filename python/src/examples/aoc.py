#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Aspera on Cloud
# Send a package to shared inbox (name in config file) in given workspace (name in config file)
import utils.configuration
import utils.transfer_client
import utils.rest
import requests
import requests.auth
import logging as log
import jwt
import calendar
import time
import uuid

# take 5 minutes back to account for time offset between client and server
JWT_NOT_BEFORE_OFFSET_SEC = 300
# one hour validity for token
JWT_EXPIRY_OFFSET_SEC = 3600

# AoC API base URL: https://developer.ibm.com/apis/catalog?search=%22aspera%20on%20cloud%20api%22
AOC_API_V1_BASE_URL = 'https://api.ibmaspera.com/api/v1'
AOC_OAUTH_AUDIENCE = 'https://api.asperafiles.com/api/v1/oauth2/token'

# name of package to send
package_name = 'sample package'

# number of parallel transfer sessions (typically, 1)
transfer_sessions = 1

config = utils.configuration.Configuration()
transfer_client = utils.transfer_client.TransferClient(config).startup()

try:
    aoc_api = utils.rest.Rest(AOC_API_V1_BASE_URL)
    aoc_api.setAuthBearer(
        token_url=f'{AOC_API_V1_BASE_URL}/oauth2/{config.param('aoc', 'org')}/token',
        key_pem_path=config.param('aoc', 'private_key'),
        client_id=config.param('aoc', 'client_id'),
        client_secret=config.param('aoc', 'client_secret'),
        iss=config.param('aoc', 'client_id'),
        aud=AOC_OAUTH_AUDIENCE,
        sub=config.param('aoc', 'user_email'),
        add={'org': config.param('aoc', 'org')},
    )
    aoc_api.setDefaultScope('user:all')

    # simple api call:
    # response_data = aoc_api.read('self')
    workspace_name = config.param('aoc', 'workspace')
    log.info(f'getting workspace information for {workspace_name}')
    response_data = aoc_api.read('workspaces', params={'q': workspace_name})
    log.debug(response_data)
    if len(response_data) != 1:
        raise Exception(f'Found {len(response_data)} workspace for {workspace_name}')
    workspace_info = response_data[0]

    # Get dropbox information (shared inbox name in config file)
    shared_inbox_name = config.param('aoc', 'shared_inbox')
    log.info('getting shared inbox information')
    response_data = aoc_api.read('dropboxes', params={'current_workspace_id': workspace_info['id'], 'q': shared_inbox_name})
    log.debug(response_data)
    if len(response_data) != 1:
        raise Exception(f'Found {len(response_data)} dropbox for {shared_inbox_name}')
    dropbox_info = response_data[0]

    #  create a new package (this allocates a reception folder on package storage)
    log.info('creating package')
    package_info = aoc_api.create('packages', {
        'workspace_id': workspace_info['id'],
        'recipients': [{'id': dropbox_info['id'], 'type': 'dropbox'}],
        'name': package_name,
        'note': 'My package note',
    })
    log.debug(package_info)

    #  get node information for the node on which package must be created
    log.info('getting node information')
    node_info = aoc_api.read(f'nodes/{package_info["node_id"]}')
    log.debug(node_info)

    # tell Aspera how many transfers to expect in package (can also be done after transfer)
    log.info('telling expected transfers')
    aoc_api.update(
        f'packages/{package_info["id"]}',
        {'sent': True, 'transfers_expected': transfer_sessions},
    )

    # Note: generate a bearer token for the node on which package was created
    # (all tags are not mandatory, but some are, like 'node')
    t_spec = {
        'direction': 'send',
        'token': aoc_api.getBearerToken(f"node.{node_info['access_key']}:user:all"),
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
                'usage_id': f"aspera.files.workspace.{workspace_info['id']}",
                'xfer_id': str(uuid.uuid4()),
                'xfer_retry': 3600,
            }
        },
        'remote_host': node_info['host'],
        'remote_user': 'xfer',
        'ssh_port': 33001,
        'fasp_port': 33001,
        # 'cookie': 'aspera.aoc:cGFja2FnZXM=:TGF1cmVudCBNYXJ0aW4=:bGF1cmVudC5tYXJ0aW4uYXNwZXJhQGZyLmlibS5jb20=',
        'create_dir': True,
        'target_rate_kbps': 2000000,
        'paths': []
    }

    if transfer_sessions != 1:
        t_spec['multi_session'] = transfer_sessions
        t_spec['multi_session_threshold'] = 500000

    # add file list in transfer spec
    for f in config.file_list():
        t_spec['paths'].append({'source': f})

    # Finally send files to package folder on server
    transfer_client.start_transfer_and_wait(t_spec)
finally:
    transfer_client.shutdown()
