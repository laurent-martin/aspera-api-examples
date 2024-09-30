#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# transfer files with Aspera HSTS using SSH authentication
import utils.configuration
import utils.transfer_client
import logging as log
import tempfile
import os
from urllib.parse import urlparse

config = utils.configuration.Configuration()
transfer_client = utils.transfer_client.TransferClient(config).startup()

try:
    # where transferred files will be stored
    my_local_folder = tempfile.gettempdir()

    server_url = urlparse(config.param('server', 'url'))
    assert server_url.scheme == 'ssh', 'expecting SSH scheme for server URL'

    remote_host = server_url.hostname
    remote_port = server_url.port
    remote_user = config.param('server', 'username')
    remote_pass = config.param('server', 'password')

    transfer_client._shutdown_after_transfer = False

    # Example 1: download
    # Instead of using the soon deprecated FaspManager1 Python lib, let's use the transfer spec
    # direction is relative to us, client, i.e. receive = download
    log.info('======Test 1: download')
    t_spec_download = {
        'remote_host': remote_host,
        'ssh_port': remote_port,
        'remote_user': remote_user,
        'remote_password': remote_pass,
        'direction': 'receive',
        'destination_root': my_local_folder,
        'paths': [{'source': config.param('server', 'file_download')}],
    }
    transfer_client.start_transfer_and_wait(t_spec_download)

    # location of downloaded file
    local_file = os.path.join(my_local_folder, os.path.basename(config.param('server', 'file_download')))

    # Example 2: upload: single file upload to existing folder.
    log.info('======Test 2: upload file')
    t_spec_upload = {
        'remote_host': remote_host,
        'ssh_port': remote_port,
        'remote_user': remote_user,
        'remote_password': remote_pass,
        'direction': 'send',
        'destination_root': config.param('server', 'folder_upload'),
        # 'create_dir':True, # destination root is folder, else it assumes (one source) it is dest file name
        'paths': [{'source': local_file}],
        'tags': {'mysample_tag': 'hello'},
    }
    transfer_client.start_transfer_and_wait(t_spec_upload)
    # check file is uploaded by connecting to: http://demo.asperasoft.com/aspera/user/ with same creds

    # Example 3: upload: single file upload to non-existing folder
    # if there is only one source file and destination does not exist, then 'FASP' assumes it is destination filename
    # but if destination is a folder, it will send same source filename into folder
    # so enforce folder creation, to be sure of what happens
    log.info('======Test 3: upload file to new folder')
    t_spec_upload['destination_root'] = config.param('server', 'folder_upload')+'/new_folder'
    t_spec_upload['create_dir'] = True
    transfer_client.start_transfer_and_wait(t_spec_upload)

    # Example 4: upload: send to sub folder, but using file pairs
    log.info('======Test 4: upload file and rename')
    t_spec_upload['destination_root'] = config.param('server', 'folder_upload')
    del t_spec_upload['create_dir']
    t_spec_upload['paths'] = [{'source': local_file, 'destination': 'xxx/newfilename.ext'}]
    transfer_client.start_transfer_and_wait(t_spec_upload)
finally:
    transfer_client.shutdown()
