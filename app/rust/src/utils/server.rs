// ascmd (Aspera Command) protocol
// ascmd is a simple command-line tool that allows you to interact with storage using basic commands.
// Commands are sent in one line separated by a newline character.
// The format is "as_<command>" with zero, one or two arguments.
// Arguments are separated by a space or tab characters.
// Argument containing spaces must be enclosed in double quotes.
// In this case double quotes and backslashes must be escaped with a backslash.
// The answer is a single TLV (Tag-Length-Value) possibly containing multiple sub-TLV.
// Each TLV is composed of:
// - Tag is a single byte
// - Length is a 4-byte big-endian integer
// - Value is a buffer of Length bytes
// There are 3 different methods to decode buffer lists in CommandResult (legacy):
// - .Info:Info.dev : This TLV appears multiple times in the result
// - .Df:Mounts.mounts : All fields of `mounts` are at the same level, and tag 1 denotes a new mount object
// - .Dir:Vec<Stat> : It is one large TLV that contains sub-TLVs of type Stat
// cspell:ignore ascmd zstr ctype codeset fcount errno errstr zmode zuid zgid zctime zmtime zatime dcount

use std::error::Error;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;

// sizes of TLV components
const TYPE_SIZE: usize = 1;
const LENGTH_SIZE: usize = 4;
const END_OF_BUFFER: u8 = 0;
// the executable command
pub const ASCMD_COMMAND: &str = "ascmd";

/// TLV (Tag-Length-Value) item of the ascmd protocol.
#[derive(Debug)]
struct TypeValue {
    t: u8,
    v: Vec<u8>,
}

/// Information about the platform.
#[derive(Debug)]
pub struct Info {
    platform: String,
    version: String,
    lang: String,
    territory: String,
    codeset: String,
    lc_ctype: String,
    lc_numeric: String,
    lc_time: String,
    lc_all: String,
    dev: Vec<String>,
    browse_caps: String,
    protocol: u64,
}

impl Info {
    /// Decode the information about the platform.
    ///
    /// # Arguments
    /// * `data` - TLV data
    ///
    /// # Returns
    /// Information about the platform
    fn new(data: &[u8]) -> Result<Self, Box<dyn Error>> {
        let mut info = Info {
            platform: String::new(),
            version: String::new(),
            lang: String::new(),
            territory: String::new(),
            codeset: String::new(),
            lc_ctype: String::new(),
            lc_numeric: String::new(),
            lc_time: String::new(),
            lc_all: String::new(),
            dev: Vec::new(),
            browse_caps: String::new(),
            protocol: 1,
        };
        let reader: &mut BufReader<&[u8]> = &mut BufReader::new(data);
        while let Ok(tlv) = read_tlv(reader) {
            match tlv.t {
                END_OF_BUFFER => break,
                1 => info.platform = decode_zstr("platform", &tlv.v)?,
                2 => info.version = decode_zstr("version", &tlv.v)?,
                3 => info.lang = decode_zstr("lang", &tlv.v)?,
                4 => info.territory = decode_zstr("territory", &tlv.v)?,
                5 => info.codeset = decode_zstr("codeset", &tlv.v)?,
                6 => info.lc_ctype = decode_zstr("lc_ctype", &tlv.v)?,
                7 => info.lc_numeric = decode_zstr("lc_numeric", &tlv.v)?,
                8 => info.lc_time = decode_zstr("lc_time", &tlv.v)?,
                9 => info.lc_all = decode_zstr("lc_all", &tlv.v)?,
                10 => info.dev.push(decode_zstr("dev", &tlv.v)?),
                11 => info.browse_caps = decode_zstr("browse_caps", &tlv.v)?,
                12 => info.protocol = decode_u64("protocol", &tlv.v)?,
                _ => return Err(format!("Unknown TLV tag: {}", tlv.t).into()),
            }
        }
        Ok(info)
    }
}

/// Information about one drive.
#[derive(Debug)]
pub struct Mnt {
    fs: String,
    dir: String,
    is_a: String,
    total: u64,
    used: u64,
    free: u64,
    fcount: u64,
    errno: u32,
    errstr: String,
}

