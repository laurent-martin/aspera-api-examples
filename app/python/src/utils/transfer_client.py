#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Common library for sample scripts
# Helper methods to get API environment according to config file
# Simplified function to start transfer and wait for it to finish
import os
import re
import json
import time
import grpc
import logging
import subprocess
import utils.configuration
from urllib.parse import urlparse
import warnings
warnings.filterwarnings("ignore", ".*obsolete", UserWarning, "google.protobuf.runtime_version")

# before stub import: protobuf: avoid incompatibility of version, use pure python implementation
os.environ['PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION'] = 'python'
# avoid message: 'Other threads are currently calling into gRPC, skipping fork() handlers'
os.environ['GRPC_ENABLE_FORK_SUPPORT'] = 'false'

# import gRPC stubs (Transfer SDK API), make sure it is in PYTHONPATH
import transferd_pb2_grpc as transfer_manager_grpc  # noqa: E4
import transferd_pb2 as transfer_manager  # noqa: E4

ASCP_LOG_FILE = "aspera-scp-transfer.log"
DEBUG_HTTP = False


class TransferClient:
    '''Transfer Client using Aspera Transfer SDK'''

    def __init__(self, config):
        self._config = config
        sdk_url = urlparse(self._config.param('trsdk', 'url'))
        self._server_address = sdk_url.hostname
        self._server_port = sdk_url.port
        self._transfer_daemon_process = None
        self._transfer_service = None
        self._daemon_name = os.path.basename(self._config.get_path('sdk_daemon'))
        self._daemon_log = os.path.join(self._config._log_folder, f"{self._daemon_name}.log")

    def create_config_file(self, conf_file):
        '''
        see https://developer.ibm.com/apis/catalog/aspera--aspera-transfer-sdk/Configuration%20File
        '''
        config_info = {
            'address': self._server_address,
            'port': self._server_port,
            'log_directory': self._config._log_folder,
            'log_level': self._config.param('trsdk', 'level'),
            'fasp_runtime': {
                'use_embedded': True,
                'log': {
                    'dir': self._config._log_folder,
                    'level': ascp_level(self._config.param('trsdk', 'ascp_level')),
                },
            },
        }
        config_data = json.dumps(config_info)
        logging.debug('config: %s', config_data)
        with open(conf_file, 'w') as the_file:
            the_file.write(config_data)

    def start_daemon(self):
        '''
        Start transfer manager daemon if not already running

        @return gRPC client
        '''
        file_base = os.path.join(self._config._log_folder, self._daemon_name)
        conf_file = f'{file_base}.conf'
        out_file = f'{file_base}.out'
        err_file = f'{file_base}.err'
        command = ' '.join([
            self._config.get_path('sdk_daemon'),
            '--config',
            conf_file,
        ])
        logging.debug('daemon out: %s', out_file)
        logging.debug('daemon err: %s', err_file)
        logging.debug('daemon log: %s', self._daemon_log)
        logging.debug('ascp log: %s', os.path.join(
            self._config._log_folder, ASCP_LOG_FILE))
        logging.debug('command: %s', command)
        self.create_config_file(conf_file)
        logging.info('Starting daemon...')
        self._transfer_daemon_process = subprocess.Popen(
            command,
            shell=True,
            stdout=open(out_file, 'w'),
            stderr=open(err_file, 'w'),
        )
        # give time for startup
        time.sleep(2)
        exit_status = self._transfer_daemon_process.poll()
        if exit_status is not None:
            logging.error('Daemon not started.')
            logging.error('Exited with code: %s', exit_status)
            logging.error('Check daemon log: %s', self._daemon_log)
            logging.error(utils.configuration.last_file_line(self._daemon_log))
            raise Exception('daemon startup failed')
        logging.info('Daemon started: %s', self._transfer_daemon_process.pid)
        # port zero means: listen on any available port, but we need to know the real port
        if self._server_port == 0:
            last_line = utils.configuration.last_file_line(self._daemon_log)
            log_info = json.loads(last_line)
            port_match = re.search(r":(\d+)", log_info["msg"])
            if not port_match:
                raise Exception('Could not read listening port from log file')
            self._server_port = port_match.group(1)
            logging.info('Allocated server port: %s', self._server_port)

    def connect_to_daemon(self):
        '''Connect to transfer manager daemon'''
        channel_address = f'{self._server_address}:{self._server_port}'
        logging.info('Connecting to %s on: %s ...', self._daemon_name, channel_address)
        # create a connection to the transfer manager daemon
        channel = grpc.insecure_channel(channel_address)
        try:
            grpc.channel_ready_future(channel).result(timeout=5)
        except grpc.FutureTimeoutError:
            logging.error('Failed to connect')
            raise Exception('failed to connect.')
        # channel is ok, let's get the stub
        self._transfer_service = transfer_manager_grpc.TransferServiceStub(channel)
        logging.info('Connected !')

    def startup(self):
        '''Start and connect to transfer manager daemon'''
        if self._transfer_service is None:
            self.start_daemon()
            self.connect_to_daemon()
        return self

    def shutdown(self):
        '''Shutdown transfer manager daemon, if needed'''
        if self._transfer_service is None:
            self._transfer_service = None
        if self._transfer_daemon_process is not None:
            logging.info('Shutting down daemon...')
            # self._transfer_daemon_process.send_signal(signal.CTRL_C_EVENT)
            # self._transfer_daemon_process.terminate()
            self._transfer_daemon_process.kill()
            self._transfer_daemon_process.wait()
            self._transfer_daemon_process = None

    def start_transfer(self, transfer_spec):
        '''Start a transfer and return transfer id'''
        ts_json = json.dumps(transfer_spec)
        logging.debug('ts: %s', ts_json)
        # create a transfer request
        transfer_request = transfer_manager.TransferRequest(
            transferType=transfer_manager.FILE_REGULAR,
            config=transfer_manager.TransferConfig(),
            transferSpec=ts_json,
        )
        # send start transfer request to transfer manager daemon
        transfer_response = self._transfer_service.StartTransfer(transfer_request)
        self.throw_on_error(transfer_response.status, transfer_response.error)
        return transfer_response.transferId

    def wait_transfer(self, transfer_id):
        '''Wait for transfer completion'''
        logging.debug('transfer started with id %s', transfer_id)
        # monitor transfer status
        for transfer_info in self._transfer_service.MonitorTransfers(
                transfer_manager.RegistrationRequest(
                    filters=[transfer_manager.RegistrationFilter(
                        transferId=[transfer_id])]
                )):
            # logging.debug('transfer info %s', transfer_info)
            # check transfer status in response, and exit if it's done
            status = transfer_info.status
            logging.info('transfer: %s', transfer_manager.TransferStatus.Name(status))
            self.throw_on_error(status, transfer_info.error)
            if status == transfer_manager.COMPLETED:
                break

    def start_transfer_and_wait(self, t_spec):
        '''One-call simplified procedure to start daemon, transfer and wait for it to finish'''
        # TODO: remove when transfer sdk bug fixed
        # t_spec['http_fallback'] = False
        self.startup()
        self.wait_transfer(self.start_transfer(t_spec))

    def throw_on_error(self, status, error):
        '''raise exception if status contains an error'''
        if status == transfer_manager.TransferStatus.FAILED:
            logging.error(utils.configuration.last_file_line(self._daemon_log))
            raise Exception("transfer failed: " + error.description)
        if status == transfer_manager.TransferStatus.UNKNOWN_STATUS:
            raise Exception("unknown transfer id: " + error.description)


def ascp_level(level_string):
    if level_string == 'info':
        return 0
    elif level_string == 'debug':
        return 1
    elif level_string == 'trace':
        return 2
    else:
        raise Exception('Invalid ascp_level: ' + level_string)
