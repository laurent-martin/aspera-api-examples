#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Faspex 5
# Send a package to myself
import utils.configuration
import utils.transfer_client
import utils.rest
import logging as log
import time
import re

# base path for v5 api
F5_API_PATH_V5 = '/api/v5'
# path for oauth2 token generation
F5_API_PATH_TOKEN = '/auth/token'
# recipient types (for user lookup)
RECIPIENT_TYPES = ['user', 'external_user', 'shared_inbox', 'workgroup', 'distribution_list']
# validation of email format
EMAIL_REGEX = r"^[A-Za-z0-9\.\-_%+]+@[A-Za-z0-9\.\-]+\.[A-Za-z]{2,}$"
# max wait time for server-to-server transfer
REMOTE_TRANSFER_TIMEOUT_SEC = 600


def lookup_entity(api, path, value, prop='name', query=None):
    '''
    Find an entity with an exact match on a property.

    :param api: REST client
    :param path: type of entity
    :param value: value to find
    :param prop: property to match
    :param query: additional query parameters, as list of tuples
    :return: entity, or none if not found
    '''
    query = list(query or [])
    query.append(('q', value))
    matching_items = api.read(path, query)
    # in Faspex, results are in the same key as request
    if isinstance(matching_items, dict):
        matching_items = matching_items.get(path, None)
    # Assert that matching_items is a list
    if not isinstance(matching_items, list):
        raise TypeError(f'Expecting a list, got: {type(matching_items).__name__}')
    # Filter for case-insensitive exact matches for property
    name_matches = [item for item in matching_items if item.get(prop, '').lower() == value.lower()]
    if len(name_matches) == 0:
        return None
    elif len(name_matches) > 1:
        raise ValueError(
            f'Found {len(name_matches)} {path} for {value}'
        )
    return name_matches[0]


def build_recipient_list(f5_api, emails):
    '''
    Build the list of recipients from email addresses.

    :param f5_api: REST client of Faspex 5
    :param emails: email addresses
    :return: list of recipients: `name`, `recipient_type`
    '''
    result = []
    for email in emails:
        if re.match(EMAIL_REGEX, email) is None:
            raise ValueError(f'Invalid email address: {email}')
        query = [('context', 'packages')]
        query.extend([('type[]', item) for item in RECIPIENT_TYPES])
        found = lookup_entity(
            api=f5_api,
            path='contacts',
            value=email,
            query=query)
        if not found:
            result.append({
                'recipient_type': 'external_user',
                'name': email,
            })
        else:
            result.append({
                'recipient_type': found['type'],
                'name': found['name'],
            })
    return result


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

    # send to myself (for test, existing user) and external user (the calling user must have right to do so...)
    log.info('Getting recipients')
    recipients = build_recipient_list(f5_api, [config.param('faspex5', 'username'), 'johndoe@example.com'])

    # create a new package with Faspex 5 API (this allocates a reception folder on package storage)
    log.info('Creating package')
    package_info = f5_api.create('packages', {
        'title': "Python local files ",
        'recipients': recipients
    })

    # build payload to specify files to send
    upload_request = {}
    config.add_sources(upload_request, 'paths')

    log.info('Getting transfer spec')
    # transfer_type=connect: transfer spec for a web client, also usable by the Transfer SDK
    t_spec = f5_api.create(f'packages/{package_info["id"]}/transfer_spec/upload?transfer_type=connect', upload_request)

    # optional: multi session
    if transfer_sessions != 1:
        t_spec['multi_session'] = transfer_sessions
        t_spec['multi_session_threshold'] = 500000

    # add file list in transfer spec
    config.add_sources(t_spec, 'paths')

    # remove `authentication`: not used by the Transfer SDK
    del t_spec['authentication']

    # Send local files to package folder on server and wait for completion
    log.info('Uploading files')
    transfer_client.start_transfer_and_wait(t_spec)

    # Example: Create package from a remote source
    #

    # create a new package with Faspex 5 API (this allocates a reception folder on package storage)
    log.info('Creating package')
    package_info = f5_api.create('packages', {
        'title': "Python remote files ",
        'recipients': recipients
    })

    # In this example, we have the name, not the id of the shared folder
    # so we need to get the id from the name
    shared_folder_name = config.param('faspex5', 'shared_folder_name')
    shared_folders = f5_api.read(f'shared_folders')
    folder_id = next((folder['id'] for folder in shared_folders['shared_folders'] if folder['name'] == shared_folder_name), None)
    if not folder_id:
        raise Exception(f'Shared folder not found: {shared_folder_name}')

    log.info(f'Starting remote transfer from shared folder: {shared_folder_name}')
    upload_request = {
        "shared_folder_id": folder_id,
        "paths": [
            config.param('faspex5', 'shared_folder_file')
        ]
    }
    # this triggers a server-to-server (remote) transfer
    f5_api.create(f'packages/{package_info["id"]}/remote_transfer', upload_request)

    # wait for remote transfer to complete
    deadline = time.monotonic() + REMOTE_TRANSFER_TIMEOUT_SEC
    while True:
        transfer_info = f5_api.read(f'packages/{package_info["id"]}/upload_details')
        log.info(f'Remote transfer: {transfer_info["upload_status"]}')
        if transfer_info['upload_status'] == 'completed':
            break
        elif transfer_info['upload_status'] == 'failed':
            raise Exception('Remote transfer failed')
        if time.monotonic() > deadline:
            raise TimeoutError(f'Remote transfer not completed after {REMOTE_TRANSFER_TIMEOUT_SEC} s')
        time.sleep(1)

finally:
    transfer_client.shutdown()
