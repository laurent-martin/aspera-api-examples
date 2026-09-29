// Required imports
import { Buffer } from 'buffer';
import { logger } from './configuration.js';
import { spawn } from 'child_process';
import { Readable, Writable } from 'stream';
import * as ssh2 from 'ssh2'; // Import SSH2 client library
import EventEmitter from 'events';

// Constants
const TYPE_SIZE = 1;
const LENGTH_SIZE = 4;
const END_OF_BUFFER = 0;

/**
 * TLV (Tag-Length-Value) item of the ascmd protocol.
 */
class TypeValue {
    /**
     * Create a TLV item.
     * @param {number} t tag
     * @param {Buffer} v value
     */
    constructor(t, v) {
        this.t = t;
        this.v = v;
    }
}

/**
 * Information about the platform.
 */
class Info {
    /**
     * Create empty information about the platform.
     */
    constructor() {
        this.platform = '';
        this.version = '';
        this.lang = '';
        this.territory = '';
        this.codeset = '';
        this.lc_ctype = '';
        this.lc_numeric = '';
        this.lc_time = '';
        this.lc_all = '';
        this.dev = [];
        this.browse_caps = '';
        this.protocol = 1;
    }

    /**
     * Decode a zero-terminated string.
     * @param {string} label name of the field, for errors
     * @param {Buffer} value data
     * @returns {string} string
     */
    static decodeZstr(label, value) {
        return value.toString('utf8').replace(/\0+$/, ''); // Remove null terminators
    }

    /**
     * Decode a 64-bit unsigned integer.
     * @param {string} label name of the field, for errors
     * @param {Buffer} value data
     * @returns {bigint} integer
     */
    static decodeU64(label, value) {
        return Buffer.from(value).readBigUInt64BE();
    }

    /**
     * Decode the information about the platform.
     * @param {Buffer} data TLV data
     * @returns {Promise<Info>} information about the platform
     */
    static async create(data) {
        const info = new Info();
        const reader = Buffer.from(data);
        let offset = 0;

        while (offset < reader.length) {
            const tlv = await Info.readTLV(reader, offset);
            if (!tlv) break;

            const { t, v, nextOffset } = tlv;
            offset = nextOffset;

            switch (t) {
                case END_OF_BUFFER:
                    break;
                case 1:
                    info.platform = Info.decodeZstr('platform', v);
                    break;
                case 2:
                    info.version = Info.decodeZstr('version', v);
                    break;
                case 3:
                    info.lang = Info.decodeZstr('lang', v);
                    break;
                case 4:
                    info.territory = Info.decodeZstr('territory', v);
                    break;
                case 5:
                    info.codeset = Info.decodeZstr('codeset', v);
                    break;
                case 6:
                    info.lc_ctype = Info.decodeZstr('lc_ctype', v);
                    break;
                case 7:
                    info.lc_numeric = Info.decodeZstr('lc_numeric', v);
                    break;
                case 8:
                    info.lc_time = Info.decodeZstr('lc_time', v);
                    break;
                case 9:
                    info.lc_all = Info.decodeZstr('lc_all', v);
                    break;
                case 10:
                    info.dev.push(Info.decodeZstr('dev', v));
                    break;
                case 11:
                    info.browse_caps = Info.decodeZstr('browse_caps', v);
                    break;
                case 12:
                    info.protocol = Info.decodeU64('protocol', v);
                    break;
                default:
                    throw new Error(`Unknown TLV tag: ${t}`);
            }
        }
        return info;
    }

    /**
     * Read a TLV item.
     * @param {Buffer} buffer TLV data
     * @param {number} offset offset of the item in the data
     * @returns {Promise<{t: number, v: Buffer, nextOffset: number}|null>} TLV item, and offset of the next item, or none at the end of the data
     */
    static async readTLV(buffer, offset) {
        if (offset >= buffer.length) return null;

        const t = buffer.readUInt8(offset);
        const l = buffer.readUInt32BE(offset + TYPE_SIZE);
        const v = buffer.slice(offset + TYPE_SIZE + LENGTH_SIZE, offset + TYPE_SIZE + LENGTH_SIZE + l);

        return { t, v, nextOffset: offset + TYPE_SIZE + LENGTH_SIZE + l };
    }
}

/**
 * Information about one drive.
 */
