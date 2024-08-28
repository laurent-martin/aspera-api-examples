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
# from http.client import HTTPConnection
from urllib.parse import urlparse


# tell where to find gRPC stubs: transfer_pb2 and transfer_pb2_grpc
sys.path.insert(1, os.environ['PYTHON_SRC_GEN'])

# before stub import: protobuf: avoid incompatibility of version, use pure python implementation
os.environ['PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION'] = 'python'

# import gRPC stubs (Transfer SDK API)
import transfer_pb2_grpc as transfer_manager_grpc  # noqa: E4
import transfer_pb2 as transfer_manager  # noqa: E4

# config file with sub-paths in project's root folder
PATHS_FILE = 'config/paths.yaml'
TRANSFER_SDK_DAEMON = 'asperatransferd'


class TestEnvironment:
    '''Test Environment'''

    def __init__(self):
        # Global vars
        self._transfer_daemon_process = None
        self._sdk_client = None
        self._shutdown_after_transfer = True
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
        # use 'ascp' in PATH, add the one from SDK
        # os.environ['PATH'] += self._arch_folder

        # set logger for debugging
        logging.basicConfig()
        logging.getLogger().setLevel(logging.DEBUG)

        # debug http: see: https://stackoverflow.com/questions/10588644
        # HTTPConnection.debuglevel = 1
        # requests_log = logging.getLogger('requests.packages.urllib3')
        # requests_log.setLevel(logging.DEBUG)
        # requests_log.propagate = True

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

    def start_daemon(self, sdk_grpc_url):
        '''
        Start transfer manager daemon if not already running

        @return gRPC client
        '''
        # avoid message: 'Other threads are currently calling into gRPC, skipping fork() handlers'
        os.environ['GRPC_ENABLE_FORK_SUPPORT'] = 'false'
        # create a connection to the transfer manager daemon, in case it is running
        grpc_url = urlparse(sdk_grpc_url)
        channel = grpc.insecure_channel(f'{grpc_url.hostname}:{grpc_url.port}')
        # try to start daemon a few times if needed
        for i in range(0, 2):
            try:
                print(
                    f'Connecting to {TRANSFER_SDK_DAEMON} using gRPC: {grpc_url.hostname} {grpc_url.port}...'
                )
                grpc.channel_ready_future(channel).result(timeout=3)
                print('SUCCESS: connected')
                # channel is ok, let's get the stub
                self._sdk_client = transfer_manager_grpc.TransferServiceStub(channel)
            except grpc.FutureTimeoutError:
                print('ERROR: Failed to connect\nStarting daemon...')
                # else prepare config and start
                bin_folder = self._arch_folder
                log_folder = tempfile.gettempdir()
                # see https://developer.ibm.com/apis/catalog/aspera--aspera-transfer-sdk/Configuration%20File
                config = {
                    'address': grpc_url.hostname,
                    'port': grpc_url.port,
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
                print(f'Starting: {" ".join(command)}')
                print(f'stderr: {err_file}')
                print(f'stdout: {out_file}')
                print(f'sdk log: {log_folder}/asperatransferd.log')
                print(f'xfer log: {log_folder}/aspera-scp-transfer.log')
                self._transfer_daemon_process = subprocess.Popen(
                    ' '.join(command),
                    shell=True,
                    stdout=open(out_file, 'w'),
                    stderr=open(err_file, 'w'),
                )
                self._transfer_daemon_process.poll()
                # give time for startup
                time.sleep(5)
            if self._sdk_client is not None:
                break
        if self._sdk_client is None:
            print(
                'ERROR: daemon not started or cannot be started.\nCheck the logs: daemon.err and daemon.out (see paths above).'
            )
            exit(1)
        return self._sdk_client

    def start_transfer(self, transfer_spec):
        '''Start a transfer and return transfer id'''

        logging.debug(transfer_spec)
        # create a transfer request
        transfer_request = transfer_manager.TransferRequest(
            transferType=transfer_manager.FILE_REGULAR,
            config=transfer_manager.TransferConfig(),
            transferSpec=json.dumps(transfer_spec),
        )
        # send start transfer request to transfer manager daemon
        transfer_response = self._sdk_client.StartTransfer(transfer_request)
        if 4 == transfer_response.status:
            print('ERROR: {0}'.format(transfer_response.error.description))
            exit(1)
        return transfer_response.transferId

    def wait_transfer(self, transfer_id):
        '''Wait for transfer to finish'''
        print('transfer started with id {0}'.format(transfer_id))
        # monitor transfer status
        for transfer_info in self._sdk_client.MonitorTransfers(
            transfer_manager.RegistrationRequest(
                filters=[transfer_manager.RegistrationFilter(
                    transferId=[transfer_id])]
            )
        ):
            print('>>>>>>>>>>>>>>>>>>>>>>>>>>>>\ntransfer info {0}'.format(
                transfer_info))
            # check transfer status in response, and exit if it's done
            status = transfer_info.status
            # exit on first success or failure
            if status == transfer_manager.COMPLETED:
                print('finished transfer: status: {0}'.format(status))
                break
            if status == transfer_manager.FAILED:
                raise Exception(transfer_info.message)

    def shutdown(self):
        '''Shutdown transfer manager daemon, if needed'''
        if self._transfer_daemon_process is not None:
            # self._transfer_daemon_process.send_signal(signal.CTRL_C_EVENT)
            # self._transfer_daemon_process.terminate()
            self._transfer_daemon_process.kill()
            self._transfer_daemon_process.wait()
            self._transfer_daemon_process = None
            print('transfer daemon has been terminated')
        else:
            print('transfer daemon not started by this process, or already terminated')

    def start_transfer_and_wait(self, t_spec):
        '''One-call simplified procedure to start daemon, transfer and wait for it to finish'''
        # TODO: remove when transfer sdk bug fixed
        t_spec['http_fallback'] = False
        logging.debug(t_spec)
        try:
            if self._sdk_client is None:
                self._sdk_client = self.start_daemon(self._config['trsdk']['url'])
            t_id = self.start_transfer(t_spec)
            self.wait_transfer(t_id)
        finally:
            if self._shutdown_after_transfer:
                self.shutdown()

    def basic_authorization(self, username, password):
        '''Create basic auth header'''
        return f'Basic {base64.b64encode(f"{username}:{password}".encode()).decode()}'

    def basic_auth_header_key_value(self, username, password):
        '''Create basic auth header key and value for transfer SDK'''
        return {
            'key': 'Authorization',
            'value': self.basic_authorization(username, password),
        }
