// This sample demonstrates how to remotely browse an Aspera HSTS using a simple
// transfer user and the ascmd command-line tool.
// cspell:ignore ascmd aspera todelete userauth
use samples::utils::configuration::Configuration;
use samples::utils::server;
use std::error::Error;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Arc;
use url::Url;

/// Perform file operations on the server with ascmd.
///
/// # Arguments
/// * `ascmd_agent` - ascmd client
/// * `existing_file` - path of a file on the server
/// * `writable_folder` - path of a folder on the server, where files are created and deleted
fn perform_tests<I: Write, O: Read>(
    ascmd_agent: &mut server::AsCmd<I, O>,
    existing_file: &Path,
    writable_folder: &Path,
) -> Result<(), Box<dyn Error>> {
    let copy_file = writable_folder.join("copied_file");
    let delete_file = writable_folder.join("todelete_file");
    let delete_dir = writable_folder.join("todelete_dir");
    log::info!("Server information: {:?}", ascmd_agent.info()?);
    log::info!("Disk space: {:?}", ascmd_agent.df()?);
    log::info!("File information: {:?}", ascmd_agent.ls(&existing_file)?);
    log::info!("Folder content: {:?}", ascmd_agent.ls(&writable_folder)?);
    log::info!("File MD5: {:?}", ascmd_agent.md5sum(&existing_file)?);
    log::info!("Disk usage: {:?}", ascmd_agent.du(&existing_file)?);
    ascmd_agent.cp(&existing_file, &copy_file)?;
    log::info!("File copied");
    ascmd_agent.mv(&copy_file, &delete_file)?;
    log::info!("File moved");
    ascmd_agent.rm(&delete_file)?;
    log::info!("File deleted");
    ascmd_agent.mkdir(&delete_dir)?;
    log::info!("Folder created");
    ascmd_agent.rm(&delete_dir)?;
    log::info!("Folder deleted");
    ascmd_agent.terminate()
}

/// Test ascmd executed locally.
fn test_local() -> Result<(), Box<dyn Error>> {
    log::info!("Testing local ascmd");
    let protocol = 2;
    let binding = Command::new(server::ASCMD_COMMAND);
    let mut command = binding;
    command
        .env("SSH_CLIENT", "")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped());
    if protocol != 1 {
        command.arg(format!("-V{}", protocol));
    }
    let mut process = command.spawn()?;
    // start the protocol
    let mut ascmd_agent = server::AsCmd::new(
        process.stdin.take().ok_or("Failed to open stdin")?,
        process.stdout.take().ok_or("Failed to open stdout")?,
        "",
        protocol,
    )?;
    perform_tests(
        &mut ascmd_agent,
        Path::new("/workspace/aspera/rust_ascmd/README.md"),
        Path::new("/workspace/aspera/rust_ascmd"),
    )?;
    // wait for process to terminate
    let status = process.wait()?;
    log::debug!("Ascmd exited with code {}", status.code().unwrap_or(-1));
    Ok(())
}

/// Test ascmd executed on the server through SSH.
///
/// # Arguments
/// * `config` - configuration of the samples
fn test_remote(config: Arc<Configuration>) -> Result<(), Box<dyn Error>> {
    log::info!("Testing remote ascmd");
    let server_url = config.param_str("server", "url")?;
    let server_uri = Url::parse(&server_url)?;
    if server_uri.scheme() != "ssh" {
        return Err(format!("Expecting SSH URL: {server_url}").into());
    }
    let host = server_uri.host_str().unwrap_or_default();
    let port = server_uri.port_or_known_default().unwrap_or(33001);
    let username = config.param_str("server", "username")?;
    let password = config.param_str("server", "password")?;
    let protocol = 2;
    // initialize the SSH connection to the Aspera HSTS
    let tcp = TcpStream::connect(format!("{}:{}", host, port))?;
    let mut session = ssh2::Session::new()?;
    session.set_tcp_stream(tcp);
    session.handshake()?;
    session.userauth_password(username.as_str(), password.as_str())?;
    let mut channel = session.channel_session()?;
    match protocol {
        1 => channel.exec(server::ASCMD_COMMAND)?,
        _ => channel.exec(&format!("{} -V{}", server::ASCMD_COMMAND, protocol))?,
    }
    // start protocol codec
    let mut ascmd_agent = server::AsCmd::new(channel.stream(0), channel.stream(0), host, protocol)?;
    perform_tests(
        &mut ascmd_agent,
        Path::new(&config.param_str("server", "file_download")?),
        Path::new(&config.param_str("server", "folder_upload")?),
    )?;
    // Wait for the channel to close
    channel.send_eof()?;
    channel.wait_eof()?;
    channel.wait_close()?;
    log::debug!("Ascmd exited with code {}", channel.exit_status()?);
    Ok(())
}

/// Test ascmd executed locally, or on the server.
fn main() -> Result<(), Box<dyn Error>> {
    let config: Arc<Configuration> = Arc::new(Configuration::new()?);
    if false {
        test_local()?;
    } else {
        test_remote(config)?;
    }
    Ok(())
}
