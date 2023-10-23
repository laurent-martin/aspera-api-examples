#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Common library for sample scripts
# Helper methods to get API environment according to config file
# Simplified function to start transfer and wait for it to finish
import os
import yaml
import logging
import grpc
import time
import json
import sys
import subprocess
from http.client import HTTPConnection
from urllib.parse import urlparse

# check mandatory environment variables
missing_vars = [
    f"CONFIG_{var}"
    for var in ["TRSDK_DIR_GENERIC", "TRSDK_DIR_ARCH", "TMPDIR", "YAML"]
    if f"CONFIG_{var}" not in os.environ
]
assert (
    not missing_vars
), f"Missing environment variables: {', '.join(missing_vars)}. To load environment execute: . ../../config.env"

# tell where to find gRPC stubs: transfer_pb2 and transfer_pb2_grpc
sys.path.insert(
    1, os.path.join(os.environ["CONFIG_TRSDK_DIR_GENERIC"], "connectors", "python")
)

import transfer_pb2 as transfer_manager
import transfer_pb2_grpc as transfer_manager_grpc

# use "ascp" in PATH, add the one from SDK
os.environ["PATH"] += os.environ["CONFIG_TRSDK_DIR_ARCH"]

# configuration from configuration file
CONFIG = yaml.load(open(os.environ["CONFIG_YAML"]), Loader=yaml.FullLoader)

# set logger for debugging
logging.basicConfig()
logging.getLogger().setLevel(logging.DEBUG)

# debug http: see: https://stackoverflow.com/questions/10588644
HTTPConnection.debuglevel = 1
requests_log = logging.getLogger("requests.packages.urllib3")
requests_log.setLevel(logging.DEBUG)
requests_log.propagate = True

transfer_daemon = None

TRANSFERD_EXECUTABLE = "asperatransferd"


def start_daemon(sdk_grpc_url):
    global transfer_daemon
    # avoid message: "Other threads are currently calling into gRPC, skipping fork() handlers"
    os.environ["GRPC_ENABLE_FORK_SUPPORT"] = "false"
    # create a connection to the transfer manager daemon, in case it is running
    grpc_url = urlparse(sdk_grpc_url)
    channel = grpc.insecure_channel(grpc_url.hostname + ":" + str(grpc_url.port))
    sdk_server = None
    # try to start daemon a few times if needed
    for i in range(0, 2):
        try:
            print(f"Connecting to {TRANSFERD_EXECUTABLE} using gRPC...")
            grpc.channel_ready_future(channel).result(timeout=3)
            print("SUCCESS: connected")
            # channel is ok, let's get the stub
            sdk_server = transfer_manager_grpc.TransferServiceStub(channel)
        except grpc.FutureTimeoutError:
            print("FAILED: to connect\nStarting daemon...")
            # else prepare config and start
            bin_folder = os.environ["CONFIG_TRSDK_DIR_ARCH"]
            config = {
                "address": grpc_url.hostname,
                "port": grpc_url.port,
                "fasp_runtime": {
                    "use_embedded": False,
                    "user_defined": {
                        "bin": bin_folder,
                        "etc": os.environ["CONFIG_TRSDK_DIR_GENERIC"],
                    },
                },
            }
            tmp_file_base = os.path.join(os.environ["CONFIG_TMPDIR"], "daemon")
            conf_file = tmp_file_base + ".conf"
            with open(conf_file, "w") as the_file:
                the_file.write(json.dumps(config))
            command = [
                os.path.join(bin_folder, TRANSFERD_EXECUTABLE),
                "--config",
                conf_file,
            ]
            out_file = tmp_file_base + ".out"
            err_file = tmp_file_base + ".err"
            time.sleep(1)
            print("Starting: " + " ".join(command))
            print("stderr: " + err_file)
            print("stdout: " + out_file)
            transfer_daemon = subprocess.Popen(
                " ".join(command),
                shell=True,
                stdout=open(out_file, "w"),
                stderr=open(err_file, "w"),
            )
            # give time for startup
            time.sleep(1)
        if sdk_server is not None:
            break
    if sdk_server is None:
        print(
            "ERROR: daemon not started or cannot be started.\nCheck the logs: daemon.err and daemon.out (see paths above)."
        )
        exit(1)
    return sdk_server


def start_transfer(sdk_server, transfer_spec):
    # create a transfer request
    transfer_request = transfer_manager.TransferRequest(
        transferType=transfer_manager.FILE_REGULAR,
        config=transfer_manager.TransferConfig(),
        transferSpec=json.dumps(transfer_spec),
    )
    # send start transfer request to transfer manager daemon
    transfer_response = sdk_server.StartTransfer(transfer_request)
    if 4 == transfer_response.status:
        print("ERROR: {0}".format(transfer_response.error.description))
        exit(1)
    return transfer_response.transferId


def wait_transfer(sdk_server, transfer_id):
    print("transfer started with id {0}".format(transfer_id))
    # monitor transfer status
    for transfer_info in sdk_server.MonitorTransfers(
        transfer_manager.RegistrationRequest(
            filters=[transfer_manager.RegistrationFilter(transferId=[transfer_id])]
        )
    ):
        print(">>>>>>>>>>>>>>>>>>>>>>>>>>>>\ntransfer info {0}".format(transfer_info))
        # check transfer status in response, and exit if it's done
        status = transfer_info.status
        # exit on first success or failure
        if status == transfer_manager.COMPLETED:
            print("finished {0}".format(status))
            break
        if status == transfer_manager.FAILED:
            raise Exception(transfer_info.message)


def shutdown():
    global transfer_daemon
    if transfer_daemon is not None:
        transfer_daemon.terminate()
        transfer_daemon = None
        print("transfer daemon terminated")
    else:
        print("transfer daemon already terminated")


def start_transfer_and_wait(t_spec):
    # TODO: remove when transfer sdk bug fixed
    t_spec["http_fallback"] = False
    logging.debug(t_spec)
    sdk_server = start_daemon(CONFIG["misc"]["trsdk_url"])
    t_id = start_transfer(sdk_server, t_spec)
    wait_transfer(sdk_server, t_id)
    shutdown()
