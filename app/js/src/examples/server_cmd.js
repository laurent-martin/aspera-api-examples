//import { Buffer } from 'buffer';
//import { createConnection } from 'net';
import { Client } from 'ssh2';
import { spawn } from 'child_process';
import { join } from 'path';
import { URL } from 'url';
import { AsCmd } from '../utils/server.js';
import { Configuration, logger } from '../utils/configuration.js';

const ASCMD_COMMAND = 'ascmd';

/**
 * Perform file operations on the server with ascmd.
 * @param {AsCmd} ascmdAgent ascmd client
 * @param {string} existingFile path of a file on the server
 * @param {string} writableFolder path of a folder on the server, where files are created and deleted
 * @returns {Promise<void>}
 */
async function performTests(ascmdAgent, existingFile, writableFolder) {
    const copyFile = join(writableFolder, 'copied_file');
    const deleteFile = join(writableFolder, 'todelete_file');
    const deleteDir = join(writableFolder, 'todelete_dir');

    logger.info(`Server information: ${JSON.stringify(await ascmdAgent.info())}`);
    logger.info(`Disk space: ${JSON.stringify(await ascmdAgent.df())}`);
    logger.info(`File information: ${JSON.stringify(await ascmdAgent.ls(existingFile))}`);
    logger.info(`Folder content: ${JSON.stringify(await ascmdAgent.ls(writableFolder))}`);
    logger.info(`File MD5: ${JSON.stringify(await ascmdAgent.md5sum(existingFile))}`);
    logger.info(`Disk usage: ${JSON.stringify(await ascmdAgent.du(existingFile))}`);
    await ascmdAgent.cp(existingFile, copyFile);
    logger.info('File copied');
    await ascmdAgent.mv(copyFile, deleteFile);
    logger.info('File moved');
    await ascmdAgent.rm(deleteFile);
    logger.info('File deleted');
    await ascmdAgent.mkdir(deleteDir);
    logger.info('Folder created');
    await ascmdAgent.rm(deleteDir);
    logger.info('Folder deleted');
    await ascmdAgent.terminate();
}

/**
 * Test ascmd executed locally.
 * @returns {Promise<void>}
 */
async function testLocal() {
    logger.info('Testing local ascmd');
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
    const exitCode = await new Promise(resolve => command.on('close', resolve));
    logger.debug(`Ascmd exited with code ${exitCode}`);
}

/**
 * Test ascmd executed on the server through SSH.
 * @param {Configuration} config configuration of the samples
 * @returns {Promise<void>}
 */
async function testRemote(config) {
    logger.info('Testing remote ascmd');
    const serverUrl = config.getParam('server', 'url');
    const serverUri = new URL(serverUrl);
    if (serverUri.protocol !== 'ssh:') {
        throw new Error(`Expecting SSH URL: ${serverUrl}`);
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
    logger.debug(`Ascmd exited with code ${stream.exitCode}`);
    conn.end();
}

/**
 * Test ascmd executed locally, and on the server.
 * @returns {Promise<void>}
 */
async function main() {
    const config = new Configuration();

    await testLocal();
    await testRemote(config);
}

main().catch(console.error);

