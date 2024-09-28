#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Faspex 5
# Send a package to myself
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

# take come time back to account for time offset between client and server
JWT_NOT_BEFORE_OFFSET_SEC = 60
# take some validity for the JWT
JWT_EXPIRY_OFFSET_SEC = 600
# base path for v5 api
F5_API_PATH_V5 = '/api/v5'
# path for oauth2 token generation
F5_API_PATH_TOKEN = '/auth/token'

# name of package
package_name = 'sample package'

# number of // transfer sessions (typically, 1)
transfer_sessions = 1


def get_bearer(verify_cert):
    '''
    generate a bearer token
    '''
    log.info('getting API authorization')
    with open(config['private_key']) as key_file:
        private_key_pem = key_file.read()

    seconds_since_epoch = int(calendar.timegm(time.gmtime()))

    jwt_payload = {
        'iss': config['client_id'],  # issuer
        'sub': f'user:{config["username"]}',  # subject
        'aud': config['client_id'],  # audience
        'nbf': seconds_since_epoch - JWT_NOT_BEFORE_OFFSET_SEC,  # not before
        'exp': seconds_since_epoch + JWT_EXPIRY_OFFSET_SEC,  # expiration
        'iat': seconds_since_epoch - JWT_NOT_BEFORE_OFFSET_SEC,  # issued at
        'jti': str(uuid.uuid4()),
    }
    log.debug(jwt_payload)

    data = {
        'client_id': config['client_id'],
        'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        'assertion': jwt.encode(
            payload=jwt_payload,
            key=private_key_pem,
            algorithm='RS256',
            headers={'typ': 'JWT'},
        ),
    }

    response = requests.post(
        url=f'{config["url"]}{F5_API_PATH_TOKEN}',
        auth=requests.auth.HTTPBasicAuth(config['client_id'], config['client_secret']),
        data=data,
        headers={
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
        },
        verify=verify_cert
    )
    response.raise_for_status()
    response_data = response.json()

    return f'Bearer {response_data["access_token"]}'


test_env = utils.configuration.Configuration()
transfer_client = utils.transfer_client.TransferClient(test_env).startup()

try:
    # get configuration parameters from config file
    config = test_env.conf('faspex5')

    # verify certificate if not explicitly set to False
    verify_cert = not ('verify' in config and config['verify'] is False)

    # bearer token is valid for some time and can (should) be re-used, until expired, then refresh it
    # in this example we generate a new bearer token for each script invocation
    f5_api = utils.rest.Rest(
        base_url=f'{config["url"]}{F5_API_PATH_V5}',
        headers={'Authorization': get_bearer(verify_cert)},
        verify=verify_cert,
    )

    # create a new package with Faspex 5 API (this allocates a reception folder on package storage)
    log.info(f'creating package "{package_name}"')
    package_info = f5_api.post('packages', {
        'title': package_name,
        'recipients': [{'name': config['username']}],  # send to myself (for test)
    })
    log.debug(package_info)

    # build payload to specify files to send
    files_to_send = {'paths': []}
    for f in test_env.file_list():
        files_to_send['paths'].append({'source': f})

    log.info('getting transfer spec')
    t_spec = f5_api.post(f'packages/{package_info["id"]}/transfer_spec/upload?transfer_type=connect', files_to_send)

    # optional: multi session
    if transfer_sessions != 1:
        t_spec['multi_session'] = transfer_sessions
        t_spec['multi_session_threshold'] = 500000

    # add file list in transfer spec
    t_spec['paths'] = []
    for f in test_env.file_list():
        t_spec['paths'].append({'source': f})

    # not used in transfer sdk
    del t_spec['authentication']

    # Finally send files to package folder on server
    transfer_client.start_transfer_and_wait(t_spec)
finally:
    transfer_client.shutdown()
