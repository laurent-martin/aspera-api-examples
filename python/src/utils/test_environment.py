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
import base64
from http.client import HTTPConnection
from urllib.parse import urlparse


# tell where to find gRPC stubs: transfer_pb2 and transfer_pb2_grpc
sys.path.insert(1, os.environ['PY_DIR_GRPC'])

# before stub import: protobuf: avoid incompatibility of version, use pure python implementation
os.environ['PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION'] = 'python'

# import gRPC stubs (Transfer SDK API)
import transfer_pb2_grpc as transfer_manager_grpc  # noqa: E4
import transfer_pb2 as transfer_manager  # noqa: E4

# config file with sub-paths in project's root folder
PATHS_FILE = 'config/paths.yaml'
TRANSFER_SDK_DAEMON = 'asperatransferd'
DEBUG_HTTP = False


class TestEnvironment:
    '''Test Environment'''

    def __init__(self):
        # Global vars
        self._transfer_daemon_process = None
        self._transfer_service = None
        self._file_list = sys.argv[1:]

        assert self._file_list, f'ERROR: Usage: {sys.argv[0]} <files to send>'
        self._top_folder = os.path.abspath(os.path.join(
            os.path.dirname(__file__), '..', '..', '..'))

        # read project's relative paths config file
        self._paths = yaml.load(
            open(os.path.join(self._top_folder, *PATHS_FILE.split('/'))), Loader=yaml.FullLoader
        )

        # Error hint to help user to fix the issue
        self._error_hint = f'\nPlease check: SDK installed in {
            self._paths["sdk_root"]}, configuration file: {self._paths["main_config"]}'

        # Read configuration from configuration file
        self._config = yaml.load(open(self.get_path('main_config')), Loader=yaml.FullLoader)

        # folder with executables
        self._arch_folder = os.path.join(self.get_path('sdk_root'), self._config['misc']['platform'])
        assert os.path.exists(
            self._arch_folder
        ), f'ERROR: SDK not found in: {self._arch_folder}.{self._error_hint}'

        grpc_url = urlparse(self._config['trsdk']['url'])
        self._channel_address = f'{grpc_url.hostname}:{grpc_url.port}'
        self._server_address = grpc_url.hostname
        self._server_port = grpc_url.port

        # set logger for debugging
        logging.basicConfig(
            format='%(levelname)-8s %(message)s',
            level=logging.INFO
        )
        # debug http: see: https://stackoverflow.com/questions/10588644
        if DEBUG_HTTP:
            HTTPConnection.debuglevel = 1
            requests_log = logging.getLogger('requests.packages.urllib3')
            requests_log.setLevel(logging.DEBUG)
            requests_log.propagate = True

    def file_list(self):
        '''Get list of files to transfer'''
        return self._file_list

    def get_path(self, name):
        '''Get configuration sub-path in project's root folder'''
        item_path = os.path.join(self._top_folder, *self._paths[name].split('/'))
        assert os.path.exists(item_path), f'ERROR: {item_path} not found.{self._error_hint}'
        return item_path

    def get_configuration(self, key):
        '''Get configuration value for specific app'''
        assert key in self._config, f'configuration for {key} is missing'
        return self._config[key]

    def start_daemon(self):
        '''
        Start transfer manager daemon if not already running

        @return gRPC client
        '''
        # Prepare config and start
        bin_folder = self._arch_folder
        log_folder = tempfile.gettempdir()
        # see https://developer.ibm.com/apis/catalog/aspera--aspera-transfer-sdk/Configuration%20File
        config = {
            'address': self._server_address,
            'port': self._server_port,
            'log_directory': log_folder,
            'log_level': 'debug',
            'fasp_runtime': {
                'use_embedded': False,
                'user_defined': {
                    'bin': bin_folder,
                    'etc': self.get_path('trsdk_noarch'),
                },
                'log': {
                    'dir': log_folder,
                    'level': 2,
                },
            },
        }
        tmp_file_base = os.path.join(log_folder, 'daemon')
        # dynamically create a config file
        conf_file = f'{tmp_file_base}.conf'
        with open(conf_file, 'w') as the_file:
            the_file.write(json.dumps(config))
        command = [
            os.path.join(bin_folder, TRANSFER_SDK_DAEMON),
            '--config',
            conf_file,
        ]
        out_file = f'{tmp_file_base}.out'
        err_file = f'{tmp_file_base}.err'
        time.sleep(1)
        logging.info('Starting: %s', " ".join(command))
        logging.info(f'stderr: %s', err_file)
        logging.info(f'stdout: %s', out_file)
        logging.info(f'sdk log: %s/asperatransferd.log', log_folder)
        logging.info(f'xfer log: %s/aspera-scp-transfer.log', log_folder)
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

    def setup(self):
        '''Connect to transfer manager daemon'''
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
        if 4 == transfer_response.status:
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
                logging.info(f'finished transfer')
                break
            if status == transfer_manager.FAILED:
                raise Exception(transfer_info.message)

    def start_transfer_and_wait(self, t_spec):
        '''One-call simplified procedure to start daemon, transfer and wait for it to finish'''
        # TODO: remove when transfer sdk bug fixed
        t_spec['http_fallback'] = False
        self.setup()
        self.wait_transfer(self.start_transfer(t_spec))

    def basic_authorization(self, username, password):
        '''Create basic auth header'''
        return f'Basic {base64.b64encode(f"{username}:{password}".encode()).decode()}'

    def basic_auth_header_key_value(self, username, password):
        '''Create basic auth header key and value for transfer SDK'''
        return {
            'key': 'Authorization',
            'value': self.basic_authorization(username, password),
        }
