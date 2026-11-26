#!/usr/bin/env python3
# Upload files to an HSTS with SSH credentials, with the Transfer Daemon API only (gRPC).
# Read this sample first: the other samples use the helper class TransferClient, which does the same steps.
# The class Configuration only reads the parameters of the test environment: replace config.param(...) with your values.
import json
import logging as log
import os
import signal
import subprocess
import sys
import tempfile
from urllib.parse import urlparse

import grpc
# stub code generated from transferd.proto
import transferd_pb2 as transferd
import transferd_pb2_grpc as transferd_grpc

import utils.configuration

# address of the gRPC API, set in the default configuration file of the SDK: etc/transferd.json
DAEMON_ADDRESS = '127.0.0.1:55002'

config = utils.configuration.Configuration()

# 1. Start the Transfer Daemon. Without option, transferd reads etc/transferd.json of the SDK.
#    In production, the daemon can also run as a service, started separately.
daemon_out = os.path.join(tempfile.gettempdir(), 'transferd_minimal.out')
log.info('Starting daemon')
with open(daemon_out, 'w') as out:
    daemon = subprocess.Popen([config.get_path('sdk_daemon')], stdout=out, stderr=subprocess.STDOUT)
try:
    # 2. Connect to the gRPC API of the daemon
    with grpc.insecure_channel(DAEMON_ADDRESS) as channel:
        try:
            grpc.channel_ready_future(channel).result(timeout=10)
        except grpc.FutureTimeoutError:
            raise Exception(f'Failed to connect to daemon: {DAEMON_ADDRESS}, see: {daemon_out}')
        client = transferd_grpc.TransferServiceStub(channel)
        log.info('Connected to daemon: %s', DAEMON_ADDRESS)

        # 3. Build the transfer spec: upload (send) with SSH credentials
        server_url = urlparse(config.param('server', 'url'))
        transfer_spec = {
            'direction': 'send',
            'remote_host': server_url.hostname,
            'ssh_port': server_url.port,
            'remote_user': config.param('server', 'username'),
            'remote_password': config.param('server', 'password'),
            'destination_root': config.param('server', 'folder_upload'),
            # files to transfer: arguments of the command line
            'paths': [{'source': file} for file in sys.argv[1:]],
        }

        # 4. Start the transfer and follow it: the daemon sends an event on each change, until the end of the transfer
        log.info('Uploading files')
        events = client.StartTransferWithMonitor(transferd.TransferRequest(
            transferType=transferd.FILE_REGULAR,
            config=transferd.TransferConfig(),
            transferSpec=json.dumps(transfer_spec),
        ))
        for event in events:
            log.info('Transfer: %s %d bytes', transferd.TransferStatus.Name(event.status), event.transferInfo.bytesTransferred)
            # the cause of an error is in error, or else in transferInfo
            description = (event.error.description or event.transferInfo.errorDescription).strip()
            if event.status in (transferd.FAILED, transferd.CANCELED):
                raise Exception(f'Transfer failed: {description}')
            if event.status == transferd.UNKNOWN_STATUS:
                raise Exception(f'Transfer status unknown: {description}')
            if event.status == transferd.COMPLETED:
                break
        else:
            # no break: the stream ended before the end of the transfer
            raise Exception('Transfer monitoring ended before transfer completion')
finally:
    # 5. Stop the daemon: transferd stops cleanly on SIGINT (Windows: terminate)
    log.info('Stopping daemon')
    if os.name == 'nt':
        daemon.terminate()
    else:
        daemon.send_signal(signal.SIGINT)
    daemon.wait(timeout=10)
