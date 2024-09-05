#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Common library for sample scripts
# Helper methods to get API environment according to config file
# Simplified function to start transfer and wait for it to finish
import os
import sys
import yaml
import json
import time
import grpc
import logging
import tempfile
import subprocess
import utils.tools
from urllib.parse import urlparse


# tell where to find gRPC stubs: transfer_pb2 and transfer_pb2_grpc
sys.path.insert(1, os.environ['PY_DIR_GRPC'])

# before stub import: protobuf: avoid incompatibility of version, use pure python implementation
os.environ['PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION'] = 'python'

# import gRPC stubs (Transfer SDK API)
import transfer_pb2_grpc as transfer_manager_grpc  # noqa: E4
import transfer_pb2 as transfer_manager  # noqa: E4

TRANSFER_SDK_DAEMON = 'asperatransferd'
DAEMON_LOG_FILE = "asperatransferd.log"
ASCP_LOG_FILE = "aspera-scp-transfer.log"
DEBUG_HTTP = False


class TransferClient:
    '''Transfer Client using Aspera Transfer SDK'''

    def __init__(self, tools):
        self._tools = tools
        # Global vars
        self._transfer_daemon_process = None
        self._transfer_service = None

        # folder with executables
        self._arch_folder = os.path.join(self._tools.get_path('sdk_root'), self._tools.conf('misc', 'platform'))
        assert os.path.exists(
            self._arch_folder
        ), f'ERROR: SDK not found in: {self._arch_folder}.{self._error_hint}'

        grpc_url = urlparse(self._tools.conf('trsdk', 'url'))
        self._channel_address = f'{grpc_url.hostname}:{grpc_url.port}'
        self._server_address = grpc_url.hostname
        self._server_port = grpc_url.port

    def start_daemon(self):
        '''
        Start transfer manager daemon if not already running

        @return gRPC client
        '''
        # Prepare config and start
        log_folder = tempfile.gettempdir()
        daemon_log_file = os.path.join(log_folder, DAEMON_LOG_FILE)
        ascp_log_file = os.path.join(log_folder, ASCP_LOG_FILE)
        tmp_file_base = os.path.join(log_folder, TRANSFER_SDK_DAEMON)
        conf_file = f'{tmp_file_base}.conf'
        out_file = f'{tmp_file_base}.out'
        err_file = f'{tmp_file_base}.err'
        # see https://developer.ibm.com/apis/catalog/aspera--aspera-transfer-sdk/Configuration%20File
        config = {
            'address': self._server_address,
            'port': self._server_port,
            'log_directory': log_folder,
            'log_level': 'debug',
            'fasp_runtime': {
                'use_embedded': False,
                'user_defined': {
                    'bin': self._arch_folder,
                    'etc': self._tools.get_path('trsdk_noarch'),
                },
                'log': {
                    'dir': log_folder,
                    'level': 2,
                },
            },
        }
        # dynamically create a config file
        with open(conf_file, 'w') as the_file:
            the_file.write(json.dumps(config))
        command = [
            os.path.join(self._arch_folder, TRANSFER_SDK_DAEMON),
            '--config',
            conf_file,
        ]
        time.sleep(1)
        logging.info('Starting: %s', " ".join(command))
        logging.info('stderr: %s', err_file)
        logging.info('stdout: %s', out_file)
        logging.info('sdk log: %s', daemon_log_file)
        logging.info('xfer log: %s', ascp_log_file)
        self._transfer_daemon_process = subprocess.Popen(
            ' '.join(command),
            shell=True,
            stdout=open(out_file, 'w'),
            stderr=open(err_file, 'w'),
        )
        # give time for startup
        time.sleep(2)
        exit_status = self._transfer_daemon_process.poll()
        if exit_status is None:
            logging.info('transfer daemon has been started: %s', self._transfer_daemon_process.pid)
        else:
            logging.error('transfer daemon failed to start, exit code = %s', exit_status)
            logging.error(utils.tools.last_file_line(daemon_log_file))
            raise Exception('transfer daemon failed to start')

    def connect_to_daemon(self):
        '''Connect to transfer manager daemon'''
        # avoid message: 'Other threads are currently calling into gRPC, skipping fork() handlers'
        os.environ['GRPC_ENABLE_FORK_SUPPORT'] = 'false'
        # create a connection to the transfer manager daemon, in case it is running
        channel = grpc.insecure_channel(self._channel_address)
        logging.info('Connecting to %s using gRPC: %s...', TRANSFER_SDK_DAEMON, self._channel_address)
        try:
            grpc.channel_ready_future(channel).result(timeout=5)
            logging.info('SUCCESS: connected')
            # channel is ok, let's get the stub
            self._transfer_service = transfer_manager_grpc.TransferServiceStub(channel)
        except grpc.FutureTimeoutError:
            logging.error('Failed to connect')
            raise Exception('Failed to connect to transfer manager daemon')

    def setup(self):
        '''Start and connect to transfer manager daemon'''
        if self._transfer_service is None:
            self.start_daemon()
            self.connect_to_daemon()
        return self

    def shutdown(self):
        '''Shutdown transfer manager daemon, if needed'''
        if self._transfer_daemon_process is not None:
            # self._transfer_daemon_process.send_signal(signal.CTRL_C_EVENT)
            # self._transfer_daemon_process.terminate()
            self._transfer_daemon_process.kill()
            self._transfer_daemon_process.wait()
            self._transfer_daemon_process = None
            logging.info('transfer daemon has been terminated')
        else:
            logging.error('transfer daemon not started by this process, or already terminated')

    def start_transfer(self, transfer_spec):
        '''Start a transfer and return transfer id'''
        logging.debug('ts = %s', transfer_spec)
        # create a transfer request
        transfer_request = transfer_manager.TransferRequest(
            transferType=transfer_manager.FILE_REGULAR,
            config=transfer_manager.TransferConfig(),
            transferSpec=json.dumps(transfer_spec),
        )
        # send start transfer request to transfer manager daemon
        transfer_response = self._transfer_service.StartTransfer(transfer_request)
        if transfer_manager.TransferStatus.FAILED == transfer_response.status:
            logging.error(transfer_response.error.description)
            exit(1)
        return transfer_response.transferId

    def wait_transfer(self, transfer_id):
        '''Wait for transfer completion'''
        logging.debug('transfer started with id %s', transfer_id)
        # monitor transfer status
        for transfer_info in self._transfer_service.MonitorTransfers(
            transfer_manager.RegistrationRequest(
                filters=[transfer_manager.RegistrationFilter(
                    transferId=[transfer_id])]
            )
        ):
            logging.debug('transfer info %s', transfer_info)
            # check transfer status in response, and exit if it's done
            status = transfer_info.status
            logging.info('transfer status: %s', transfer_manager.TransferStatus.Name(status))
            # exit on first success or failure
            if status == transfer_manager.COMPLETED:
                logging.info('completed transfer')
                break
            if status == transfer_manager.FAILED:
                raise Exception(transfer_info.message)

    def start_transfer_and_wait(self, t_spec):
        '''One-call simplified procedure to start daemon, transfer and wait for it to finish'''
        # TODO: remove when transfer sdk bug fixed
        t_spec['http_fallback'] = False
        self.setup()
        self.wait_transfer(self.start_transfer(t_spec))