/// Information about available drives.
#[derive(Debug)]
pub struct Mounts {
    mounts: Vec<Mnt>, // A vector of Mnt structs
}
impl Mounts {
    /// Decode the information about available drives.
    ///
    /// # Arguments
    /// * `data` - TLV data
    ///
    /// # Returns
    /// Information about available drives
    fn new(data: &[u8]) -> Result<Self, Box<dyn Error>> {
        let mut result = Mounts { mounts: Vec::new() };
        let mut mnt: Option<Mnt> = None;
        let reader: &mut BufReader<&[u8]> = &mut BufReader::new(data);
        while let Ok(tlv) = read_tlv(reader) {
            match tlv.t {
                END_OF_BUFFER => break,
                1 => {
                    // if there was an ongoing data, then store it
                    if let Some(one) = mnt.take() {
                        result.mounts.push(one);
                    }
                    // create a new one
                    mnt = Some(Mnt {
                        fs: String::new(),
                        dir: String::new(),
                        is_a: String::new(),
                        total: 0,
                        used: 0,
                        free: 0,
                        fcount: 0,
                        errno: 0,
                        errstr: String::new(),
                    });
                    // store field 1
                    mnt.as_mut().unwrap().fs = decode_zstr("fs", &tlv.v)?
                }
                2 => mnt.as_mut().unwrap().dir = decode_zstr("dir", &tlv.v)?,
                3 => mnt.as_mut().unwrap().is_a = decode_zstr("is_a", &tlv.v)?,
                4 => mnt.as_mut().unwrap().total = decode_u64("total", &tlv.v)?,
                5 => mnt.as_mut().unwrap().used = decode_u64("used", &tlv.v)?,
                6 => mnt.as_mut().unwrap().free = decode_u64("free", &tlv.v)?,
                7 => mnt.as_mut().unwrap().fcount = decode_u64("fcount", &tlv.v)?,
                8 => mnt.as_mut().unwrap().errno = decode_u32("errno", &tlv.v)?,
                9 => mnt.as_mut().unwrap().errstr = decode_zstr("errstr", &tlv.v)?,
                _ => return Err(format!("Unknown TLV tag: {}", tlv.t).into()),
            }
        }
        if let Some(one) = mnt.take() {
            result.mounts.push(one);
        }
        Ok(result)
    }
}

/// Information about a file or folder.
#[derive(Debug)]
pub struct Stat {
    name: String,
    size: u64,
    mode: u32,
    zmode: String,
    uid: u32,
    zuid: String,
    gid: u32,
    zgid: String,
    ctime: u64,
    zctime: String,
    mtime: u64,
    zmtime: String,
    atime: u64,
    zatime: String,
    symlink: String,
    errno: u32,
    errstr: String,
}

impl Stat {
    /// Decode the information about a file or folder.
    ///
    /// # Arguments
    /// * `data` - TLV data
    ///
    /// # Returns
    /// Information about a file or folder
    fn new(data: &[u8]) -> Result<Self, Box<dyn Error>> {
        let mut stat = Stat {
            name: String::new(),
            size: 0,
            mode: 0,
            zmode: String::new(),
            uid: 0,
            zuid: String::new(),
            gid: 0,
            zgid: String::new(),
            ctime: 0,
            zctime: String::new(),
            mtime: 0,
            zmtime: String::new(),
            atime: 0,
            zatime: String::new(),
            symlink: String::new(),
            errno: 0,
            errstr: String::new(),
        };
        let reader: &mut BufReader<&[u8]> = &mut BufReader::new(data);
        while let Ok(tlv) = read_tlv(reader) {
            match tlv.t {
                END_OF_BUFFER => break,
                1 => stat.name = decode_zstr("name", &tlv.v)?,
                2 => stat.size = decode_u64("size", &tlv.v)?,
                3 => stat.mode = decode_u32("mode", &tlv.v)?,
                4 => stat.zmode = decode_zstr("zmode", &tlv.v)?,
                5 => stat.uid = decode_u32("uid", &tlv.v)?,
                6 => stat.zuid = decode_zstr("zuid", &tlv.v)?,
                7 => stat.gid = decode_u32("gid", &tlv.v)?,
                8 => stat.zgid = decode_zstr("zgid", &tlv.v)?,
                9 => stat.ctime = decode_u64("ctime", &tlv.v)?,
                10 => stat.zctime = decode_zstr("zctime", &tlv.v)?,
                11 => stat.mtime = decode_u64("mtime", &tlv.v)?,
                12 => stat.zmtime = decode_zstr("zmtime", &tlv.v)?,
                13 => stat.atime = decode_u64("atime", &tlv.v)?,
                14 => stat.zatime = decode_zstr("zatime", &tlv.v)?,
                15 => stat.symlink = decode_zstr("symlink", &tlv.v)?,
                16 => stat.errno = decode_u32("errno", &tlv.v)?,
                17 => stat.errstr = decode_zstr("errstr", &tlv.v)?,
                _ => return Err(format!("Unknown TLV tag: {}", tlv.t).into()),
            }
        }
        Ok(stat)
    }
}

