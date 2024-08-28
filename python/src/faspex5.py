#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Faspex 5
# Send a package to myself
import utils.test_environment
import requests
import requests.auth
import logging
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

test_env = utils.test_environment.TestEnvironment()

# get configuration parameters from config file
config = test_env.get_configuration('faspex5')

# verify certificate if not explicitly set to False
verify_cert = not ('verify' in config and config['verify'] is False)


def f5_url(path):
    '''return the full url for a given path'''
    return f'{config["url"]}{F5_API_PATH_V5}/{path}'


def get_bearer():
    '''generate a bearer token'''
    with open(config['private_key']) as fin:
        private_key_pem = fin.read()

    seconds_since_epoch = int(calendar.timegm(time.gmtime()))

    jwt_payload = {
        'iss': config['client_id'],  # issuer
        'aud': config['client_id'],  # audience
        'sub': f'user:{config["username"]}',  # subject
        'exp': seconds_since_epoch + JWT_EXPIRY_OFFSET_SEC,  # expiration
        'nbf': seconds_since_epoch - JWT_NOT_BEFORE_OFFSET_SEC,  # not before
        'iat': seconds_since_epoch - JWT_NOT_BEFORE_OFFSET_SEC,  # issued at
        'jti': str(uuid.uuid4()),
    }
    logging.debug(jwt_payload)

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


# Headers for authorization to Faspex 5 API
# bearer token is valid for some time and can (should) be re-used, until expired, then refresh it
# in this example we generate a new bearer token for each script invocation
request_headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': get_bearer(),
}


# Faspex 5 package creation information
package_creation = {
    'title': package_name,
    'recipients': [{'name': config['username']}],  # send to myself (for test)
}

# create a new package with Faspex 5 API (this allocates a reception folder on package storage)
response = requests.post(
    url=f5_url('packages'),
    headers=request_headers,
    json=package_creation,
    verify=verify_cert
)
response.raise_for_status()
package_info = response.json()
logging.debug(package_info)

# build payload to specify files to send
files_to_send = {'paths': []}
for f in test_env.file_list():
    files_to_send['paths'].append({'source': f})

response = requests.post(
    url=f5_url(f'packages/{package_info["id"]}/transfer_spec/upload?transfer_type=connect'),
    headers=request_headers,
    json=files_to_send,
    verify=verify_cert
)
response.raise_for_status()
t_spec = response.json()

# optional: multi session
if transfer_sessions != 1:
    t_spec['multi_session'] = transfer_sessions
    t_spec['multi_session_threshold'] = 500000

# add file list in transfer spec
t_spec['paths'] = []
for f in test_env.file_list():
    t_spec['paths'].append({'source': f})

# Finally send files to package folder on server
test_env.start_transfer_and_wait(t_spec)
