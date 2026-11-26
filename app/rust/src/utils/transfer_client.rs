use super::configuration::{Configuration, log_dump};
use log::Level::Debug;
use serde_json::json;
use std::error::Error;
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use tonic::transport::Channel;

pub mod transfer {
    // Import your gRPC definitions with default package name in proto file
    tonic::include_proto!("transferd.api");
}

use transfer::transfer_service_client::TransferServiceClient;
use transfer::InstanceInfoRequest;
use transfer::TransferRequest;
use transfer::TransferStatus;
use transfer::TransferType;

const ASCP_LOG_FILE: &str = "aspera-scp-transfer.log";
/// default port of transferd if not specified in URL
const TRANSFERD_DEFAULT_PORT: u16 = 55002;
/// max wait time for the daemon to write its port file
const STARTUP_TIMEOUT: Duration = Duration::from_secs(10);
/// max wait time for the connection to the daemon
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// max wait time for the daemon to stop gracefully
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(10);
/// extension of the port file, written in `runtime_dir` with port 0: `transferd.<port>.optport`
const PORT_FILE_EXTENSION: &str = ".optport";

/// Client of the Aspera Transfer Daemon (transferd): start the daemon, start transfers and wait for their end.
pub struct TransferClient {
    config: Arc<Configuration>,
    server_address: String,
    server_port: u16,
    daemon_process: Option<Child>,
    transfer_service: Option<Box<TransferServiceClient<Channel>>>,
    daemon_name: String,
    /// folder of the configuration, output and logs of the daemon: a new one for each start
    daemon_folder: PathBuf,
    daemon_log: PathBuf,
    /// `runtime_dir` of the daemon, where it writes its port file: only with port 0
    runtime_dir: Option<PathBuf>,
}

