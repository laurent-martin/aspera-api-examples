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
import shutil
import logging
import signal
import tempfile
import subprocess
from utils.configuration import log_dump
from urllib.parse import urlparse

# avoid message: 'Other threads are currently calling into gRPC, skipping fork() handlers'
os.environ['GRPC_ENABLE_FORK_SUPPORT'] = 'false'

# import gRPC stubs (Transfer SDK API), make sure it is in PYTHONPATH
import transferd_pb2_grpc as transfer_manager_grpc  # noqa: E4
import transferd_pb2 as transfer_manager  # noqa: E4

ASCP_LOG_FILE = "aspera-scp-transfer.log"
DEBUG_HTTP = False
# default port of transferd if not specified in URL
TRANSFERD_DEFAULT_PORT = 55002
# max wait time for the daemon to stop gracefully
SHUTDOWN_TIMEOUT_SEC = 10
# max wait time for the daemon to write its port file
STARTUP_TIMEOUT_SEC = 10
# extension of the port file, written in `runtime_dir` with port 0: `transferd.<port>.optport`
PORT_FILE_EXTENSION = '.optport'


class TransferClient:
    '''Client of the Aspera Transfer Daemon (transferd): start the daemon, start transfers and wait for their end.'''

    def __init__(self, config):
        '''
        Create a transfer client.

        :param config: configuration of the samples
        '''
        self._config = config
        sdk_url = urlparse(self._config.param('trsdk', 'url'))
        self._server_address = sdk_url.hostname
        self._server_port = sdk_url.port if sdk_url.port is not None else TRANSFERD_DEFAULT_PORT
        self._transfer_daemon_process = None
        self._channel = None
        self._transfer_service = None
        self._daemon_name = os.path.basename(self._config.get_path('sdk_daemon'))
        # folder of the configuration, output and logs of the daemon: a new one for each start
        self._daemon_folder = None
        self._daemon_log = None
        # `runtime_dir` of the daemon, where it writes its port file: only with port 0
        self._runtime_dir = None

    def create_config_file(self, conf_file):
        '''
        Create the configuration file of the daemon.

        See: https://developer.ibm.com/apis/catalog/aspera--aspera-transfer-sdk/Configuration%20File

        :param conf_file: path of the configuration file
        '''
        config_info = {
            'address': self._server_address,
            'port': self._server_port,
            'log_directory': self._daemon_folder,
            'log_level': self._config.param('trsdk', 'level'),
            'fasp_runtime': {
                'use_embedded': True,
                'log': {
                    'dir': self._daemon_folder,
                    'level': ascp_level(self._config.param('trsdk', 'ascp_level')),
                },
            },
        }
        if self._runtime_dir is not None:
            config_info['runtime_dir'] = self._runtime_dir
        config_data = json.dumps(config_info)
        with open(conf_file, 'w') as the_file:
            the_file.write(config_data)

    def start_daemon(self):
        '''Start the daemon, with its configuration, output and logs in a new folder of the log folder.'''
        # samples run at the same time do not share files
        self._daemon_folder = tempfile.mkdtemp(prefix=f'{self._daemon_name}.', dir=self._config._log_folder)
        file_base = os.path.join(self._daemon_folder, self._daemon_name)
        conf_file = f'{file_base}.conf'
        out_file = f'{file_base}.out'
        err_file = f'{file_base}.err'
        self._daemon_log = f'{file_base}.log'
        if self._server_port == 0:
            # the daemon writes its port file in this folder: of this daemon only, readable only by the user
            self._runtime_dir = os.path.join(self._daemon_folder, 'run')
            os.mkdir(self._runtime_dir, 0o700)
        command = [
            self._config.get_path('sdk_daemon'),
            '--config',
            conf_file,
        ]
        log_dump('Daemon command', ' '.join(command))
        log_dump('Daemon out', out_file)
        log_dump('Daemon err', err_file)
        log_dump('Daemon log', self._daemon_log)
        log_dump('Ascp log', os.path.join(self._daemon_folder, ASCP_LOG_FILE))
        self.create_config_file(conf_file)
        logging.info('Starting daemon')
        # the child process has its own copy of the file descriptors
        with open(out_file, 'w') as out, open(err_file, 'w') as err:
            self._transfer_daemon_process = subprocess.Popen(command, stdout=out, stderr=err)
        self.wait_daemon_listening()

    def wait_daemon_listening(self):
        '''
        Wait for the daemon to listen, and get the port if dynamically allocated (port 0).

        With port 0, the daemon writes its port in a file of its `runtime_dir` once it listens.
        This requires transferd 1.1.7 or later.
        '''
        deadline = time.monotonic() + STARTUP_TIMEOUT_SEC
        while True:
            exit_status = self._transfer_daemon_process.poll()
            if exit_status is not None:
                self._transfer_daemon_process = None
                raise Exception(f'Daemon exited with code {exit_status}, see log: {self._daemon_log}')
            # fixed port: readiness is checked on connection
            if self._server_port != 0:
                return
            port = read_port_file(self._runtime_dir)
            if port is not None:
                self._server_port = port
                return
            if time.monotonic() > deadline:
                raise Exception(f'Port file not found in {self._runtime_dir}: transferd 1.1.7 or later is required')
            time.sleep(0.2)

    def connect_to_daemon(self):
        '''Connect to the daemon.'''
        channel_address = f'{self._server_address}:{self._server_port}'
        # create a connection to the transfer manager daemon
        channel = grpc.insecure_channel(channel_address)
        try:
            grpc.channel_ready_future(channel).result(timeout=5)
        except grpc.FutureTimeoutError:
            channel.close()
            raise Exception(f'Failed to connect to daemon: {channel_address}')
        # channel is ok, let's get the stub
        self._channel = channel
        self._transfer_service = transfer_manager_grpc.TransferServiceStub(channel)
        logging.info('Connected to daemon: %s', channel_address)

    def startup(self):
        '''
        Start the daemon and connect to it, if not already done.

        :return: this transfer client
        '''
        if self._transfer_service is None:
            try:
                self.start_daemon()
                self.connect_to_daemon()
            except Exception:
                # do not leave the daemon running
                self.shutdown()
                raise
        return self

    def shutdown(self):
        '''
        Stop the daemon, if it was started: send SIGINT, and kill it if it does not stop in time.

        Then delete its `runtime_dir`: a killed daemon does not delete its port file.
        '''
        self._transfer_service = None
        if self._channel is not None:
            self._channel.close()
            self._channel = None
        if self._transfer_daemon_process is not None:
            logging.info('Stopping daemon')
            stop_process(self._transfer_daemon_process)
            self._transfer_daemon_process = None
        if self._runtime_dir is not None:
            shutil.rmtree(self._runtime_dir, ignore_errors=True)
            self._runtime_dir = None

    def start_transfer_and_wait(self, transfer_spec):
        '''
        Start the daemon if needed, start a transfer, and wait for its end.

        :param transfer_spec: transfer spec
        '''
        # TODO: remove when transfer sdk bug fixed
        # transfer_spec['http_fallback'] = False
        self.startup()
        ts_json = json.dumps(transfer_spec)
        log_dump('Transfer spec', ts_json)
        transfer_request = transfer_manager.TransferRequest(
            transferType=transfer_manager.FILE_REGULAR,
            config=transfer_manager.TransferConfig(),
            transferSpec=ts_json,
        )
        # start the transfer: the daemon sends an event on each change, until the end of the transfer
        events = self._transfer_service.StartTransferWithMonitor(transfer_request)
        try:
            for event in events:
                status = event.status
                log_status(status, event.transferInfo.averageRateKbps)
                self.throw_on_error(event)
                if status == transfer_manager.COMPLETED:
                    return
        finally:
            # stop monitoring, if the stream is still open
            events.cancel()
        raise Exception('Transfer monitoring ended before transfer completion')

    def throw_on_error(self, event):
        '''
        Raise an exception if the transfer status is failed, canceled or unknown.

        :param event: event of the transfer
        '''
        if event.status in (transfer_manager.TransferStatus.FAILED, transfer_manager.TransferStatus.CANCELED):
            raise Exception("Transfer failed: " + error_description(event))
        if event.status == transfer_manager.TransferStatus.UNKNOWN_STATUS:
            raise Exception("Transfer status unknown: " + error_description(event))


