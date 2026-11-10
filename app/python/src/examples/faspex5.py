#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Faspex 5
# Send a package with local files to myself
import utils.configuration
import utils.transfer_client
import utils.rest
import logging as log

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

    # create a new package with Faspex 5 API (this allocates a reception folder on package storage)
    # send to myself (for test): recipient_type is `user` by default, see faspex5_remote for a shared inbox
    log.info('Creating package')
    package_info = f5_api.create('packages', {
        'title': 'Sample package',
        'recipients': [{'name': config.param('faspex5', 'username')}]
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
    t_spec.pop('authentication', None)

    # Send local files to package folder on server and wait for completion
    log.info('Uploading files')
    transfer_client.start_transfer_and_wait(t_spec)
finally:
    transfer_client.shutdown()