impl TransferClient {
    /// Create a transfer client.
    ///
    /// # Arguments
    /// * `config` - configuration of the samples
    ///
    /// # Returns
    /// Transfer client
    pub fn new(config: Arc<Configuration>) -> Self {
        let sdk_url = config.param_str("trsdk", "url").unwrap_or_else(|e| panic!("{e}"));
        let sdk_uri = url::Url::parse(&sdk_url).unwrap_or_else(|_| panic!("Invalid URL: {sdk_url}"));
        let server_address = sdk_uri.host().unwrap_or_else(|| panic!("Invalid URL: {sdk_url}")).to_string();
        let server_port = sdk_uri.port().unwrap_or(TRANSFERD_DEFAULT_PORT);
        let daemon_name = config.get_path("sdk_daemon").unwrap_or_default().file_name().unwrap_or_default().to_string_lossy().to_string();
        TransferClient {
            config,
            server_address,
            server_port,
            daemon_name,
            daemon_folder: PathBuf::new(),
            daemon_log: PathBuf::new(),
            runtime_dir: None,
            transfer_service: None,
            daemon_process: None,
        }
    }
    /// Create the configuration file of the daemon.
    /// See: https://developer.ibm.com/apis/catalog/aspera--aspera-transfer-sdk/Configuration%20File
    ///
    /// # Arguments
    /// * `conf_file` - path of the configuration file
    fn daemon_create_config_file(&self, conf_file: &PathBuf) -> Result<(), Box<dyn Error>> {
        let ascp_level = self.config.param_str("trsdk", "ascp_level")?;
        let ascp_int_level = match ascp_level.as_str() {
            "info" => 0,
            "debug" => 1,
            "trace" => 2,
            _ => return Err(format!("Invalid ascp_level: {}", ascp_level).into()),
        };

        let mut config_info = json!({
            "address": self.server_address,
            "port": self.server_port,
            "log_directory": self.daemon_folder.to_string_lossy(),
            "log_level": self.config.param_str("trsdk","level")?,
            "fasp_runtime": {
                "use_embedded": true,
                "log": {
                    "dir": self.daemon_folder.to_string_lossy(),
                    "level": ascp_int_level,
                }
            }
        });
        if let Some(runtime_dir) = &self.runtime_dir {
            config_info["runtime_dir"] = json!(runtime_dir.to_string_lossy());
        }
        let config_data = serde_json::to_string(&config_info).map_err(|e| e.to_string())?;
        let mut conf_stream = File::create(conf_file).map_err(|e| e.to_string())?;
        conf_stream
            .write_all(config_data.as_bytes())
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Get the path of a file of the daemon, in its folder.
    ///
    /// # Arguments
    /// * `file_ext` - extension of the file: `conf`, `out`, `err` or `log`
    ///
    /// # Returns
    /// Path of the file
    fn daemon_file_path(&self, file_ext: &str) -> PathBuf {
        self.daemon_folder
            .join(format!("{}.{}", self.daemon_name, file_ext))
    }

    /// Create a folder readable only by the user, where the OS supports it.
    ///
    /// # Arguments
    /// * `folder` - path of the folder
    fn create_private_folder(folder: &Path) -> std::io::Result<()> {
        let mut builder = std::fs::DirBuilder::new();
        #[cfg(unix)]
        std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
        builder.create(folder)
    }

    /// Start the daemon, with its configuration, output and logs in a new folder of the log folder.
    pub fn daemon_start(&mut self) -> Result<(), Box<dyn Error>> {
        // samples run at the same time do not share files
        self.daemon_folder = self
            .config
            .log_folder_path()
            .join(format!("{}.{}", self.daemon_name, uuid::Uuid::new_v4()));
        Self::create_private_folder(&self.daemon_folder)?;
        let conf_path = self.daemon_file_path("conf");
        let out_path = self.daemon_file_path("out");
        let err_path = self.daemon_file_path("err");
        self.daemon_log = self.daemon_file_path("log");
        if self.server_port == 0 {
            // the daemon writes its port file in this folder: of this daemon only, readable only by the user
            let runtime_dir = self.daemon_folder.join("run");
            Self::create_private_folder(&runtime_dir)?;
            self.runtime_dir = Some(runtime_dir);
        }
        let ascp_log_path = self.daemon_folder.join(ASCP_LOG_FILE);
        self.daemon_create_config_file(&conf_path)?;
        let stdout_file = File::create(out_path.clone())?;
        let stderr_file = File::create(err_path.clone())?;
        let daemon_path = self.config.get_path("sdk_daemon")?;
        let args = ["--config", conf_path.to_str().ok_or("Invalid path")?];
        log_dump("Daemon command", format!("{} {}", daemon_path.display(), args.join(" ")), Debug);
        log_dump("Daemon out", out_path.display(), Debug);
        log_dump("Daemon err", err_path.display(), Debug);
        log_dump("Daemon log", self.daemon_log.display(), Debug);
        log_dump("Ascp log", ascp_log_path.display(), Debug);
        log::info!("Starting daemon");

        // Start the subprocess in the background
        let daemon_process: Child = Command::new(daemon_path)
            .args(&args)
            .stdout(Stdio::from(stdout_file))
            .stderr(Stdio::from(stderr_file))
            .spawn()?;
        self.daemon_process = Some(daemon_process);
        self.wait_daemon_listening()
    }
    /// Wait for the daemon to listen, and get the port if dynamically allocated (port 0).
    /// With port 0, the daemon writes its port in a file of its `runtime_dir` once it listens.
    /// This requires transferd 1.1.7 or later.
    fn wait_daemon_listening(&mut self) -> Result<(), Box<dyn Error>> {
        let deadline = Instant::now() + STARTUP_TIMEOUT;
        loop {
            if let Some(daemon_process) = self.daemon_process.as_mut() {
                if let Some(status) = daemon_process.try_wait()? {
                    self.daemon_process = None;
                    return Err(format!(
                        "Daemon exited with code {}, see log: {}",
                        status.code().unwrap_or(-1),
                        self.daemon_log.display()
                    )
                    .into());
                }
            }
            // fixed port: readiness is checked on connection
            let Some(runtime_dir) = &self.runtime_dir else {
                return Ok(());
            };
            if let Some(port) = Self::read_port_file(runtime_dir)? {
                self.server_port = port;
                return Ok(());
            }
            if Instant::now() > deadline {
                return Err(format!(
                    "Port file not found in {}: transferd 1.1.7 or later is required",
                    runtime_dir.display()
                )
                .into());
            }
            thread::sleep(Duration::from_millis(200));
        }
    }
    /// Read the port of the daemon in its port file `transferd.<port>.optport`, in its `runtime_dir`.
    /// The daemon creates the file, then writes the port: an empty file is not ready yet.
    ///
    /// # Arguments
    /// * `runtime_dir` - `runtime_dir` of the daemon
    ///
    /// # Returns
    /// Port, or none if not written (yet)
    fn read_port_file(runtime_dir: &Path) -> Result<Option<u16>, Box<dyn Error>> {
        let mut port_files = Vec::new();
        for entry in std::fs::read_dir(runtime_dir)? {
            let entry = entry?;
            if entry.file_name().to_string_lossy().ends_with(PORT_FILE_EXTENSION) {
                port_files.push(entry.path());
            }
        }
        let port_file = match port_files.as_slice() {
            [] => return Ok(None),
            [port_file] => port_file,
            _ => return Err(format!("Several port files in {}", runtime_dir.display()).into()),
        };
        let content = std::fs::read_to_string(port_file)?;
        if content.is_empty() {
            return Ok(None);
        }
        if !content.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(format!("No port in file {}", port_file.display()).into());
        }
        Ok(Some(content.parse::<u16>()?))
    }
    /// Start the daemon and connect to it, if not already done.
    pub async fn daemon_startup(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        if self.transfer_service.is_none() {
            self.daemon_start()?;
            self.daemon_connect().await?;
        }
        Ok(())
    }
    /// Get the client of the daemon API, once connected.
    ///
    /// # Returns
    /// Client of the daemon API
    pub fn get_transfer_service(
        &mut self,
    ) -> Result<&mut TransferServiceClient<Channel>, Box<dyn Error>> {
        // Attempt to get a mutable reference to the transfer_service or return an error if not initialized
        self.transfer_service
            .as_mut()
            .ok_or_else(|| "Client is not initialized".into())
            .map(|client| &mut **client)
    }
    /// Connect to the daemon.
    pub async fn daemon_connect(&mut self) -> Result<(), Box<dyn Error>> {
        let address = format!("{}:{}", self.server_address, self.server_port);
        // retry until the daemon listens
        let deadline = Instant::now() + CONNECT_TIMEOUT;
        let mut client = loop {
            match TransferServiceClient::connect(format!("http://{address}")).await {
                Ok(client) => break client,
                Err(_) if Instant::now() < deadline => {
                    tokio::time::sleep(Duration::from_millis(200)).await;
                }
                Err(_) => return Err(format!("Failed to connect to daemon: {address}").into()),
            }
        };
        self.transfer_service = Some(Box::new(client.clone()));
        let _instance_info_response = client.get_info(InstanceInfoRequest {}).await?;
        log::info!("Connected to daemon: {address}");
        Ok(())
    }

