//import { Buffer } from 'buffer';
//import { createConnection } from 'net';
import { Client } from 'ssh2';
import { spawn } from 'child_process';
import { join } from 'path';
import { URL } from 'url';
import { AsCmd } from '../utils/server.js';
import { Configuration, logger } from '../utils/configuration.js';

const ASCMD_COMMAND = 'ascmd';

async function performTests(ascmdAgent, existingFile, writableFolder) {
    const copyFile = join(writableFolder, 'copied_file');
    const deleteFile = join(writableFolder, 'todelete_file');
    const deleteDir = join(writableFolder, 'todelete_dir');

    logger.info('df:', await ascmdAgent.df());
    logger.info('info:', await ascmdAgent.info());
    logger.info('ls file:', await ascmdAgent.ls(existingFile));
    logger.info('ls dir:', await ascmdAgent.ls(writableFolder));
    logger.info('md5sum:', await ascmdAgent.md5sum(existingFile));
    logger.info('du:', await ascmdAgent.du(existingFile));
    logger.info('cp:', await ascmdAgent.cp(existingFile, copyFile));
    logger.info('mv:', await ascmdAgent.mv(copyFile, deleteFile));
    logger.info('rm file:', await ascmdAgent.rm(deleteFile));
    logger.info('mkdir:', await ascmdAgent.mkdir(deleteDir));
    logger.info('rm:', await ascmdAgent.rm(deleteDir));
    await ascmdAgent.terminate();
}

async function testLocal() {
    logger.info('== TEST LOCAL =============');
    const protocol_version = 2;
    const command = spawn(ASCMD_COMMAND, protocol_version !== 1 ? [`-V${protocol_version}`] : [], {
        env: { ...process.env, SSH_CLIENT: '' },
        stdio: ['pipe', 'pipe', 'pipe']
    });
    const ascmdAgent = new AsCmd(command.stdin, command.stdout, '', protocol_version);
    await performTests(
        ascmdAgent,
        '/workspace/aspera/rust_ascmd/README.md',
        '/workspace/aspera/rust_ascmd'
    );
    logger.info('wait for exit');
    const exitCode = await new Promise(resolve => command.on('close', resolve));
    logger.info(`ascmd exited with ${exitCode}`);
}

async function testRemote(config) {
    logger.info('== TEST REMOTE =============');
    const serverUrl = config.getParam('server', 'url');
    const serverUri = new URL(serverUrl);
    logger.info('Server URL:', serverUrl);
    if (serverUri.protocol !== 'ssh:') {
        throw new Error('Invalid server URL protocol');
    }
    const host = serverUri.hostname;
    const port = serverUri.port || 33001;
    const username = config.getParam('server', 'username');
    const password = config.getParam('server', 'password');
    const protocol_version = 2;
    const conn = new Client();
    await new Promise((resolve, reject) => {
        conn.on('ready', resolve).on('error', reject).connect({
            host,
            port,
            username,
            password
        });
    });

    const stream = await new Promise((resolve, reject) => {
        conn.exec(
            protocol_version === 1 ? ASCMD_COMMAND : `${ASCMD_COMMAND} -V${protocol_version}`,
            (err, stream) => {
                if (err) reject(err);
                else resolve(stream);
            }
        );
    });
    const ascmdAgent = new AsCmd(stream, stream, host, protocol_version);
    await performTests(
        ascmdAgent,
        config.getParam('server', 'file_download'),
        config.getParam('server', 'folder_upload')
    );
    await new Promise(resolve => stream.on('close', resolve));
    logger.info('Command exited with status:', stream.exitCode);
    conn.end();
}

async function main() {
    const config = new Configuration();

    await testLocal();
    await testRemote(config);
}

main().catch(console.error);

