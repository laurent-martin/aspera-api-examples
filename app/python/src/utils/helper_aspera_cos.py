#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Helper function to use COS API for native Aspera
# cspell:ignore apikey tspec creds
import xml.dom.minidom
import requests
import json
import utils.rest

IBM_CLOUD_OAUTH_URL = 'https://iam.cloud.ibm.com/identity/token'
# max time to wait for a server response
HTTP_TIMEOUT_SEC = 60


def node(*, bucket, endpoint, key, crn, auth=IBM_CLOUD_OAUTH_URL):
    '''
    Get the node information of Aspera Transfer Service for a bucket.

    :param bucket: name of the bucket
    :param endpoint: storage endpoint: `https://...`
    :param key: API key
    :param crn: resource instance id
    :param auth: token endpoint
    :return: node information: `url`, `auth`, `headers`, `tspec`
    '''
    # Get bearer token to access COS S3 API
    # payload to generate auth token
    token_req_data = {
        'grant_type': 'urn:ibm:params:oauth:grant-type:apikey',
        'response_type': 'cloud_iam',
        'apikey': key,
    }
    response = requests.post(
        auth,
        data=token_req_data,
        headers={'Content-type': 'application/x-www-form-urlencoded'},
        timeout=HTTP_TIMEOUT_SEC,
    )
    utils.rest.check_response(response)
    bearer_token_info = response.json()

    # Get Aspera connection information for the bucket
    header_auth = {
        'ibm-service-instance-id': crn,
        'Authorization': f'{bearer_token_info["token_type"]} {bearer_token_info["access_token"]}',
        'Accept': 'application/xml',
    }
    response = requests.get(
        url=f'{endpoint}/{bucket}',
        headers=header_auth,
        params={'faspConnectionInfo': True},
        timeout=HTTP_TIMEOUT_SEC,
    )
    utils.rest.check_response(response)
    ats_info_root = xml.dom.minidom.parseString(response.content.decode('utf-8'))
    ats_ak = ats_info_root.getElementsByTagName('AccessKey')[0]
    ats_url = ats_info_root.getElementsByTagName('ATSEndpoint')[0].firstChild.nodeValue
    ats_ak_id = ats_ak.getElementsByTagName('Id')[0].firstChild.nodeValue
    ats_ak_secret = ats_ak.getElementsByTagName('Secret')[0].firstChild.nodeValue

    # Get delegated token to access the node api
    token_req_data['response_type'] = 'delegated_refresh_token'
    token_req_data['receiver_client_ids'] = 'aspera_ats'
    response = requests.post(
        auth,
        data=token_req_data,
        headers={'Content-type': 'application/x-www-form-urlencoded'},
        timeout=HTTP_TIMEOUT_SEC,
    )
    utils.rest.check_response(response)
    delegated_token_info = response.json()
    aspera_storage_credentials = {'type': 'token', 'token': delegated_token_info}

    return {
        'url': ats_url,
        'auth': [ats_ak_id, ats_ak_secret],
        'headers': {
            'X-Aspera-Storage-Credentials': json.dumps(aspera_storage_credentials)
        },
        'tspec': {
            'tags': {
                'aspera': {'node': {'storage_credentials': aspera_storage_credentials}}
            }
        },
    }


def from_service_credentials(*, credentials, region):
    '''
    Get the parameters of `node` from service credentials.

    :param credentials: service credentials, from JSON
    :param region: region of the bucket
    :return: parameters: `endpoint`, `key`, `crn`
    '''
    # read and check format of service credentials
    if not isinstance(credentials, dict):
        raise Exception('Invalid service credentials: expecting a dict')
    for k in ['apikey', 'endpoints', 'resource_instance_id']:
        if not k in credentials:
            raise Exception(f'Missing key in service credentials: {k}')

    # read endpoints from url in service credentials
    response = requests.get(credentials['endpoints'], timeout=HTTP_TIMEOUT_SEC)
    utils.rest.check_response(response)

    # return parameters
    return {
        'endpoint': f"https://{response.json()['service-endpoints']['regional'][region]['public'][region]}",
        'key': credentials['apikey'],
        'crn': credentials['resource_instance_id'],
    }
