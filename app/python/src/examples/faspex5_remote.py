#!/usr/bin/env python3
# Faspex 5
# Send a package with files of a shared folder (on the server) to a shared inbox.
# The files are transferred by the server (remote transfer): no local transfer, no Transfer Daemon.
import utils.configuration
import utils.rest
import logging as log
import time

# base path for v5 api
F5_API_PATH_V5 = '/api/v5'
# path for oauth2 token generation
F5_API_PATH_TOKEN = '/auth/token'
# max wait time for the remote transfer
REMOTE_TRANSFER_TIMEOUT_SEC = 600


def lookup_recipient(f5_api, name, recipient_type):
    '''
    Find a recipient by its name, with an exact match.

    :param f5_api: REST client of Faspex 5
    :param name: name of the recipient
    :param recipient_type: type of the recipient: `user`, `shared_inbox`, `workgroup`, `distribution_list`, `external_user`
    :return: recipient of a package: `name` and `recipient_type`
    '''
    # the query `q` also matches parts of names: keep exact matches (case-insensitive)
    contacts = f5_api.read('contacts', [('context', 'packages'), ('type[]', recipient_type), ('q', name)])['contacts']
    matches = [contact for contact in contacts if contact['name'].lower() == name.lower()]
    if len(matches) != 1:
        raise Exception(f'Expecting one {recipient_type} named {name}, found {len(matches)}')
    return {'name': matches[0]['name'], 'recipient_type': matches[0]['type']}


# get testing environment configuration
config = utils.configuration.Configuration()

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

# a shared inbox is a recipient with `recipient_type`: `shared_inbox`
log.info('Getting recipient')
recipient = lookup_recipient(f5_api, config.param('faspex5', 'shared_inbox'), 'shared_inbox')

# create a new package with Faspex 5 API (this allocates a reception folder on package storage)
log.info('Creating package')
package_info = f5_api.create('packages', {
    'title': 'Sample package (remote files)',
    'recipients': [recipient]
})

# the configuration has the name of the shared folder: get its id
shared_folder_name = config.param('faspex5', 'shared_folder_name')
shared_folders = f5_api.read('shared_folders')['shared_folders']
folder_id = next((folder['id'] for folder in shared_folders if folder['name'] == shared_folder_name), None)
if folder_id is None:
    raise Exception(f'Shared folder not found: {shared_folder_name}')

# the server transfers the files from the shared folder to the package folder (server-to-server)
log.info('Starting remote transfer')
f5_api.create(f'packages/{package_info["id"]}/remote_transfer', {
    'shared_folder_id': folder_id,
    'paths': [config.param('faspex5', 'shared_folder_file')]
})

# wait for the end of the remote transfer
deadline = time.monotonic() + REMOTE_TRANSFER_TIMEOUT_SEC
while True:
    upload_status = f5_api.read(f'packages/{package_info["id"]}/upload_details')['upload_status']
    log.info(f'Remote transfer: {upload_status}')
    if upload_status == 'completed':
        break
    if upload_status == 'failed':
        raise Exception('Remote transfer failed')
    if time.monotonic() > deadline:
        raise TimeoutError(f'Remote transfer not completed after {REMOTE_TRANSFER_TIMEOUT_SEC} s')
    time.sleep(1)