class Mnt {
    /**
     * Create the information about one drive.
     * @param {string} name name of the drive
     * @param {string} path mount point of the drive
     */
    constructor(name, path) {
        this.name = name;
        this.path = path;
    }
}

/**
 * Information about available drives.
 */
class Mounts {
    /**
     * Create empty information about available drives.
     */
    constructor() {
        this.mounts = [];
    }

    /**
     * Decode a zero-terminated string.
     * @param {Buffer} value data
     * @returns {string} string
     */
    static decodeZstr(value) {
        return value.toString('utf8').replace(/\0+$/, '');
    }

    /**
     * Decode the information about available drives.
     * @param {Buffer} data TLV data
     * @returns {Promise<Mounts>} information about available drives
     */
    static async create(data) {
        const mounts = new Mounts();
        const reader = Buffer.from(data);
        let offset = 0;

        while (offset < reader.length) {
            const tlv = await Info.readTLV(reader, offset);
            if (!tlv) break;

            const { t, v, nextOffset } = tlv;
            offset = nextOffset;

            if (t === 1) {
                const name = Mounts.decodeZstr(v);
                const path = Mounts.decodeZstr(v); // Assuming same decoding
                mounts.mounts.push(new Mnt(name, path));
            }
        }
        return mounts;
    }
}

/**
 * Information about a file or folder.
 */
class Stat {
    /**
     * Create the information about a file or folder.
     * @param {string} filename name of the file
     * @param {bigint} size size of the file
     */
    constructor(filename, size) {
        this.filename = filename;
        this.size = size;
    }
}

/**
 * Size information about a file or folder.
 */
class Size {
    /**
     * Create the size information about a file or folder.
     * @param {bigint} size size
     */
    constructor(size) {
        this.size = size;
    }

    /**
     * Decode a 64-bit unsigned integer.
     * @param {Buffer} value data
     * @returns {bigint} integer
     */
    static decodeU64(value) {
        return Buffer.from(value).readBigUInt64BE();
    }

    /**
     * Decode the size information about a file or folder.
     * @param {Buffer} data TLV data
     * @returns {Promise<Size>} size information
     */
    static async create(data) {
        const size = new Size();
        size.size = Size.decodeU64(data);
        return size;
    }
}

/**
 * Error returned by a command.
 */
class CommandError {
    /**
     * Create the error returned by a command.
     * @param {string} message error message
     */
    constructor(message) {
        this.message = message;
    }
}

/**
 * MD5 checksum of a file.
 */
class Md5sum {
    /**
     * Create the MD5 checksum of a file.
     * @param {string} hash MD5 checksum, in hexadecimal
     */
    constructor(hash) {
        this.hash = hash;
    }

    /**
     * Decode the MD5 checksum.
     * @param {Buffer} value data
     * @returns {string} MD5 checksum, in hexadecimal
     */
    static decodeHash(value) {
        return value.toString('hex');
    }

    /**
     * Decode the MD5 checksum of a file.
     * @param {Buffer} data TLV data
     * @returns {Promise<Md5sum>} MD5 checksum
     */
    static async create(data) {
        const md5sum = new Md5sum();
        md5sum.hash = Md5sum.decodeHash(data);
        return md5sum;
    }
}

/**
 * Client of the `ascmd` protocol: file operations on Aspera HSTS.
 */
class AsCmd {
    /**
     * Create an ascmd client: use `create` to start the protocol.
     * @param {Writable} stdin channel to which commands are written
     * @param {Readable} stdout channel from which TLV items are read
     * @param {string} host address of the server, to traverse a proxy
     * @param {number} version protocol version: 1 or 2
     */
    constructor(stdin, stdout, host, version) {
        if (!stdin || !stdout) {
            throw new Error('Stdin and stdout must not be null');
        }
        this.stdin = stdin;
        this.stdout = stdout;
        this.version = version;
        this.started = false;
    }
    /**
     * Create an ascmd client, and start the protocol.
     * @param {Writable} stdin channel to which commands are written
     * @param {Readable} stdout channel from which TLV items are read
     * @param {string} host address of the server, to traverse a proxy
     * @param {number} version protocol version: 1 or 2
     * @returns {Promise<AsCmd>} ascmd client
     */
    static async create(stdin, stdout, host, version) {
        const ascmd = new AsCmd(stdin, stdout, version);

        if (version === 2) {
            let command = 'session_init --protocol=2';
            if (host) {
                command += ` --host=${host}`;
            }
            await ascmd.sendCommand(command);
        } else if (version !== 1) {
            throw new Error(`Unsupported ascmd version: ${version}`);
        }

        const initialReader = Readable.from(stdout);
        const data = await AsCmd.readTLV(initialReader);
        if (data.tag !== 5) {
            throw new Error(`Expected tag 5, got: ${data.tag}`);
        }

        AsCmd.newInfo(data.value);

        return ascmd;
    }

