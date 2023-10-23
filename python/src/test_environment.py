#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Helper methods to get API environment according to config file
import sys
import os
import yaml
import logging
from http.client import HTTPConnection

# If the sample script is started individually, set env vars by executing: . ../../config.env
assert (
    "CONFIG_YAML" in os.environ
), "env var CONFIG_YAML is missing. To load environment execute: . ../../config.env"
assert (
    "CONFIG_TMPDIR" in os.environ
), "env var CONFIG_TMPDIR is missing. To load environment execute: . ../../config.env"
assert (
    "CONFIG_TRSDK_DIR_ARCH" in os.environ
), "env var CONFIG_TRSDK_DIR_ARCH is missing. To load environment execute: . ../../config.env"
assert (
    "CONFIG_TRSDK_DIR_GENERIC" in os.environ
), "env var CONFIG_TRSDK_DIR_GENERIC is missing"

# depending on flag, use new SDK, or old faspmanager
sys.path.insert(
    1, os.path.join(os.environ["CONFIG_TRSDK_DIR_GENERIC"], "connectors", "python")
)
import helper_aspera_transfer_sdk

# use "ascp" in PATH, add the one from sdk
os.environ["PATH"] += os.environ["CONFIG_TRSDK_DIR_ARCH"]


# set logger for debugging
logging.basicConfig()
logging.getLogger().setLevel(logging.DEBUG)

# debug http: see: https://stackoverflow.com/questions/10588644
HTTPConnection.debuglevel = 1
requests_log = logging.getLogger("requests.packages.urllib3")
requests_log.setLevel(logging.DEBUG)
requests_log.propagate = True

# where transferred files will be stored
tmp_folder = os.environ["CONFIG_TMPDIR"]

# configuration from configuration file
CONFIG = yaml.load(open(os.environ["CONFIG_YAML"]), Loader=yaml.FullLoader)

helper_aspera_transfer_sdk.set_grpc_url(CONFIG["misc"]["trsdk_url"])


def start_transfer_and_wait(t_spec):
    # TODO: remove when transfer sdk bug fixed
    t_spec["http_fallback"] = False
    logging.debug(t_spec)
    sdk_server = helper_aspera_transfer_sdk.start_daemon()
    t_id = helper_aspera_transfer_sdk.start_transfer(sdk_server, t_spec)
    helper_aspera_transfer_sdk.wait_transfer(sdk_server, t_id)