    /// Start the daemon if needed, start a transfer, and wait for its end.
    ///
    /// # Arguments
    /// * `transfer_spec` - transfer spec
    pub async fn transfer_start_and_wait(
        &mut self,
        transfer_spec: &serde_json::Value,
    ) -> Result<(), Box<dyn Error>> {
        self.daemon_startup().await?;
        // display transfer spec in log
        log_dump("Transfer spec", transfer_spec, Debug);
        let request = TransferRequest {
            transfer_type: TransferType::FileRegular.into(),
            transfer_spec: transfer_spec.to_string(),
            config: None,
        };
        // start the transfer: the daemon sends an event on each change, until the end of the transfer
        // dropping the stream on return stops monitoring, if the stream is still open
        let mut events = self
            .get_transfer_service()?
            .start_transfer_with_monitor(request)
            .await?
            .into_inner();
        while let Some(event) = events.message().await? {
            let status = TransferStatus::try_from(event.status).unwrap_or(TransferStatus::UnknownStatus);
            let transfer_info = event.transfer_info.as_ref();
            Self::log_status(status, transfer_info.map_or(0, |info| info.average_rate_kbps));
            // `error` is empty on session errors: the cause is in session or transfer information
            Self::throw_on_error(
                status,
                &[
                    event.error.as_ref().map(|err| err.description.as_str()),
                    event.session_info.as_ref().map(|info| info.error_desc.as_str()),
                    transfer_info.map(|info| info.error_description.as_str()),
                ],
            )?;
            if status == TransferStatus::Completed {
                return Ok(());
            }
        }
        Err("Transfer monitoring ended before transfer completion".into())
    }
    /// Stop the daemon, if it was started: send SIGINT, and kill it if it does not stop in time.
    /// Then delete its `runtime_dir`: a killed daemon does not delete its port file.
    pub fn daemon_shutdown(&mut self) -> Result<(), String> {
        self.transfer_service = None;
        if let Some(mut daemon_process) = self.daemon_process.take() {
            log::info!("Stopping daemon");
            Self::interrupt(&mut daemon_process);
            let deadline = Instant::now() + SHUTDOWN_TIMEOUT;
            while daemon_process.try_wait().map_err(|e| e.to_string())?.is_none() {
                if Instant::now() > deadline {
                    log::warn!("Daemon did not stop, killing it");
                    daemon_process.kill().map_err(|e| e.to_string())?;
                    daemon_process.wait().map_err(|e| e.to_string())?;
                    break;
                }
                thread::sleep(Duration::from_millis(100));
            }
        }
        if let Some(runtime_dir) = self.runtime_dir.take() {
            let _ = std::fs::remove_dir_all(runtime_dir);
        }
        Ok(())
    }
    /// Send SIGINT to the daemon.
    /// transferd stops cleanly on SIGINT (not on SIGTERM).
    ///
    /// # Arguments
    /// * `process` - daemon process
    #[cfg(unix)]
    fn interrupt(process: &mut Child) {
        // SAFETY: sends a signal to our own child process
        unsafe {
            libc::kill(process.id() as libc::pid_t, libc::SIGINT);
        }
    }
    /// Terminate the daemon.
    /// Windows has no SIGINT for child processes: the process is terminated.
    ///
    /// # Arguments
    /// * `process` - daemon process
    #[cfg(not(unix))]
    fn interrupt(process: &mut Child) {
        let _ = process.kill();
    }
    /// Log the transfer status, and the rate when running.
    ///
    /// # Arguments
    /// * `status` - transfer status
    /// * `average_rate_kbps` - average rate in kilobits per second
    fn log_status(status: TransferStatus, average_rate_kbps: i64) {
        if status == TransferStatus::Running {
            log::info!("Transfer: {} {:.1} Mbps", status.as_str_name(), average_rate_kbps as f64 / 1000.0);
        } else {
            log::info!("Transfer: {}", status.as_str_name());
        }
    }
    /// Return an error if the transfer status is failed, canceled or unknown.
    ///
    /// # Arguments
    /// * `status` - transfer status
    /// * `descriptions` - error descriptions: the first non-empty one is used
    fn throw_on_error(status: TransferStatus, descriptions: &[Option<&str>]) -> Result<(), Box<dyn Error>> {
        let description = descriptions
            .iter()
            .flatten()
            .map(|text| text.trim())
            .find(|text| !text.is_empty())
            .unwrap_or("unknown error");
        match status {
            TransferStatus::Failed | TransferStatus::Canceled => Err(format!("Transfer failed: {description}").into()),
            TransferStatus::UnknownStatus => Err(format!("Transfer status unknown: {description}").into()),
            _ => Ok(()),
        }
    }
}
impl Drop for TransferClient {
    /// Stop the daemon, if it was started: send SIGINT, and kill it if it does not stop in time.
    fn drop(&mut self) {
        let _ = self.daemon_shutdown();
    }
}
