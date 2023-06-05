#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Helper methods to get API environment according to config file
import sys
import os
import yaml
import logging

try:
    # Python 3
    import http.client as http_client
except ImportError:
    # Python 2
    import httplib as http_client

# If the sample script is started individually, set env vars by executing: . ../../config.env
assert 'CONFIG_YAML' in os.environ, 'env var CONFIG_YAML is missing. To load environment execute: . ../../config.env'
assert 'CONFIG_TMPDIR' in os.environ, 'env var CONFIG_TMPDIR is missing. To load environment execute: . ../../config.env'

# set logger for debugging
logging.basicConfig()
logging.getLogger().setLevel(logging.DEBUG)

# debug http: see: https://stackoverflow.com/questions/10588644
http_client.HTTPConnection.debuglevel = 1

# where transferred files will be stored
tmp_folder = os.environ['CONFIG_TMPDIR']

# use "ascp" in PATH, add the one from sdk
os.environ['PATH'] += os.environ['CONFIG_TRSDK_DIR_ARCH']

# configuration from configuration file
CONFIG = yaml.load(open(os.environ['CONFIG_YAML']), Loader=yaml.FullLoader)

# depending on flag, use new SDK, or old faspmanager
if CONFIG['misc']['client_sdk'] == 'transfer_sdk':
    assert 'CONFIG_TRSDK_DIR_ARCH' in os.environ, 'env var CONFIG_TRSDK_DIR_ARCH is missing'
    assert 'CONFIG_TRSDK_DIR_GENERIC' in os.environ, 'env var CONFIG_TRSDK_DIR_GENERIC is missing'
    sys.path.insert(1, os.path.join(
        os.environ['CONFIG_TRSDK_DIR_GENERIC'], 'connectors', 'python'))
    import helper_aspera_transfer_sdk

    helper_aspera_transfer_sdk.set_grpc_url(CONFIG['misc']['trsdk_url'])

    def start_transfer_and_wait(t_spec):
        # TODO: remove when transfer sdk bug fixed
        t_spec['http_fallback'] = False
        logging.debug(t_spec)
        helper_aspera_transfer_sdk.start_transfer_and_wait(t_spec)

elif CONFIG['misc']['client_sdk'] == 'faspmanager':
    assert 'CONFIG_FSMGR_DIR' in os.environ, 'env var CONFIG_FSMGR_DIR is missing'
    # tell where to find legacy faspmanager lib
    sys.path.insert(1, os.environ['CONFIG_FSMGR_DIR'])
    import helper_aspera_faspmanager

    def start_transfer_and_wait(t_spec):
        logging.debug(t_spec)
        helper_aspera_faspmanager.start_transfer_and_wait(t_spec)

else:
    logging.debug('no transfer method')

    def start_transfer_and_wait(t_spec):
        logging.debug('start_transfer_and_wait not implemented')