/// Size information about a file or folder.
#[derive(Debug)]
pub struct Size {
    size: u64,
    fcount: u32,
    dcount: u32,
    failed_fcount: u32,
    failed_dcount: u32,
}

impl Size {
    /// Decode the size information about a file or folder.
    ///
    /// # Arguments
    /// * `data` - TLV data
    ///
    /// # Returns
    /// Size information
    fn new(data: &[u8]) -> Result<Self, Box<dyn Error>> {
        let mut size = Size {
            size: 0,
            fcount: 0,
            dcount: 0,
            failed_fcount: 0,
            failed_dcount: 0,
        };
        let reader: &mut BufReader<&[u8]> = &mut BufReader::new(data);
        while let Ok(tlv) = read_tlv(reader) {
            match tlv.t {
                END_OF_BUFFER => break,
                1 => size.size = decode_u64("size", &tlv.v)?,
                2 => size.fcount = decode_u32("fcount", &tlv.v)?,
                3 => size.dcount = decode_u32("dcount", &tlv.v)?,
                4 => size.failed_fcount = decode_u32("failed_fcount", &tlv.v)?,
                5 => size.failed_dcount = decode_u32("failed_dcount", &tlv.v)?,
                _ => return Err(format!("Unknown TLV tag: {}", tlv.t).into()),
            }
        }
        Ok(size)
    }
}

/// Error returned by a command.
#[derive(Debug)]
struct CommandError {
    errno: u32,
    errstr: String,
}

impl CommandError {
    /// Decode the error returned by a command.
    ///
    /// # Arguments
    /// * `data` - TLV data
    ///
    /// # Returns
    /// Error of the command
    fn new(data: &[u8]) -> Result<Self, Box<dyn Error>> {
        let mut error = CommandError {
            errno: 0,
            errstr: String::new(),
        };
        let reader: &mut BufReader<&[u8]> = &mut BufReader::new(data);
        while let Ok(tlv) = read_tlv(reader) {
            match tlv.t {
                END_OF_BUFFER => break,
                1 => error.errno = decode_u32("errno", &tlv.v)?,
                2 => error.errstr = decode_zstr("errstr", &tlv.v)?,
                _ => return Err(format!("Unknown TLV tag: {}", tlv.t).into()),
            }
        }
        Ok(error)
    }
}

/// MD5 checksum of a file.
#[derive(Debug)]
struct Md5sum {
    md5sum: String,
}

impl Md5sum {
    /// Decode the MD5 checksum of a file.
    ///
    /// # Arguments
    /// * `data` - TLV data
    ///
    /// # Returns
    /// MD5 checksum
    fn new(data: &[u8]) -> Result<Self, Box<dyn Error>> {
        let mut md5sum = Md5sum {
            md5sum: String::new(),
        };
        let reader: &mut BufReader<&[u8]> = &mut BufReader::new(data);
        while let Ok(tlv) = read_tlv(reader) {
            match tlv.t {
                END_OF_BUFFER => break,
                1 => md5sum.md5sum = decode_zstr("md5sum", &tlv.v)?,
                _ => return Err(format!("Unknown TLV tag: {}", tlv.t).into()),
            }
        }
        Ok(md5sum)
    }
}

/// Result of a command.
#[derive(Debug)]
enum CommandResult {
    File(Stat),
    Dir(Vec<Stat>),
    Size(Size),
    Error(CommandError),
    Info(Info),
    Success(()),
    Exit(()),
    Df(Mounts),
    Md5sum(Md5sum),
}

