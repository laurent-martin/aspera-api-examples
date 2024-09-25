#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Common library for sample scripts
# Helper methods to get API environment according to config file
# Simplified function to start transfer and wait for it to finish
import os
import sys
import yaml
import logging
import tempfile
import base64
from http.client import HTTPConnection
from urllib.parse import urlparse


# config file with sub-paths in project's root folder
PATHS_FILE_REL = 'config/paths.yaml'
DEBUG_HTTP = False


class Tools:
    '''Test Environment'''

    def __init__(self):
        self._file_list = sys.argv[1:]
        assert self._file_list, f'ERROR: Usage: {sys.argv[0]} <files to send>'
        self._top_folder = os.path.abspath(os.path.join(
            os.path.dirname(__file__), '..', '..', '..'))
        self._log_folder = tempfile.gettempdir()
        # read project's relative paths config file
        self._paths = yaml.load(
            open(os.path.join(self._top_folder, *PATHS_FILE_REL.split('/'))), Loader=yaml.FullLoader
        )
        # Read configuration from configuration file
        self._config = yaml.load(
            open(self.get_path('main_config')), Loader=yaml.FullLoader)
        # Error hint to help user to fix the issue
        self._error_hint = f'\nPlease check: SDK installed in {
            self._paths["sdk_root"]}, configuration file: {self._paths["main_config"]}'
        # folder with SDK binaries
        self._arch_folder = os.path.join(
            self.get_path('sdk_root'), self.conf('misc', 'platform'))
        assert os.path.exists(
            self._arch_folder
        ), f'ERROR: SDK not found in: {self._arch_folder}.{self._error_hint}'
        log_level = getattr(logging, self.conf(
            'misc', 'level').upper(), logging.WARN)
        # set logger for debugging
        logging.basicConfig(
            format='%(levelname)-8s %(message)s',
            level=log_level
        )
        # debug http: see: https://stackoverflow.com/questions/10588644
        if DEBUG_HTTP:
            HTTPConnection.debuglevel = 1
            requests_log = logging.getLogger('requests.packages.urllib3')
            requests_log.setLevel(log_level)
            requests_log.propagate = True

    def conf(self, *keys):
        current_node = self._config

        for key in keys:
            if key in current_node:
                current_node = current_node[key]
            else:
                raise KeyError(f"Key not found: {key}")
        return current_node

    def get_path(self, name):
        '''Get configuration sub-path in project's root folder'''
        item_path = os.path.join(
            self._top_folder, *self._paths[name].split('/'))
        assert os.path.exists(item_path), f'ERROR: {
            item_path} not found.{self._error_hint}'
        return item_path

    def file_list(self):
        '''Get list of files to transfer'''
        return self._file_list


def basic_authorization(username, password):
    '''Create basic auth header'''
    return f'Basic {base64.b64encode(f"{username}:{password}".encode()).decode()}'


def basic_auth_header_key_value(username, password):
    '''Create basic auth header key and value for transfer SDK'''
    return {
        'key': 'Authorization',
        'value': basic_authorization(username, password),
    }


def last_file_line(filename):
    with open(filename, 'rb') as file:
        # Seek to the end of the file
        file.seek(0, 2)
        position = file.tell() - 1
        last_line = b''

        # Read backwards until a newline or beginning of the file
        while position >= 0:
            file.seek(position)
            char = file.read(1)
            if char == b'\n' and last_line:
                break
            last_line = char + last_line
            position -= 1

        # Decode the binary string to a regular string
        return last_line.decode('utf-8')