    /**
     * Send a command to ascmd.
     * @param {string} command command, without `as_` prefix
     */
    async sendCommand(command) {
        logger.debug(`Sending command: as_${command}`);
        const fullCommand = `as_${command}\n`;
        this.stdin.write(fullCommand);
    }

    /**
     * Execute a command, and get the result.
     * @param {string} command command, without `as_` prefix
     * @param {string} ...args arguments of the command
     * @returns {Promise<object>} result of the command
     */
    async executeCommandRes(command, ...args) {
        let fullCommand = command;
        if (args.length > 0) {
            const quotedArgs = args.map(arg => `"${arg.replace(/"/g, '\\"').replace(/\\/g, '\\\\')}"`);
            fullCommand += ' ' + quotedArgs.join(' ');
        }

        await this.sendCommand(fullCommand);

        const resultReader = Readable.from(this.stdout);
        const typeValue = await AsCmd.readTLV(resultReader);
        return AsCmd.newCommandResult(typeValue);
    }

    /**
     * Execute a command that returns only success or error.
     * @param {string} command command, without `as_` prefix
     * @param {string} ...args arguments of the command
     */
    async executeCommandNoRes(command, ...args) {
        const result = await this.executeCommandRes(command, ...args);
        if (result instanceof CommandSuccess) {
            return;
        } else if (result instanceof CommandError) {
            throw new Error(`Ascmd error: ${result.errstr}`);
        } else {
            throw new Error(`Unexpected result: ${typeof result}`);
        }
    }

    /**
     * Terminate the ascmd session with the `as_exit` command.
     */
    async terminate() {
        await this.sendCommand('exit');
    }

    /**
     * Read a TLV item.
     * @todo not implemented
     * @param {Readable} reader reader of the ascmd output
     * @returns {Promise<{tag: number, value: *}>} TLV item
     */
    static async readTLV(reader) {
        // Implement TLV reading logic here
        return { tag: 5, value: {} };
    }

    /**
     * Decode the information about the platform.
     * @todo not implemented
     * @param {*} value TLV data
     * @returns {Info} information about the platform
     */
    static newInfo(value) {
        // Implement Info parsing logic here
        return {};
    }

    /**
     * Decode the result of a command.
     * @todo not implemented
     * @param {*} typeValue TLV item
     * @returns {object} result of the command
     */
    static newCommandResult(typeValue) {
        // Implement CommandResult parsing logic here
        return {};
    }

    /**
     * Send a command to ascmd, and read the response.
     * @todo not implemented: overrides `sendCommand` above
     * @param {string} command command, without `as_` prefix
     * @returns {Promise<string>} response
     */
    async sendCommand(command) {
        if (!this.started) {
            if (version === 2) {
                const command = `session_init --protocol=2${host ? ` --host=${host}` : ''}`;
                await ascmd.sendCommand(command);
            }
            this.started = true;
        }
        this.stdin.write(`${command}\n`);
        const response = await this.stdout.read();
        if (!response) {
            throw new Error('No response from stdout');
        }
        return response.toString('utf8');
    }

