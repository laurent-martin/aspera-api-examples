#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Upload files using an Aspera Transfer token, generated using node API (upload_setup)
import test_environment
import requests
import requests.auth
import logging
import json
import sys

# get file to upload from command line
files_to_upload = test_environment.file_list
destination_folder = "/Upload"

# get node information from config file
config = test_environment.CONFIG["node"]

# prepare node API request for upload_setup
upload_setup_request = {
    "transfer_requests": [
        {"transfer_request": {"paths": [{"destination": destination_folder}]}}
    ]
}

# standard REST headers
request_headers = {"Content-Type": "application/json", "Accept": "application/json"}

# call Node API with a single transfer request to get one transfer spec with Aspera token
response = requests.post(
    config["url"] + "/files/upload_setup",
    auth=requests.auth.HTTPBasicAuth(config["user"], config["pass"]),
    data=json.dumps(upload_setup_request),
    headers=request_headers,
    verify=False,
)
if response.status_code != 200:
    raise Exception("error")

response_data = response.json()

# extract the single transfer spec (we sent a single transfer request)
t_spec = response_data["transfer_specs"][0]["transfer_spec"]

# add file list in transfer spec
t_spec["paths"] = []
for f in files_to_upload:
    t_spec["paths"].append({"source": f})
logging.debug(t_spec)

# start transfer, here we use the FASP Manager, but the newer Transfer SDK can be used as well
test_environment.start_transfer_and_wait(t_spec)
