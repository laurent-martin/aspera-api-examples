import requests
import requests.auth
import jwt
import calendar
import time
import uuid
import logging as log

# take come time back to account for time offset between client and server
JWT_CLIENT_SERVER_OFFSET_SEC = 60
# take some validity for the JWT
JWT_VALIDITY_SEC = 600
MIME_JSON = 'application/json'
MIME_WWW = 'application/x-www-form-urlencoded'
IETF_GRANT_JWT = 'urn:ietf:params:oauth:grant-type:jwt-bearer'


class Rest:
    def __init__(self, base_url):
        self.base_url = base_url
        self.authData = None
        self.verify = True
        self.headers = {}

    def setAuthBasic(self, user, password):
        """
        Provide Basic authentication info.
        """
        self.authData = None
        self.headers['Authorization'] = requests.auth._basic_auth_str(user, password)

    def setAuthBearer(self, token_url, aud, client_id, client_secret, key_pem_path, iss, sub, add=None):
        """
        Provide OAuth 2 bearer parameters to generate a bearer token with JWT.
        """
        self.authData = {
            'token_url': token_url,
            'aud': aud,
            'client_id': client_id,
            'client_secret': client_secret,
            'key_pem_path': key_pem_path,
            'iss': iss,
            'sub': sub,
            'add': add,
        }

    def setDefaultScope(self, scope=None):
        """
        A OAuth 2 bearer is generated using JWT.

        In this example we generate a new bearer token for each script invocation.

        But in real code, as the bearer token is valid for some time, it should be re-used, until expired, then refresh it.
        """
        self.headers['Authorization'] = self.getBearerToken(scope)

    def getBearerToken(self, scope=None):
        '''
        Generate a bearer token.
        '''
        # self.authData['token_url'] = 'http://localhost:12345'
        log.info('getting API authorization')
        with open(self.authData['key_pem_path']) as key_file:
            private_key_pem = key_file.read()

        seconds_since_epoch = int(calendar.timegm(time.gmtime()))

        jwt_payload = {
            'iss': self.authData['iss'],  # issuer
            'sub': self.authData['sub'],  # subject
            'aud': self.authData['aud'],  # audience
            'iat': seconds_since_epoch - JWT_CLIENT_SERVER_OFFSET_SEC,  # issued at
            'nbf': seconds_since_epoch - JWT_CLIENT_SERVER_OFFSET_SEC,  # not before
            'exp': seconds_since_epoch + JWT_VALIDITY_SEC,  # expiration
            'jti': str(uuid.uuid4()),
        }
        if self.authData['add'] is not None:
            jwt_payload.update(self.authData['add'])
        log.debug(jwt_payload)

        token_parameters = {
            'client_id': self.authData['client_id'],
            'grant_type': IETF_GRANT_JWT,
            'assertion': jwt.encode(
                payload=jwt_payload,
                key=private_key_pem,
                algorithm='RS256',
                headers={'typ': 'JWT'},
            ),
        }

        if scope is not None:
            token_parameters['scope'] = scope

        response = requests.post(
            url=self.authData['token_url'],
            auth=requests.auth.HTTPBasicAuth(self.authData['client_id'], self.authData['client_secret']),
            data=token_parameters,
            headers={
                'Content-Type': MIME_WWW,
                'Accept': MIME_JSON,
            },
            verify=self.verify
        )
        response.raise_for_status()
        response_data = response.json()
        return f'Bearer {response_data["access_token"]}'

    def setVerify(self, verify):
        """
        Disable remote server certificate validation with False.
        """
        self.verify = verify

    def addHeaders(self, headers):
        """
        Add provided headers for all subsequent calls.
        """
        self.headers.update(headers)

    def call(self, method, endpoint, headers=None, data=None, params=None):
        """
        Lower level HTTP request.
        """
        url = f'{self.base_url}/{endpoint}'
        req_headers = {}
        if method != 'PUT' and method != 'DELETE':
            req_headers['Accept'] = MIME_JSON
        if method in ['POST', 'PUT']:
            req_headers['Content-Type'] = MIME_JSON
        req_headers.update(self.headers)
        if headers:
            req_headers.update(headers)
        response = requests.request(
            method=method,
            url=url,
            headers=req_headers,
            verify=self.verify,
            json=data,
            params=params
        )
        response.raise_for_status()
        if method == 'PUT' or method == 'DELETE':
            return None
        return response.json()

    def create(self, endpoint, data):
        return self.call('POST', endpoint, data=data)

    def read(self, endpoint, params=None):
        return self.call('GET', endpoint, params=params)

    def update(self, endpoint, data):
        return self.call('PUT', endpoint, data=data)

    def delete(self, endpoint):
        return self.call('DELETE', endpoint)