def stop_process(process):
    '''
    Stop the daemon: send SIGINT, and kill it if it does not stop in time.

    transferd stops cleanly on SIGINT (not on SIGTERM).
    Windows has no SIGINT for child processes: the process is terminated.

    :param process: daemon process
    '''
    if os.name == 'nt':
        process.terminate()
    else:
        process.send_signal(signal.SIGINT)
    try:
        process.wait(timeout=SHUTDOWN_TIMEOUT_SEC)
    except subprocess.TimeoutExpired:
        logging.warning('Daemon did not stop, killing it')
        process.kill()
        process.wait()


def log_status(status, average_rate_kbps):
    '''
    Log the transfer status, and the rate when running.

    :param status: transfer status
    :param average_rate_kbps: average rate in kilobits per second
    '''
    rate = f' {average_rate_kbps / 1000:.1f} Mbps' if status == transfer_manager.RUNNING else ''
    logging.info('Transfer: %s%s', transfer_manager.TransferStatus.Name(status), rate)


def error_description(event):
    '''
    Get the first non-empty error description in an event.

    `error` is empty on session errors: the cause is in session or transfer information.

    :param event: event of the transfer
    :return: error description, or `unknown error`
    '''
    texts = (event.error.description, event.sessionInfo.errorDesc, event.transferInfo.errorDescription)
    return next((text.strip() for text in texts if text.strip()), 'unknown error')


