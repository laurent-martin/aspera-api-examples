#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Faspex 5
# Send a package to myself
import utils.configuration
import utils.transfer_client
import utils.rest
import logging as log

# base path for v5 api
F5_API_PATH_V5 = '/api/v5'
# path for oauth2 token generation
F5_API_PATH_TOKEN = '/auth/token'

# name of package
package_name = 'sample package'

# number of // transfer sessions (typically, 1)
transfer_sessions = 1

config = utils.configuration.Configuration()
transfer_client = utils.transfer_client.TransferClient(config).startup()

try:
    # bearer token is valid for some time and can (should) be re-used, until expired, then refresh it
    # in this example we generate a new bearer token for each script invocation
    f5_api = utils.rest.Rest(f'{config.param("faspex5", "url")}{F5_API_PATH_V5}')
    f5_api.setVerify(config.param('faspex5', 'verify', True))
    f5_api.setAuthBearer(
        token_url=f'{config.param("faspex5", "url")}{F5_API_PATH_TOKEN}',
        aud=config.param('faspex5', 'client_id'),
        client_id=config.param('faspex5', 'client_id'),
        client_secret=config.param('faspex5', 'client_secret'),
        key_pem_path=config.param('faspex5', 'private_key'),
        iss=config.param('faspex5', 'client_id'),
        sub=f'user:{config.param("faspex5", "username")}',
    )
    f5_api.setDefaultScope()

    # create a new package with Faspex 5 API (this allocates a reception folder on package storage)
    log.info(f'creating package "{package_name}"')
    package_info = f5_api.create('packages', {
        'title': package_name,
        'recipients': [{'name': config.param('faspex5', 'username')}],  # send to myself (for test)
    })
    log.debug(package_info)

    # build payload to specify files to send
    files_to_send = {'paths': []}
    for f in config.file_list():
        files_to_send['paths'].append({'source': f})

    log.info('getting transfer spec')
    t_spec = f5_api.create(f'packages/{package_info["id"]}/transfer_spec/upload?transfer_type=connect', files_to_send)

    # optional: multi session
    if transfer_sessions != 1:
        t_spec['multi_session'] = transfer_sessions
        t_spec['multi_session_threshold'] = 500000

    # add file list in transfer spec
    t_spec['paths'] = []
    for f in config.file_list():
        t_spec['paths'].append({'source': f})

    # not used in transfer sdk
    del t_spec['authentication']

    # Finally send files to package folder on server
    transfer_client.start_transfer_and_wait(t_spec)
finally:
    transfer_client.shutdown()