impl CommandResult {
    /// Decode the result of a command.
    ///
    /// # Arguments
    /// * `type_value` - TLV item
    ///
    /// # Returns
    /// Result of the command
    fn new(type_value: &TypeValue) -> Result<Self, Box<dyn Error>> {
        match type_value.t {
            1 => Ok(CommandResult::File(Stat::new(&type_value.v)?)),
            2 => {
                let mut dir = Vec::new();
                let reader: &mut BufReader<&[u8]> = &mut BufReader::new(&type_value.v);
                while let Ok(tlv) = read_tlv(reader) {
                    match tlv.t {
                        END_OF_BUFFER => break,
                        1 => dir.push(Stat::new(&tlv.v)?),
                        _ => return Err(format!("Expected tag 1, got {}", tlv.t).into()),
                    }
                }
                Ok(CommandResult::Dir(dir))
            }
            3 => Ok(CommandResult::Size(Size::new(&type_value.v)?)),
            4 => Ok(CommandResult::Error(CommandError::new(&type_value.v)?)),
            5 => Ok(CommandResult::Info(Info::new(&type_value.v)?)),
            6 => Ok(CommandResult::Success(())),
            7 => Ok(CommandResult::Exit(())),
            8 => Ok(CommandResult::Df(Mounts::new(&type_value.v)?)),
            9 => Ok(CommandResult::Md5sum(Md5sum::new(&type_value.v)?)),
            _ => Err(format!("Unknown TLV tag: {}", type_value.t).into()),
        }
    }
}
/// Client of the `ascmd` protocol: file operations on Aspera HSTS.
///
/// Typically used like this:
/// ```rust
/// let tcp = TcpStream::connect(format!("{}:{}", host, port))?;
/// let mut session = ssh2::Session::new()?;
/// session.set_tcp_stream(tcp);
/// session.handshake()?;
/// session.userauth_password(username, password)?;
/// let mut channel = session.channel_session()?;
/// match protocol {
///     1 => channel.exec(server::ASCMD_COMMAND)?,
///     _ => channel.exec(&format!("{} -V{}", server::ASCMD_COMMAND, protocol))?,
/// }
/// let mut ascmd_agent = server::AsCmd::new(channel.stream(0), channel.stream(0), host, protocol)?;
/// ascmd_agent.ls("/")?;
/// ascmd_agent.terminate()
/// channel.send_eof()?;
/// channel.wait_eof()?;
/// channel.wait_close()?;
/// ```
/// It is also possible to connect a local ascmd for testing purpose.
pub struct AsCmd<I: Write, O: Read> {
    stdin: I,
    stdout: O,
}

impl<I: Write, O: Read> AsCmd<I, O> {
    /// Create an ascmd client, and start the protocol.
    ///
    /// # Arguments
    /// * `stdin` - channel to which commands are written
    /// * `stdout` - channel from which TLV items are read
    /// * `host` - address of the server, to traverse a proxy
    /// * `version` - protocol version: 1 or 2
    ///
    /// # Returns
    /// Ascmd client
    pub fn new(stdin: I, stdout: O, host: &str, version: u32) -> Result<Self, Box<dyn Error>> {
        let mut ascmd = AsCmd { stdin, stdout };
        match version {
            1 => (),
            2 => {
                let command = "session_init --protocol=2";
                // if host is not empty, then add --host=<host>
                if !host.is_empty() {
                    ascmd.send_command(&format!("{} --host={}", command, host))?
                } else {
                    ascmd.send_command(command)?
                }
            }
            _ => return Err(format!("Unsupported ascmd version: {version}").into()),
        }
        let mut initial_reader = BufReader::new(&mut ascmd.stdout);
        // Read the first TLV response
        let data = read_tlv(&mut initial_reader)?;
        if data.t != 5 {
            return Err(format!("Expected tag 5, got: {}", data.t).into());
        }
        Info::new(&data.v)?;
        Ok(ascmd)
    }

