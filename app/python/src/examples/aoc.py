#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Aspera on Cloud
# Send a package to shared inbox (name in config file) in given workspace (name in config file)
import utils.configuration
import utils.transfer_client
import utils.rest
import logging as log
import uuid
import base64

# AoC API base URL: https://developer.ibm.com/apis/catalog?search=%22aspera%20on%20cloud%20api%22
AOC_API_V1_BASE_URL = 'https://api.ibmaspera.com/api/v1'
AOC_OAUTH_AUDIENCE = 'https://api.asperafiles.com/api/v1/oauth2/token'

# name of package to send
package_name = 'sample package Python'

# number of parallel transfer sessions (typically, 1)
transfer_sessions = 1

config = utils.configuration.Configuration()
transfer_client = utils.transfer_client.TransferClient(config).startup()


def generate_cookie(app: str, user_name: str, user_id: str) -> str:
    encoded_app = base64.b64encode(app.encode('utf-8')).decode('utf-8')
    encoded_user_name = base64.b64encode(user_name.encode('utf-8')).decode('utf-8')
    encoded_user_id = base64.b64encode(user_id.encode('utf-8')).decode('utf-8')
    return f"aspera.aoc:{encoded_app}:{encoded_user_name}:{encoded_user_id}"


try:
    aoc_api = utils.rest.Rest(AOC_API_V1_BASE_URL)
    aoc_api.setAuthBearer({
        'token_url': f'{AOC_API_V1_BASE_URL}/oauth2/{config.param('aoc', 'org')}/token',
        'key_pem_path': config.param('aoc', 'private_key'),
        'client_id': config.param('aoc', 'client_id'),
        'client_secret': config.param('aoc', 'client_secret'),
        'iss': config.param('aoc', 'client_id'),
        'aud': AOC_OAUTH_AUDIENCE,
        'sub': config.param('aoc', 'user_email'),
        'org': config.param('aoc', 'org'),
    })
    aoc_api.setDefaultScope('user:all')

    # get my user information (get my name, etc...)
    user_info = aoc_api.read('self')
    log.debug(user_info)

    # get workspace information
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

    # Create a new package (this allocates a reception folder on package storage)
    # `sent` and `transfers_expected` could also be added on a later call with PUT packages/{package_info["id"]}
    log.info('creating package')
    package_info = aoc_api.create('packages', {
        'workspace_id': workspace_info['id'],
        'recipients': [{'id': dropbox_info['id'], 'type': 'dropbox'}],
        'name': package_name,
        'note': 'My package note',
        'sent': True,
        'transfers_expected': transfer_sessions,
    })
    log.debug(package_info)

    #  get node information for the node on which package must be created
    log.info('getting node information')
    node_info = aoc_api.read(f'nodes/{package_info["node_id"]}')
    log.debug(node_info)

    # Note: generate a bearer token for the node on which package was created
    # (not all tags are mandatory, but some are, like 'node')
    t_spec = {
        'direction': 'send',
        'token': aoc_api.getBearerTokenAuthorization(f"node.{node_info['access_key']}:user:all"),
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
                'xfer_retry': 3600,
            }
        },
        'remote_host': node_info['host'],
        'remote_user': 'xfer',
        'ssh_port': 33001,
        'fasp_port': 33001,
        'cookie': generate_cookie('packages', user_info['name'], user_info['email']),
        'create_dir': True,
        'target_rate_kbps': 2000000,
        'paths': []
    }

    if transfer_sessions != 1:
        t_spec['multi_session'] = transfer_sessions
        t_spec['multi_session_threshold'] = 500000

    # add file list in transfer spec
    config.add_sources(t_spec, 'paths')

    # Finally send files to package folder on server
    transfer_client.start_transfer_and_wait(t_spec)
finally:
    transfer_client.shutdown()
