import requests
import requests.auth
import jwt
import calendar
import time
import uuid
import logging as log
import utils.configuration

# take come time back to account for time offset between client and server
JWT_CLIENT_SERVER_OFFSET_SEC = 60
# take some validity for the JWT
JWT_VALIDITY_SEC = 600
MIME_JSON = 'application/json'
MIME_WWW = 'application/x-www-form-urlencoded'
IETF_GRANT_JWT = 'urn:ietf:params:oauth:grant-type:jwt-bearer'
# max time to wait for a server response
HTTP_TIMEOUT_SEC = 60


class Rest:
    '''Simple REST client, with Basic or OAuth 2 JWT Bearer authentication.'''

    def __init__(self, base_url):
        '''
        Create a REST client.

        :param base_url: base URL of the API
        '''
        self.base_url = base_url
        self.authData = None
        self.verify = True
        self.headers = {}

    def setVerify(self, verify):
        '''
        Enable or disable the verification of the server certificate.

        :param verify: false for development servers with a self-signed certificate
        '''
        self.verify = verify

    def addHeaders(self, headers):
        '''
        Add headers to all subsequent requests.

        :param headers: header names and values
        '''
        self.headers.update(headers)

    def setAuthBasic(self, user, password):
        '''
        Use Basic authentication.

        :param user: user name
        :param password: password
        '''
        self.authData = None
        self.headers['Authorization'] = utils.configuration.basic_authorization(user, password)

    def setAuthBearer(self, auth_data):
        '''
        Use OAuth 2 Bearer authentication, with a JWT signed with a private key.

        :param auth_data: `token_url`, `key_pem_path`, `client_id`, `client_secret`, `iss`, `aud`, `sub`, and optionally `org`
        '''
        mandatory_keys = {'token_url', 'aud', 'client_id', 'client_secret', 'key_pem_path', 'iss', 'sub'}
        missing_keys = mandatory_keys - auth_data.keys()

        if missing_keys:
            raise ValueError(f"Missing keys in auth data: {', '.join(sorted(missing_keys))}")

        self.authData = auth_data

    def setDefaultScope(self, scope=None):
        '''
        Generate a bearer token, and use it for all subsequent requests.

        A new token is generated for each execution of the sample.
        In real code, the token should be reused until it expires.

        :param scope: OAuth scope of the token, or none
        '''
        self.headers['Authorization'] = self.getBearerTokenAuthorization(scope)

    def getBearerTokenAuthorization(self, scope=None):
        '''
        Generate a bearer token, with the JWT Bearer grant.

        :param scope: OAuth scope of the token, or none
        :return: value of the Authorization header: `Bearer <token>`
        '''
        # self.authData['token_url'] = 'http://localhost:12345'
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
        if 'org' in self.authData:
            jwt_payload['org'] = self.authData['org']

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

        response = send(
            method='POST',
            url=self.authData['token_url'],
            auth=requests.auth.HTTPBasicAuth(self.authData['client_id'], self.authData['client_secret']),
            data=token_parameters,
            headers={
                'Content-Type': MIME_WWW,
                'Accept': MIME_JSON,
            },
            verify=self.verify,
        )
        return f'Bearer {response.json()["access_token"]}'

    def call(self, method, endpoint=None, body=None, query=None, headers=None):
        '''
        Call the API: send a request, and get the response data.

        :param method: HTTP method
        :param endpoint: path of the endpoint, relative to the base URL
        :param body: request data, sent in JSON
        :param query: query parameters
        :param headers: additional headers
        :return: response data, or none if the response is empty
        '''
        url = self.base_url
        if endpoint is not None:
            url = f'{url}/{endpoint}'
        req_headers = {}
        if method != 'PUT' and method != 'DELETE':
            req_headers['Accept'] = MIME_JSON
        if method in ['POST', 'PUT']:
            req_headers['Content-Type'] = MIME_JSON
        req_headers.update(self.headers)
        if headers:
            req_headers.update(headers)
        response = send(
            method=method,
            url=url,
            headers=req_headers,
            verify=self.verify,
            json=body,
            params=query,
        )
        if method == 'PUT' or method == 'DELETE':
            return None
        return response.json()

    def create(self, endpoint, data):
        '''
        Create a resource (HTTP POST).

        :param endpoint: path of the endpoint, relative to the base URL
        :param data: request data, sent in JSON
        :return: response data
        '''
        return self.call('POST', endpoint, body=data)

    def read(self, endpoint, params=None):
        '''
        Read a resource (HTTP GET).

        :param endpoint: path of the endpoint, relative to the base URL
        :param params: query parameters
        :return: response data
        '''
        return self.call('GET', endpoint, query=params)

    def update(self, endpoint, data):
        '''
        Update a resource (HTTP PUT).

        :param endpoint: path of the endpoint, relative to the base URL
        :param data: request data, sent in JSON
        '''
        return self.call('PUT', endpoint, body=data)

    def delete(self, endpoint):
        '''
        Delete a resource (HTTP DELETE).

        :param endpoint: path of the endpoint, relative to the base URL
        '''
        return self.call('DELETE', endpoint)


def send(method, url, **kwargs):
    '''
    Send an HTTP request, log request and response bodies, and raise an exception on error.

    :param method: HTTP method
    :param url: URL without query
    :param kwargs: parameters of `requests.request`
    :return: HTTP response
    '''
    log.debug('HTTP %s %s', method, url)
    response = requests.request(method=method, url=url, timeout=HTTP_TIMEOUT_SEC, **kwargs)
    request_body = response.request.body
    if request_body:
        if isinstance(request_body, bytes):
            request_body = request_body.decode()
        utils.configuration.log_dump('Request body', request_body)
    check_response(response)
    if response.text:
        utils.configuration.log_dump('Response body', response.text)
    return response


def check_response(response):
    '''
    Raise an exception if the HTTP response is an error.

    :param response: HTTP response
    '''
    if not response.ok:
        request = response.request
        url = request.url.split('?')[0]
        raise Exception(f'HTTP {response.status_code} for {request.method} {url}: {response.text}')
