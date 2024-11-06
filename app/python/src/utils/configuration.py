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
DIR_TOP_VAR = 'DIR_TOP'
DEBUG_HTTP = False


class Configuration:
    '''Test Environment'''

    def __init__(self):
        self._file_list = sys.argv[1:]
        assert self._file_list, f'ERROR: Usage: {sys.argv[0]} <files to send>'
        self._top_folder = os.getenv(DIR_TOP_VAR)
        if self._top_folder is None:
            raise EnvironmentError(f"Environment variable {DIR_TOP_VAR} is not set.")
        self._top_folder = os.path.abspath(self._top_folder)
        if not os.path.isdir(self._top_folder):
            raise NotADirectoryError(f"The folder specified by {DIR_TOP_VAR} does not exist or is not a directory: {self._top_folder}")
        self._log_folder = tempfile.gettempdir()
        # read project's relative paths config file
        self._paths = yaml.load(open(os.path.join(self._top_folder, *PATHS_FILE_REL.split('/'))), Loader=yaml.FullLoader)
        # Read configuration from configuration file
        self._config = yaml.load(open(self.get_path('main_config')), Loader=yaml.FullLoader)
        log_level = getattr(logging, self.param('misc', 'level').upper(), logging.WARN)
        # set logger for debugging
        logging.basicConfig(format='%(levelname)-8s %(message)s', level=log_level)
        # debug http: see: https://stackoverflow.com/questions/10588644
        if DEBUG_HTTP:
            HTTPConnection.debuglevel = 1
            requests_log = logging.getLogger('requests.packages.urllib3')
            requests_log.setLevel(log_level)
            requests_log.propagate = True

    def param(self, section, param, default=None):
        if section not in self._config:
            raise KeyError(f"Section not found: {section}")
        if param not in self._config[section]:
            if default is not None:
                return default
            raise KeyError(f"Param not found: {param}")
        return self._config[section][param]

    def get_path(self, name):
        '''Get configuration sub-path in project's root folder'''
        item_path = os.path.join(self._top_folder, *self._paths[name].split('/'))
        assert os.path.exists(item_path), f'ERROR: {item_path} not found.'
        return item_path

    def file_list(self):
        '''
        Get list of files to transfer.

        It comes directly from the sample's command line arguments.
        '''
        return self._file_list

    def add_sources(self, t_spec: dict, path: str, destination=None):
        """
        Add source file list to transfer spec.

        List of file come directly from command line argument to sample code.

        The `path` is usually either 'paths' for a transfer spec V1,
        or 'assets.paths' for a transfer spec V2.
        """
        keys = path.split('.')
        current_node = t_spec
        for key in keys[:-1]:
            if isinstance(current_node, dict):
                current_node = current_node.get(key)
            else:
                raise KeyError(f"key is not a dict: {key}")
        paths = current_node[keys[-1]] = []
        for f in self._file_list:
            source = {'source': f}
            if destination is not None:
                source['destination'] = f.split('/')[-1]
            paths.append(source)


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
