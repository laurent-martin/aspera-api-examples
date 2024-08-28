import requests
import requests.auth

MIME_JSON = 'application/json'


class Rest:
    def __init__(self, base_url, auth=None, user=None, password=None, verify=True, headers=None):
        self.base_url = base_url
        self.auth = auth
        self.verify = verify
        self.headers = headers or {}
        if auth is None and user is not None and password is not None:
            self.auth = requests.auth.HTTPBasicAuth(user, password)

    def get(self, endpoint, params=None):
        headers = {'Accept': MIME_JSON}
        headers.update(self.headers)
        response = requests.get(
            url=f'{self.base_url}/{endpoint}',
            auth=self.auth,
            verify=self.verify,
            headers=headers,
            params=params,
        )
        response.raise_for_status()
        return response.json()

    def post(self, endpoint, data):
        headers = {'Content-Type': MIME_JSON, 'Accept': MIME_JSON}
        headers.update(self.headers),
        response = requests.post(
            url=f'{self.base_url}/{endpoint}',
            auth=self.auth,
            headers=headers,
            verify=self.verify,
            json=data,
        )
        # data=json.dumps(upload_setup_request),
        response.raise_for_status()
        return response.json()

    def put(self, endpoint, data):
        headers = {'Content-Type': MIME_JSON, 'Accept': MIME_JSON}
        headers.update(self.headers),
        response = requests.put(
            url=f'{self.base_url}/{endpoint}',
            auth=self.auth,
            headers=headers,
            verify=self.verify,
            json=data,
        )
        response.raise_for_status()
        return  # response.json()

    def delete(self, endpoint):
        headers = {'Accept': MIME_JSON}
        headers.update(self.headers)
        response = requests.delete(
            url=f'{self.base_url}/{endpoint}',
            auth=self.auth,
            headers=headers,
            verify=self.verify,
        )
        response.raise_for_status()
        return response.json()
