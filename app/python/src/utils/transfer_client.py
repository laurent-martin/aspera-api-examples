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
import signal
import subprocess
import utils.configuration
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
SHUTDOWN_TIMEOUT_SEC = 5
# max wait time for the daemon to log its listening port
STARTUP_TIMEOUT_SEC = 10
# API port in daemon log (text or JSON log format), e.g. `API Server: Listening on 127.0.0.1:55002 ...`
LISTENING_PORT_REGEX = re.compile(r'API Server: Listening on [^\s"]+:(\d+)')


class TransferClient:
    '''Transfer Client using Aspera Transfer SDK'''

    def __init__(self, config):
        self._config = config
        sdk_url = urlparse(self._config.param('trsdk', 'url'))
        self._server_address = sdk_url.hostname
        self._server_port = sdk_url.port if sdk_url.port is not None else TRANSFERD_DEFAULT_PORT
        self._transfer_daemon_process = None
        self._channel = None
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
        command = [
            self._config.get_path('sdk_daemon'),
            '--config',
            conf_file,
        ]
        logging.debug('daemon out: %s', out_file)
        logging.debug('daemon err: %s', err_file)
        logging.debug('daemon log: %s', self._daemon_log)
        logging.debug('ascp log: %s', os.path.join(
            self._config._log_folder, ASCP_LOG_FILE))
        logging.debug('command: %s', ' '.join(command))
        self.create_config_file(conf_file)
        # the log file may contain lines of previous executions: only read new lines
        log_offset = os.path.getsize(self._daemon_log) if os.path.exists(self._daemon_log) else 0
        logging.info('Starting daemon...')
        # the child process has its own copy of the file descriptors
        with open(out_file, 'w') as out, open(err_file, 'w') as err:
            self._transfer_daemon_process = subprocess.Popen(command, stdout=out, stderr=err)
        self.wait_daemon_listening(log_offset)
        logging.info('Daemon started: %s', self._transfer_daemon_process.pid)

    def wait_daemon_listening(self, log_offset):
        '''
        Wait for the daemon to listen, and get the port if dynamically allocated (port 0).
        The port is read from the daemon log: requires log level `info` or more verbose.
        '''
        deadline = time.monotonic() + STARTUP_TIMEOUT_SEC
        while True:
            exit_status = self._transfer_daemon_process.poll()
            if exit_status is not None:
                self._transfer_daemon_process = None
                logging.error('Daemon not started.')
                logging.error('Exited with code: %s', exit_status)
                logging.error('Check daemon log: %s', self._daemon_log)
                raise Exception('daemon startup failed')
            # fixed port: readiness is checked on connection
            if self._server_port != 0:
                return
            port = find_listening_port(self._daemon_log, log_offset)
            if port is not None:
                self._server_port = port
                logging.info('Allocated server port: %s', self._server_port)
                return
            if time.monotonic() > deadline:
                raise Exception(f'Listening port not found in daemon log after {STARTUP_TIMEOUT_SEC}s: {self._daemon_log}')
            time.sleep(0.2)

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
            channel.close()
            raise Exception('failed to connect.')
        # channel is ok, let's get the stub
        self._channel = channel
        self._transfer_service = transfer_manager_grpc.TransferServiceStub(channel)
        logging.info('Connected !')

    def startup(self):
        '''Start and connect to transfer manager daemon'''
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
        '''Shutdown transfer manager daemon, if needed'''
        self._transfer_service = None
        if self._channel is not None:
            self._channel.close()
            self._channel = None
        if self._transfer_daemon_process is not None:
            logging.info('Shutting down daemon...')
            stop_process(self._transfer_daemon_process)
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
        self.throw_on_error(transfer_response)
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
            self.throw_on_error(transfer_info)
            if status == transfer_manager.COMPLETED:
                break

    def start_transfer_and_wait(self, t_spec):
        '''One-call simplified procedure to start daemon, transfer and wait for it to finish'''
        # TODO: remove when transfer sdk bug fixed
        # t_spec['http_fallback'] = False
        self.startup()
        self.wait_transfer(self.start_transfer(t_spec))

    def throw_on_error(self, response):
        '''raise exception if status of response (start or monitor) is an error'''
        if response.status == transfer_manager.TransferStatus.FAILED:
            logging.error(utils.configuration.last_file_line(self._daemon_log))
            raise Exception("transfer failed: " + error_description(response))
        if response.status == transfer_manager.TransferStatus.UNKNOWN_STATUS:
            raise Exception("unknown transfer id: " + error_description(response))


def stop_process(process):
    '''
    Stop the daemon gracefully, or kill it after a timeout.

    transferd stops cleanly on SIGINT (not on SIGTERM).
    Windows has no SIGINT for child processes: the process is terminated.
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


def error_description(response):
    '''
    Error description in a response.

    `error` is empty on session errors: the cause is in session or transfer information.
    '''
    texts = [response.error.description]
    for field, attribute in (('sessionInfo', 'errorDesc'), ('transferInfo', 'errorDescription')):
        if field in response.DESCRIPTOR.fields_by_name and response.HasField(field):
            texts.append(getattr(getattr(response, field), attribute))
    return next((text.strip() for text in texts if text.strip()), 'unknown error')


def find_listening_port(log_file, offset):
    '''Find the API listening port in the daemon log, after the given offset. Returns None if not found (yet).'''
    try:
        with open(log_file, 'rb') as file:
            content = file.read()
    except FileNotFoundError:
        return None
    # log file was truncated
    if len(content) < offset:
        offset = 0
    match = LISTENING_PORT_REGEX.search(content[offset:].decode('utf-8', errors='replace'))
    return int(match.group(1)) if match else None


def ascp_level(level_string):
    if level_string == 'info':
        return 0
    elif level_string == 'debug':
        return 1
    elif level_string == 'trace':
        return 2
    else:
        raise Exception('Invalid ascp_level: ' + level_string)
