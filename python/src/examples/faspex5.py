#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Faspex 5
# Send a package to myself
import utils.configuration
import utils.transfer_client
import utils.rest
import logging as log
import time

# base path for v5 api
F5_API_PATH_V5 = '/api/v5'
# path for oauth2 token generation
F5_API_PATH_TOKEN = '/auth/token'

# number of // transfer sessions (typically, 1)
transfer_sessions = 1

# get testing environment configuration
config = utils.configuration.Configuration()

# start local transfer SDK and get its gRPC API for locally initiated transfers
transfer_client = utils.transfer_client.TransferClient(config).startup()

try:
    # Get access to the Faspex 5 API
    #

    # bearer token is valid for some time and can (should) be re-used, until expired, then refresh it
    # in this example we generate a new bearer token for each script invocation
    f5_api = utils.rest.Rest(f'{config.param("faspex5", "url")}{F5_API_PATH_V5}')
    f5_api.setVerify(config.param('faspex5', 'verify', True))
    f5_api.setAuthBearer({
        'token_url': f'{config.param("faspex5", "url")}{F5_API_PATH_TOKEN}',
        'key_pem_path': config.param('faspex5', 'private_key'),
        'client_id': config.param('faspex5', 'client_id'),
        'client_secret': config.param('faspex5', 'client_secret'),
        'iss': config.param('faspex5', 'client_id'),
        'aud': config.param('faspex5', 'client_id'),
        'sub': f'user:{config.param("faspex5", "username")}',
    })
    f5_api.setDefaultScope()

    # Example: Create a package with local files
    #

    # create a new package with Faspex 5 API (this allocates a reception folder on package storage)
    log.info(f'Creating package for local files')
    package_info = f5_api.create('packages', {
        'title': "Python local files ",
        'recipients': [{'name': config.param('faspex5', 'username')}],  # send to myself (for test)
    })
    log.debug(package_info)

    # build payload to specify files to send
    upload_request = {}
    config.add_sources(upload_request, 'paths')

    log.info('getting transfer spec')
    t_spec = f5_api.create(f'packages/{package_info["id"]}/transfer_spec/upload?transfer_type=connect', upload_request)

    # optional: multi session
    if transfer_sessions != 1:
        t_spec['multi_session'] = transfer_sessions
        t_spec['multi_session_threshold'] = 500000

    # add file list in transfer spec
    config.add_sources(t_spec, 'paths')

    # not used in transfer sdk
    del t_spec['authentication']

    # Finally send files to package folder on server
    transfer_client.start_transfer_and_wait(t_spec)

    # Example: Create package from a remote source
    #

    # create a new package with Faspex 5 API (this allocates a reception folder on package storage)
    log.info(f'Creating package for remote files')
    package_info = f5_api.create('packages', {
        'title': "Python remote files ",
        'recipients': [{'name': config.param('faspex5', 'username')}],  # send to myself (for test)
    })
    log.debug(package_info)

    # In this example, we have the name, not the id of the shared folder
    # so we need to get the id from the name
    shared_folder_name = config.param('faspex5', 'shared_folder_name')
    shared_folders = f5_api.read(f'shared_folders')
    folder_id = next((folder['id'] for folder in shared_folders['shared_folders'] if folder['name'] == shared_folder_name), None)
    if not folder_id:
        raise Exception(f'No shared folder found with name {shared_folder_name}')

    log.info(f'Starting server side transfer using remote folder: {folder_id}')
    upload_request = {
        "shared_folder_id": folder_id,
        "paths": [
            config.param('faspex5', 'shared_folder_file')
        ]
    }
    transfer_info = f5_api.create(f'packages/{package_info["id"]}/remote_transfer', upload_request)
    log.info(f'id: {transfer_info}')

    while True:
        transfer_info = f5_api.read(f'packages/{package_info["id"]}/upload_details')
        log.info(f'status: {transfer_info["upload_status"]}')
        if transfer_info['upload_status'] == 'completed':
            break
        elif transfer_info['upload_status'] == 'failed':
            raise "Remote transfer failed"
        time.sleep(1)

finally:
    transfer_client.shutdown()
