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


# get project root folder
TOP_FOLDER = os.path.abspath(os.path.join(
    os.path.dirname(__file__), '..', '..'))

# config file with sub-paths in project's root folder
PATHS_FILE = 'config/paths.yaml'

# read project's relative paths config file
PATHS = yaml.load(
    open(os.path.join(TOP_FOLDER, *PATHS_FILE.split('/'))), Loader=yaml.FullLoader
)

# Error hint to help user to fix the issue
ERROR_HINT = f'\nPlease check: SDK installed in {PATHS["sdk_root"]}, configuration file: {PATHS["main_config"]}'


def get_path(name):
    '''Get con figuration sub-path in project's root folder'''
    item_path = os.path.join(TOP_FOLDER, *PATHS[name].split('/'))
    assert os.path.exists(item_path), f'ERROR: {item_path} not found.{ERROR_HINT}'
    return item_path


# Read configuration from configuration file
CONFIG = yaml.load(open(get_path('main_config')), Loader=yaml.FullLoader)

# location of gRPC stubs
python_stub_folder = os.path.join(
    get_path('trsdk_noarch'), 'connectors', 'python')

assert os.path.exists(
    python_stub_folder
), f'ERROR: python stubs not found in: {python_stub_folder}.{ERROR_HINT}'

# tell where to find gRPC stubs: transfer_pb2 and transfer_pb2_grpc
sys.path.insert(1, python_stub_folder)

# before stub import: protobuf: avoid incompatibility of version, use pure python implementation
os.environ['PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION'] = 'python'

# import gRPC stubs (Transfer SDK API)
import transfer_pb2_grpc as transfer_manager_grpc  # noqa: E4
import transfer_pb2 as transfer_manager  # noqa: E4

# folder with executables
arch_folder = os.path.join(get_path('sdk_root'), CONFIG['misc']['system_type'])
assert os.path.exists(
    arch_folder
), f'ERROR: SDK not found in: {arch_folder}.{ERROR_HINT}'
# use 'ascp' in PATH, add the one from SDK
os.environ['PATH'] += arch_folder

# set logger for debugging
logging.basicConfig()
logging.getLogger().setLevel(logging.DEBUG)

# debug http: see: https://stackoverflow.com/questions/10588644
HTTPConnection.debuglevel = 1
requests_log = logging.getLogger('requests.packages.urllib3')
requests_log.setLevel(logging.DEBUG)
requests_log.propagate = True

# Global vars
transfer_daemon_process = None
sdk_client = None
shutdown_after_transfer = True
file_list = sys.argv[1:]

assert file_list, f'ERROR: Usage: {sys.argv[0]} <files to send>'

TRANSFER_SDK_DAEMON = 'asperatransferd'


def get_configuration(key):
    '''Get configuration value for specific app'''
    assert key in CONFIG, f'configuration for {key} is missing'
    return CONFIG[key]


def start_daemon(sdk_grpc_url):
    '''
    Start transfer manager daemon if not already running

    @return gRPC client
    '''
    global transfer_daemon_process
    global sdk_client
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
            sdk_client = transfer_manager_grpc.TransferServiceStub(channel)
        except grpc.FutureTimeoutError:
            print('ERROR: Failed to connect\nStarting daemon...')
            # else prepare config and start
            bin_folder = arch_folder
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
                        'etc': get_path('trsdk_noarch'),
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
            transfer_daemon_process = subprocess.Popen(
                ' '.join(command),
                shell=True,
                stdout=open(out_file, 'w'),
                stderr=open(err_file, 'w'),
            )
            transfer_daemon_process.poll()
            # give time for startup
            time.sleep(5)
        if sdk_client is not None:
            break
    if sdk_client is None:
        print(
            'ERROR: daemon not started or cannot be started.\nCheck the logs: daemon.err and daemon.out (see paths above).'
        )
        exit(1)
    return sdk_client


def start_transfer(transfer_spec):
    '''Start a transfer and return transfer id'''
    global sdk_client
    # create a transfer request
    transfer_request = transfer_manager.TransferRequest(
        transferType=transfer_manager.FILE_REGULAR,
        config=transfer_manager.TransferConfig(),
        transferSpec=json.dumps(transfer_spec),
    )
    # send start transfer request to transfer manager daemon
    transfer_response = sdk_client.StartTransfer(transfer_request)
    if 4 == transfer_response.status:
        print('ERROR: {0}'.format(transfer_response.error.description))
        exit(1)
    return transfer_response.transferId


def wait_transfer(transfer_id):
    '''Wait for transfer to finish'''
    global sdk_client
    print('transfer started with id {0}'.format(transfer_id))
    # monitor transfer status
    for transfer_info in sdk_client.MonitorTransfers(
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
            print('finished {0}'.format(status))
            break
        if status == transfer_manager.FAILED:
            raise Exception(transfer_info.message)


def shutdown():
    '''Shutdown transfer manager daemon, if needed'''
    global transfer_daemon_process
    if transfer_daemon_process is not None:
        # transfer_daemon_process.send_signal(signal.CTRL_C_EVENT)
        # transfer_daemon_process.terminate()
        transfer_daemon_process.kill()
        transfer_daemon_process.wait()
        transfer_daemon_process = None
        print('transfer daemon has been terminated')
    else:
        print('transfer daemon not started by this process, or already terminated')


def start_transfer_and_wait(t_spec):
    '''One-call simplified procedure to start daemon, transfer and wait for it to finish'''
    global sdk_client
    global shutdown_after_transfer
    # TODO: remove when transfer sdk bug fixed
    t_spec['http_fallback'] = False
    logging.debug(t_spec)
    try:
        if sdk_client is None:
            sdk_client = start_daemon(CONFIG['misc']['trsdk_url'])
        t_id = start_transfer(t_spec)
        wait_transfer(t_id)
    finally:
        if shutdown_after_transfer:
            shutdown()


def basic_authorization(username, password):
    '''Create basic auth header'''
    return f'Basic {base64.b64encode(f"{username}:{password}".encode()).decode()}'


def basic_auth_header_key_value(username, password):
    '''Create basic auth header key and value for transfer SDK'''
    return {
        'key': 'Authorization',
        'value': basic_authorization(username, password),
    }
