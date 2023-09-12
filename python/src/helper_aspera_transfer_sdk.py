#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Helper function to use newer Transfer SDK
import transfer_pb2 as transfer_manager
import transfer_pb2_grpc as transfer_manager_grpc
import grpc
import time
import json
import os
import subprocess

# from asyncio.windows_events import NULL
from urllib.parse import urlparse

sdk_grpc_url = None


def set_grpc_url(url):
    global sdk_grpc_url
    sdk_grpc_url = url


def start_daemon():
    global sdk_grpc_url
    assert sdk_grpc_url is not None, "call set_grpc_url to set grpc url"
    # avoid message: Other threads are currently calling into gRPC, skipping fork() handlers
    os.environ["GRPC_ENABLE_FORK_SUPPORT"] = "false"
    # create a connection to the transfer manager daemon
    grpc_url = urlparse(sdk_grpc_url)
    channel = grpc.insecure_channel(grpc_url.hostname + ":" + str(grpc_url.port))
    sdk_server = None
    # try to start daemon a few times if needed
    for i in range(0, 2):
        try:
            print("Checking gRPC connection")
            grpc.channel_ready_future(channel).result(timeout=3)
            print("SUCCESS: connected")
            # channel is ok, let's get the stub
            sdk_server = transfer_manager_grpc.TransferServiceStub(channel)
        except grpc.FutureTimeoutError:
            print("FAILED: trying to start daemon")
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
            tmp_file_base = os.path.join(os.environ["TMPDIR"], "daemon")
            conf_file = tmp_file_base + ".conf"
            with open(conf_file, "w") as the_file:
                the_file.write(json.dumps(config))
            command = [
                os.path.join(bin_folder, "asperatransferd"),
                "--config",
                conf_file,
            ]
            out_file = tmp_file_base + ".out"
            err_file = tmp_file_base + ".err"
            time.sleep(1)
            print("Starting: " + " ".join(command))
            print("stderr: " + err_file)
            print("stdout: " + out_file)
            process = subprocess.run(
                " ".join(command) + ">" + out_file + " 2>" + err_file + " &",
                shell=True,
                capture_output=True,
                check=True,
            )
            time.sleep(1)
        if sdk_server is not None:
            break
    if sdk_server is None:
        print(
            "ERROR: daemon not started or cannot be started. Check the logs: daemon.err and daemon.out (see paths above)."
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
