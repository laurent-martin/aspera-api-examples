import requests
import requests.auth


class Rest:
    def __init__(self, base_url, auth=None, user=None, password=None, verify=True):
        self.base_url = base_url
        self.auth = auth
        self.verify = verify
        if auth is None and user is not None and password is not None:
            self.auth = requests.auth.HTTPBasicAuth(user, password)

    def get(self, endpoint):
        response = requests.get(
            url=f'{self.base_url}/{endpoint}',
            auth=self.auth,
            verify=self.verify,
            headers={'Accept': 'application/json'},
        )
        response.raise_for_status()
        return response.json()

    def post(self, endpoint, data):
        response = requests.post(
            url=f'{self.base_url}/{endpoint}',
            auth=self.auth,
            headers={'Content-Type': 'application/json', 'Accept': 'application/json'},
            verify=self.verify,
            json=data,
        )
        # data=json.dumps(upload_setup_request),
        response.raise_for_status()
        return response.json()

    def put(self, endpoint, data):
        response = requests.put(
            url=f'{self.base_url}/{endpoint}',
            auth=self.auth,
            headers={'Content-Type': 'application/json', 'Accept': 'application/json'},
            verify=self.verify,
            json=data,
        )
        response.raise_for_status()
        return response.json()

    def delete(self, endpoint):
        response = requests.delete(
            url=f'{self.base_url}/{endpoint}',
            auth=self.auth,
            headers={'Accept': 'application/json'},
            verify=self.verify,
        )
        response.raise_for_status()
        return response.json()