    /// Send a command to ascmd.
    ///
    /// # Arguments
    /// * `command` - command, without `as_` prefix
    fn send_command(&mut self, command: &str) -> Result<(), Box<dyn Error>> {
        log::debug!("Sending command: as_{command}");
        let command = format!("as_{}\n", command);
        self.stdin.write_all(command.as_bytes())?;
        self.stdin.flush()?;
        Ok(())
    }
    /// Execute a command, and get the result.
    ///
    /// # Arguments
    /// * `command` - command, without `as_` prefix
    ///
    /// # Returns
    /// Result of the command
    fn exec_command_result(&mut self, command: &str) -> Result<CommandResult, Box<dyn Error>> {
        self.send_command(command)?;
        let mut result_reader: BufReader<&mut O> = BufReader::new(&mut self.stdout);
        let type_value = read_tlv(&mut result_reader)?;
        CommandResult::new(&type_value)
    }
    /// Get the information about the platform.
    ///
    /// # Returns
    /// Information about the platform
    pub fn info(&mut self) -> Result<Info, Box<dyn Error>> {
        match self.exec_command_result("info")? {
            CommandResult::Info(info) => Ok(info),
            CommandResult::Error(error) => Err(format!("Ascmd error: {}", error.errstr).into()),
            _ => Err("Unexpected result".into()),
        }
    }
    /// Get the information about a file, or about the files in a folder.
    ///
    /// # Arguments
    /// * `path` - path of the file or folder
    ///
    /// # Returns
    /// Information about the files
    pub fn ls(&mut self, path: &Path) -> Result<Vec<Stat>, Box<dyn Error>> {
        match self.exec_command_result(&format!("ls {}", path_to_arg(path)))? {
            CommandResult::Dir(dir) => Ok(dir),
            CommandResult::File(file) => Ok(vec![file]),
            CommandResult::Error(error) => Err(format!("Ascmd error: {}", error.errstr).into()),
            _ => Err("Unexpected result".into()),
        }
    }
    /// Delete a file or folder.
    ///
    /// # Arguments
    /// * `path` - path of the file or folder
    pub fn rm(&mut self, path: &Path) -> Result<(), Box<dyn Error>> {
        result_success_error(self.exec_command_result(&format!("rm {}", path_to_arg(path)))?)
    }
    /// Get the size information about a file or folder.
    ///
    /// # Arguments
    /// * `path` - path of the file or folder
    ///
    /// # Returns
    /// Size information
    pub fn du(&mut self, path: &Path) -> Result<Size, Box<dyn Error>> {
        match self.exec_command_result(&format!("du {}", path_to_arg(path)))? {
            CommandResult::Size(size) => Ok(size),
            CommandResult::Error(error) => Err(format!("Ascmd error: {}", error.errstr).into()),
            _ => Err("Unexpected result".into()),
        }
    }
    /// Create a folder.
    ///
    /// # Arguments
    /// * `path` - path of the folder
    pub fn mkdir(&mut self, path: &Path) -> Result<(), Box<dyn Error>> {
        result_success_error(self.exec_command_result(&format!("mkdir {}", path_to_arg(path)))?)
    }
    /// Copy a file or folder.
    ///
    /// # Arguments
    /// * `source` - path of the source
    /// * `destination` - path of the destination
    pub fn cp(&mut self, source: &Path, destination: &Path) -> Result<(), Box<dyn Error>> {
        result_success_error(self.exec_command_result(&format!(
            "cp {} {}",
            path_to_arg(source),
            path_to_arg(destination)
        ))?)
    }
    /// Move a file or folder.
    ///
    /// # Arguments
    /// * `source` - path of the source
    /// * `destination` - path of the destination
    pub fn mv(&mut self, source: &Path, destination: &Path) -> Result<(), Box<dyn Error>> {
        result_success_error(self.exec_command_result(&format!(
            "mv {} {}",
            path_to_arg(source),
            path_to_arg(destination)
        ))?)
    }
    /// Get the information about available drives.
    ///
    /// # Returns
    /// Information about available drives
    pub fn df(&mut self) -> Result<Mounts, Box<dyn Error>> {
        match self.exec_command_result("df")? {
            CommandResult::Df(mounts) => Ok(mounts),
            CommandResult::Error(error) => Err(format!("Ascmd error: {}", error.errstr).into()),
            _ => Err("Unexpected result".into()),
        }
    }
    /// Get the MD5 checksum of a file.
    ///
    /// # Arguments
    /// * `path` - path of the file
    ///
    /// # Returns
    /// MD5 checksum
    pub fn md5sum(&mut self, path: &Path) -> Result<String, Box<dyn Error>> {
        match self.exec_command_result(&format!("md5sum {}", path_to_arg(path)))? {
            CommandResult::Md5sum(md5sum) => Ok(md5sum.md5sum),
            CommandResult::Error(error) => Err(format!("Ascmd error: {}", error.errstr).into()),
            _ => Err("Unexpected result".into()),
        }
    }
    /// Terminate the ascmd session with the `as_exit` command.
    pub fn terminate(&mut self) -> Result<(), Box<dyn Error>> {
        self.send_command("exit")
    }
}

