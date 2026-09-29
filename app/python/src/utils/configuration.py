#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Common library for sample scripts
# Helper methods to get API environment according to config file
# Simplified function to start transfer and wait for it to finish
import os
import re
import sys
import json
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
# secrets in logs: value of JSON keys ending with one of those words, and JWT assertion in form parameters
SECRETS_REGEX = re.compile(r'("[^"]*(?:assertion|authorization|password|private_key|secret|token)"\s*:\s*")[^"]+|(assertion=)[^&]+')
# set from configuration file (misc.show_secrets)
show_secrets = False


class Configuration:
    '''Configuration of the samples: parameters from the configuration file, files to transfer from the command line, and logging.'''

    def __init__(self):
        '''Read the configuration file, and set up logging.'''
        self._file_list = sys.argv[1:]
        if not self._file_list:
            raise Exception('Missing arguments: files to transfer')
        self._top_folder = os.getenv(DIR_TOP_VAR)
        if self._top_folder is None:
            raise EnvironmentError(f'Environment variable {DIR_TOP_VAR} is not set')
        self._top_folder = os.path.abspath(self._top_folder)
        if not os.path.isdir(self._top_folder):
            raise NotADirectoryError(f'Folder not found: {self._top_folder}')
        self._log_folder = tempfile.gettempdir()
        # read project's relative paths config file
        with open(os.path.join(self._top_folder, *PATHS_FILE_REL.split('/'))) as paths_file:
            self._paths = yaml.safe_load(paths_file)
        # Read configuration from configuration file
        with open(self.get_path('main_config')) as config_file:
            self._config = yaml.safe_load(config_file)
        level_name = self.param('misc', 'level')
        log_level = logging.getLevelName(level_name.upper())
        if not isinstance(log_level, int):
            raise ValueError(f'Invalid log level: {level_name}')
        global show_secrets
        show_secrets = self.param('misc', 'show_secrets', False)
        # set logger for debugging
        logging.basicConfig(format='%(levelname)-8s %(message)s', level=log_level)
        # debug http: see: https://stackoverflow.com/questions/10588644
        if DEBUG_HTTP:
            HTTPConnection.debuglevel = 1
            requests_log = logging.getLogger('requests.packages.urllib3')
            requests_log.setLevel(log_level)
            requests_log.propagate = True

    def param(self, section, param, default=None):
        '''
        Get a parameter from the configuration file.

        :param section: section in the configuration file
        :param param: name of the parameter in the section
        :param default: value if the parameter is not set, else the parameter is mandatory
        :return: value of the parameter
        '''
        if param not in (self._config.get(section) or {}):
            if default is not None:
                return default
            raise KeyError(f'Configuration parameter not found: {section}.{param}')
        return self._config[section][param]

    def get_path(self, name):
        '''
        Get the path of an item of the project, from the paths file.

        :param name: name of the item in the paths file
        :return: absolute path of the item, that must exist
        '''
        item_path = os.path.join(self._top_folder, *self._paths[name].split('/'))
        if not os.path.exists(item_path):
            raise FileNotFoundError(f'File not found: {item_path}')
        return item_path

    def file_list(self):
        '''
        Get the files to transfer, from the command line arguments.

        :return: list of files
        '''
        return self._file_list

    def add_sources(self, t_spec: dict, path: str, destination=None):
        '''
        Add the files to transfer, from the command line arguments, to the transfer spec.

        :param t_spec: transfer spec to modify
        :param path: path of the file list in the transfer spec: `paths` (V1) or `assets.paths` (V2)
        :param destination: if set, add the file name as destination
        '''
        keys = path.split('.')
        current_node = t_spec
        for key in keys[:-1]:
            if isinstance(current_node, dict):
                current_node = current_node.get(key)
            else:
                raise KeyError(f'Invalid path in transfer spec: {path}')
        paths = current_node[keys[-1]] = []
        for f in self._file_list:
            source = {'source': f}
            if destination is not None:
                source['destination'] = os.path.basename(f)
            paths.append(source)


def mask_secrets(text):
    '''
    Hide secrets in text for logs, unless configured to show them.

    :param text: text that may contain secrets
    :return: text with hidden secrets
    '''
    if show_secrets:
        return text
    return SECRETS_REGEX.sub(r'\1\2***', text)


def log_dump(name, value, level=logging.DEBUG):
    '''
    Log a named value: objects are displayed in JSON, and secrets are hidden.

    :param name: name of the value
    :param value: value to log: a string, or an object displayed in JSON
    :param level: log level, debug by default
    '''
    if not logging.getLogger().isEnabledFor(level):
        return
    if not isinstance(value, str):
        value = json.dumps(value)
    logging.log(level, '%s: %s', name, mask_secrets(value))


def basic_authorization(username, password):
    '''
    Create the value of an HTTP Basic Authorization header.

    :param username: user name
    :param password: password
    :return: header value: `Basic <base64>`
    '''
    return f'Basic {base64.b64encode(f"{username}:{password}".encode()).decode()}'


def basic_auth_header_key_value(username, password):
    '''
    Create an HTTP Basic Authorization header for a transfer spec V2.

    :param username: user name
    :param password: password
    :return: header as `key` and `value`
    '''
    return {
        'key': 'Authorization',
        'value': basic_authorization(username, password),
    }

