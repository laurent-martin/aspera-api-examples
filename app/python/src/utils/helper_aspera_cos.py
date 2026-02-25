#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Helper function to use COS API for native Aspera
# cspell:ignore apikey tspec creds
import xml.dom.minidom
import requests
import json
import logging

IBM_CLOUD_OAUTH_URL = 'https://iam.cloud.ibm.com/identity/token'


def node(*, bucket, endpoint, key, crn, auth=IBM_CLOUD_OAUTH_URL):
    '''
    Return Aspera Transfer Service node information for given bucket

    Parameters:
    bucket     : Name of bucket
    endpoint   : Storage endpoint ('https://...')
    key        : API Key
    crn        : Resource instance id
    auth       : Token endpoint

    Returns:
    Aspera Transfer Service node information

    Raises:
    Exception: in case of problem
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
    )
    if response.status_code != 200:
        raise Exception('error')
    bearer_token_info = response.json()
    logging.debug(bearer_token_info)

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
    )
    if response.status_code != 200:
        raise Exception('error accessing endpoint')
    logging.debug(response.content)
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
    )
    if response.status_code != 200:
        raise Exception('error when generating token')
    delegated_token_info = response.json()
    aspera_storage_credentials = {'type': 'token', 'token': delegated_token_info}
    logging.debug(aspera_storage_credentials)

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
    Return parameters suitable for node given service credential information

    Parameters:
    credentials : The structure for 'service credentials' (from json.load(file))
    region      : The region of bucket

    Returns:
    hash with keys 'endpoint', 'key', 'crn'
    '''
    # read and check format of service credentials
    if not isinstance(credentials, dict):
        raise Exception('service creds must be a dict')
    for k in ['apikey', 'endpoints', 'resource_instance_id']:
        if not k in credentials:
            raise Exception(f'missing key: {k}')
    logging.debug(credentials)

    # read endpoints from url in service credentials
    response = requests.get(credentials['endpoints'])
    if response.status_code != 200:
        raise Exception('error')

    # return parameters
    return {
        'endpoint': f"https://{response.json()['service-endpoints']['regional'][region]['public'][region]}",
        'key': credentials['apikey'],
        'crn': credentials['resource_instance_id'],
    }
