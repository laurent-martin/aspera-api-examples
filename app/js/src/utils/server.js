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

// Helper class for Type-Value pairs
class TypeValue {
    constructor(t, v) {
        this.t = t;
        this.v = v;
    }
}

// Info Structure
class Info {
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

    static decodeZstr(label, value) {
        return value.toString('utf8').replace(/\0+$/, ''); // Remove null terminators
    }

    static decodeU64(label, value) {
        return Buffer.from(value).readBigUInt64BE();
    }

    static async create(data) {
        logger.trace('decoding info:', data);
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

    static async readTLV(buffer, offset) {
        if (offset >= buffer.length) return null;

        const t = buffer.readUInt8(offset);
        const l = buffer.readUInt32BE(offset + TYPE_SIZE);
        const v = buffer.slice(offset + TYPE_SIZE + LENGTH_SIZE, offset + TYPE_SIZE + LENGTH_SIZE + l);

        return { t, v, nextOffset: offset + TYPE_SIZE + LENGTH_SIZE + l };
    }
}

// Mnt Structure
class Mnt {
    constructor(name, path) {
        this.name = name;
        this.path = path;
    }
}

// Mounts Structure
class Mounts {
    constructor() {
        this.mounts = [];
    }

    static decodeZstr(value) {
        return value.toString('utf8').replace(/\0+$/, '');
    }

    static async create(data) {
        logger.trace('decoding mounts:', data);
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

// Stat Structure
class Stat {
    constructor(filename, size) {
        this.filename = filename;
        this.size = size;
    }
}

// Size Structure
class Size {
    constructor(size) {
        this.size = size;
    }

    static decodeU64(value) {
        return Buffer.from(value).readBigUInt64BE();
    }

    static async create(data) {
        const size = new Size();
        size.size = Size.decodeU64(data);
        return size;
    }
}

// CommandError Structure
class CommandError {
    constructor(message) {
        this.message = message;
    }
}

// Md5sum Structure
class Md5sum {
    constructor(hash) {
        this.hash = hash;
    }

    static decodeHash(value) {
        return value.toString('hex');
    }

    static async create(data) {
        const md5sum = new Md5sum();
        md5sum.hash = Md5sum.decodeHash(data);
        return md5sum;
    }
}

// AsCmd Class
class AsCmd {
    constructor(stdin, stdout, host, version) {
        if (!stdin || !stdout) {
            throw new Error('stdin and stdout must not be null');
        }
        this.stdin = stdin;
        this.stdout = stdout;
        this.version = version;
        this.started = false;
    }
    static async create(stdin, stdout, host, version) {
        const ascmd = new AsCmd(stdin, stdout, version);

        if (version === 2) {
            let command = 'session_init --protocol=2';
            if (host) {
                command += ` --host=${host}`;
            }
            await ascmd.sendCommand(command);
        } else if (version !== 1) {
            throw new Error(`unsupported ascmd version: ${version}`);
        }

        const initialReader = Readable.from(stdout);
        const data = await AsCmd.readTLV(initialReader);
        if (data.tag !== 5) {
            throw new Error(`expected tag 5, got: ${data.tag}`);
        }

        const info = AsCmd.newInfo(data.value);
        console.debug('initial info:', info);

        return ascmd;
    }

    async sendCommand(command) {
        console.debug(`sending command: as_${command}`);
        const fullCommand = `as_${command}\n`;
        this.stdin.write(fullCommand);
    }

    async executeCommandRes(command, ...args) {
        let fullCommand = command;
        if (args.length > 0) {
            const quotedArgs = args.map(arg => `"${arg.replace(/"/g, '\\"').replace(/\\/g, '\\\\')}"`);
            fullCommand += ' ' + quotedArgs.join(' ');
        }

        console.debug(`executing command: ${command}`);
        await this.sendCommand(fullCommand);

        const resultReader = Readable.from(this.stdout);
        const typeValue = await AsCmd.readTLV(resultReader);
        return AsCmd.newCommandResult(typeValue);
    }

    async executeCommandNoRes(command, ...args) {
        const result = await this.executeCommandRes(command, ...args);
        if (result instanceof CommandSuccess) {
            return;
        } else if (result instanceof CommandError) {
            throw new Error(`error: ${result.errstr}`);
        } else {
            throw new Error(`unexpected result: ${typeof result}`);
        }
    }

    async terminate() {
        await this.sendCommand('exit');
    }

    // Placeholder for readTLV implementation
    static async readTLV(reader) {
        // Implement TLV reading logic here
        return { tag: 5, value: {} };
    }

    // Placeholder for newInfo implementation
    static newInfo(value) {
        // Implement Info parsing logic here
        return {};
    }

    // Placeholder for newCommandResult implementation
    static newCommandResult(typeValue) {
        // Implement CommandResult parsing logic here
        return {};
    }

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

    async df() {
    }
    async info() {
    }
    async ls() {
    }
    async md5sum() {
    }
    async du() {
    }
    async cp() {
    }
    async mv() {
    }
    async rm() {
    }
    async mkdir() {
    }
    async terminate() {
    }
}




class AsCmdLocal extends AsCmd {
    constructor(stdin, stdout, version, cmd) {
        super(stdin, stdout, version);
        this.cmd = cmd;
    }

    static async create(protocol) {
        const cmd = spawn('ascmd', protocol === 1 ? [] : [`-V${protocol}`], {
            env: { ...process.env, SSH_CLIENT: '' }
        });

        const stdin = cmd.stdin;
        const stdout = cmd.stdout;

        const ascmdAgent = await AsCmd.create(stdin, stdout, '', protocol);
        return new AsCmdLocal(stdin, stdout, protocol, cmd);
    }

    async terminate() {
        await this.cmd.on('close', code => {
            if (code !== 0) {
                throw new Error(`ascmd exited with error code: ${code}`);
            }
            console.info('ascmd exited successfully');
        });
    }
}

class AsCmdRemote extends AsCmd {
    constructor(stdin, stdout, version, client, session) {
        super(stdin, stdout, version);
        this.client = client;
        this.session = session;
    }

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

    async terminate() {
        this.session.close();
        this.client.end();
        console.info('Command exited successfully');
    }
}

export { AsCmd, AsCmdLocal, AsCmdRemote };