    /**
     * Get the information about available drives.
     * @todo not implemented
     * @returns {Promise<Mounts>} information about available drives
     */
    async df() {
    }
    /**
     * Get the information about the platform.
     * @todo not implemented
     * @returns {Promise<Info>} information about the platform
     */
    async info() {
    }
    /**
     * Get the information about a file, or about the files in a folder.
     * @todo not implemented
     * @param {*} path path of the file or folder
     * @returns {Promise<Stat[]>} information about the files
     */
    async ls() {
    }
    /**
     * Get the MD5 checksum of a file.
     * @todo not implemented
     * @param {*} path path of the file
     * @returns {Promise<string>} MD5 checksum
     */
    async md5sum() {
    }
    /**
     * Get the size information about a file or folder.
     * @todo not implemented
     * @param {*} path path of the file or folder
     * @returns {Promise<Size>} size information
     */
    async du() {
    }
    /**
     * Copy a file or folder.
     * @todo not implemented
     * @param {*} source path of the source
     * @param {*} destination path of the destination
     */
    async cp() {
    }
    /**
     * Move a file or folder.
     * @todo not implemented
     * @param {*} source path of the source
     * @param {*} destination path of the destination
     */
    async mv() {
    }
    /**
     * Delete a file or folder.
     * @todo not implemented
     * @param {*} path path of the file or folder
     */
    async rm() {
    }
    /**
     * Create a folder.
     * @todo not implemented
     * @param {*} path path of the folder
     */
    async mkdir() {
    }
    /**
     * Terminate the ascmd session with the `as_exit` command.
     * @todo not implemented
     */
    async terminate() {
    }
}




/**
 * ascmd executed locally, for tests.
 */
class AsCmdLocal extends AsCmd {
    /**
     * Create a local ascmd client.
     * @param {Writable} stdin channel to which commands are written
     * @param {Readable} stdout channel from which TLV items are read
     * @param {number} version protocol version: 1 or 2
     * @param {ChildProcess} cmd ascmd process
     */
    constructor(stdin, stdout, version, cmd) {
        super(stdin, stdout, version);
        this.cmd = cmd;
    }

    /**
     * Start ascmd locally, for tests.
     * @param {number} protocol protocol version: 1 or 2
     * @returns {Promise<AsCmdLocal>} ascmd client
     */
    static async create(protocol) {
        const cmd = spawn('ascmd', protocol === 1 ? [] : [`-V${protocol}`], {
            env: { ...process.env, SSH_CLIENT: '' }
        });

        const stdin = cmd.stdin;
        const stdout = cmd.stdout;

        const ascmdAgent = await AsCmd.create(stdin, stdout, '', protocol);
        return new AsCmdLocal(stdin, stdout, protocol, cmd);
    }

    /**
     * Terminate the ascmd session, and wait for the end of ascmd.
     */
    async terminate() {
        await this.cmd.on('close', code => {
            if (code !== 0) {
                throw new Error(`Ascmd exited with code ${code}`);
            }
            logger.debug(`Ascmd exited with code ${code}`);
        });
    }
}

/**
 * ascmd executed on the server through SSH.
 */
class AsCmdRemote extends AsCmd {
    /**
     * Create a remote ascmd client.
     * @param {Writable} stdin channel to which commands are written
     * @param {Readable} stdout channel from which TLV items are read
     * @param {number} version protocol version: 1 or 2
     * @param {ssh2.Client} client SSH connection
     * @param {object} session SSH channel of ascmd
     */
    constructor(stdin, stdout, version, client, session) {
        super(stdin, stdout, version);
        this.client = client;
        this.session = session;
    }

    /**
     * Start ascmd on the server through SSH.
     * @param {string} host address of the server
     * @param {string} port SSH port
     * @param {string} username transfer user
     * @param {string} password password of the user
     * @param {number} protocol protocol version: 1 or 2
     * @returns {Promise<AsCmdRemote>} ascmd client
     */
    static async create(host, port, username, password, protocol) {
        const client = new ssh2.Client();

        const connection = await new Promise((resolve, reject) => {
            client.on('ready', () => resolve(client));
            client.on('error', reject);
            client.connect({
                host,
                port: parseInt(port, 10),
                username,
                password
            });
        });

        const session = await new Promise((resolve, reject) => {
            connection.exec(`ascmd${protocol !== 1 ? ` -V${protocol}` : ''}`, (err, stream) => {
                if (err) reject(err);
                resolve(stream);
            });
        });

        const stdin = session.stdin;
        const stdout = session.stdout;

        const ascmdAgent = await AsCmd.create(stdin, stdout, host, protocol);
        return new AsCmdRemote(stdin, stdout, protocol, connection, session);
    }

    /**
     * Terminate the ascmd session, and close the SSH connection.
     */
    async terminate() {
        this.session.close();
        this.client.end();
    }
}

export { AsCmd, AsCmdLocal, AsCmdRemote };
