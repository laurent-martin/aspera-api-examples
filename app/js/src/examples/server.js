#!/usr/bin/env node
// laurent.martin.aspera@fr.ibm.com
import { TransferClient } from '../utils/transfer_client.js';
import { Configuration, logger } from '../utils/configuration.js';
import path from 'path';
import assert from 'assert';

const config = new Configuration();
const transferClient = new TransferClient(config);

// get destination server from example config
const server_url = new URL(config.getParam('server','url'));
assert(server_url.protocol === 'ssh:', 'Expecting SSH protocol');

// downloaded file is then uploaded
const local_file = path.join('/', config.tmpFolder, config.getParam('server','file_download').split('/').pop());

// base transfer spec V1 with server information
var t_spec1_generic = {
	remote_host: server_url.hostname,
	ssh_port: parseInt(server_url.port),
	remote_user: config.getParam('server','username'),
	remote_password: config.getParam('server','password'),
}

// Example 1: download
// Instead of using the soon deprecated FaspManager1 Python lib, let's use the transfer spec
// direction is relative to us, client, i.e. receive = download
const test1 = (success_cb) => {
	logger.info('======Test 1: download');
	t_spec1_generic.direction = 'receive';
	// note that the destination root on download is relative to the CWD of transferd, NOT this process
	// so prefer to use abs. paths
	t_spec1_generic.destination_root = config.tmpFolder;
	t_spec1_generic.paths = [{ source: config.getParam('server','file_download') }];
	transferClient.startTransferAndWait(t_spec1_generic, success_cb);
}

// Example 2: upload: single file upload to existing folder.
const test2 = (success_cb) => {
	logger.info('======Test 2: upload file');
	t_spec1_generic.direction = 'send';
	t_spec1_generic.destination_root = config.getParam('server','folder_upload');
	t_spec1_generic.paths = [{ source: local_file }];
	t_spec1_generic.tags = { my_sample_tag: 'hello' };
	transferClient.startTransferAndWait(t_spec1_generic, success_cb);
}
// check file is uploaded by connecting to: http://demo.asperasoft.com/aspera/user/ with same creds

// Example 3: upload: single file upload to non-existing folder
// if there is only one source file and destination does not exist, then "FASP" assumes it is destination filename
// but if destination is a folder, it will send same source filename into folder
// so enforce folder creation, to be sure of what happens
const test3 = (success_cb) => {
	logger.info('======Test 3: upload file to new folder');
	t_spec1_generic.destination_root = config.getParam('server','folder_upload') + '/new_folder';
	t_spec1_generic.create_dir = true;
	transferClient.startTransferAndWait(t_spec1_generic, success_cb);
}

// Example 4: upload: send to sub folder, but using file pairs
const test4 = (success_cb) => {
	logger.info('======Test 4: upload file and rename');
	t_spec1_generic.destination_root = config.getParam('server','folder_upload');
	delete t_spec1_generic.create_dir;
	t_spec1_generic.paths = [{ source: local_file, destination: 'xxx/newfilename.ext' }];
	transferClient.startTransferAndWait(t_spec1_generic, success_cb);
}

// test runner is sequentially called after success of each test
var index = -1;
const test_runner = () => {
	++index;
	switch (index) {
		case 0: transferClient.startConnectDaemon(test_runner); break;
		case 1: test1(test_runner); break;
		case 2: test2(test_runner); break;
		case 3: test3(test_runner); break;
		case 4: test4(test_runner); break;
		case 5: transferClient.shutdownDaemon(test_runner); break;
		case 6: logger.info('Finished all tests!'); process.exit(0); break;
		default: throw 'Error: shall not reach here'
	}
}

// wait for server and start test 1
test_runner()
logger.info('Waiting for test completion...')