/// Check the result of a command that returns only success or error.
///
/// # Arguments
/// * `result` - result of the command
fn result_success_error(result: CommandResult) -> Result<(), Box<dyn Error>> {
    match result {
        CommandResult::Success(_) => Ok(()),
        CommandResult::Error(error) => Err(format!("Ascmd error: {}", error.errstr).into()),
        _ => Err("Unexpected result".into()),
    }
}

/// Quote a path as argument of an ascmd command.
///
/// # Arguments
/// * `path` - path to quote
///
/// # Returns
/// Quoted path
fn path_to_arg(path: &Path) -> String {
    // another possibility would be to protect individual special characters:
    // " ' \ <sp> <tab>
    format!(
        r#""{}""#,
        path.display()
            .to_string()
            .replace('\\', r"\\")
            .replace('"', r#"\""#)
    )
}

/// Decode a zero-terminated string.
///
/// # Arguments
/// * `name` - name of the field, for errors
/// * `buf` - data
///
/// # Returns
/// String
fn decode_zstr(name: &str, buf: &[u8]) -> Result<String, Box<dyn Error>> {
    if buf.last() != Some(&0) {
        return Err(format!(
            "Expected zero-terminated buffer in decode_zstr({}): {:?}",
            name, buf
        )
        .into());
    }
    Ok(String::from_utf8_lossy(&buf[..buf.len() - 1]).to_string())
}
/// Decode a 64-bit unsigned integer.
///
/// # Arguments
/// * `name` - name of the field, for errors
/// * `buf` - data
///
/// # Returns
/// Integer
fn decode_u64(name: &str, buf: &Vec<u8>) -> Result<u64, Box<dyn Error>> {
    if buf.len() != 8 {
        return Err(format!("Expected 8 bytes for u64({}): {:?}", name, buf).into());
    }
    Ok(u64::from_be_bytes(buf.as_slice().try_into().unwrap()))
}
/// Decode a 32-bit unsigned integer.
///
/// # Arguments
/// * `name` - name of the field, for errors
/// * `buf` - data
///
/// # Returns
/// Integer
fn decode_u32(name: &str, buf: &Vec<u8>) -> Result<u32, Box<dyn Error>> {
    if buf.len() != 4 {
        return Err(format!("Expected 4 bytes for u32({}): {:?}", name, buf).into());
    }
    Ok(u32::from_be_bytes(buf.as_slice().try_into().unwrap()))
}
/// Read a TLV item.
///
/// # Arguments
/// * `reader` - reader of the ascmd output
///
/// # Returns
/// TLV item
fn read_tlv(reader: &mut BufReader<impl Read>) -> Result<TypeValue, Box<dyn Error>> {
    // Check if the buffer is empty before attempting to read
    if reader.fill_buf()?.is_empty() {
        // Return a TypeValue with type 0 and an empty value
        return Ok(TypeValue {
            t: END_OF_BUFFER,
            v: vec![],
        });
    }
    // Read the tag byte (T)
    let mut type_byte = [0; TYPE_SIZE];
    reader
        .read_exact(&mut type_byte)
        .map_err(|_| "Failed to read tag byte")?;
    let t = type_byte[0];
    // Read the length bytes (L)
    let mut length_bytes = [0; LENGTH_SIZE];
    reader
        .read_exact(&mut length_bytes)
        .map_err(|_| "Failed to read length bytes")?;
    let length = u32::from_be_bytes(length_bytes) as usize;
    // Read the value bytes (V)
    let mut v = vec![0; length];
    reader
        .read_exact(&mut v)
        .map_err(|_| "Failed to read value bytes")?;
    let result = TypeValue { t, v };
    Ok(result)
}