def transfer_spec_from_setup(response_data):
    '''
    Get the transfer spec from the response of Node API `upload_setup` or `download_setup`, and raise an exception on error.

    The Node API may return an error in the response data, or an empty object, instead of an HTTP error.

    :param response_data: response data, for a single transfer request
    :return: transfer spec
    '''
    response_data = response_data or {}
    result = (response_data.get('transfer_specs') or [{}])[0]
    error = response_data.get('error') or result.get('error')
    if error:
        raise Exception(f"Node API error: {error.get('user_message')}")
    if 'transfer_spec' not in result:
        raise Exception('No transfer spec in Node API response')
    return result['transfer_spec']


def read_port_file(runtime_dir):
    '''
    Read the port of the daemon in its port file `transferd.<port>.optport`, in its `runtime_dir`.

    The daemon creates the file, then writes the port: an empty file is not ready yet.

    :param runtime_dir: `runtime_dir` of the daemon
    :return: port, or none if not written (yet)
    '''
    port_files = [os.path.join(runtime_dir, name) for name in os.listdir(runtime_dir)
                  if name.endswith(PORT_FILE_EXTENSION)]
    if not port_files:
        return None
    if len(port_files) > 1:
        raise Exception(f'Several port files in {runtime_dir}')
    with open(port_files[0]) as file:
        content = file.read()
    if content == '':
        return None
    if not re.fullmatch(r'[0-9]+', content):
        raise Exception(f'No port in file {port_files[0]}')
    return int(content)


def ascp_level(level_string):
    '''
    Convert the log level of ascp from name to number.

    :param level_string: `info`, `debug` or `trace`
    :return: 0, 1 or 2
    '''
    if level_string == 'info':
        return 0
    elif level_string == 'debug':
        return 1
    elif level_string == 'trace':
        return 2
    else:
        raise Exception(f'Invalid ascp_level: {level_string}')
