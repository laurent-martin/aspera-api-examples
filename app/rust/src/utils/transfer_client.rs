use super::configuration::Configuration;
use regex::Regex;
use serde_json::json;
use std::error::Error;
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
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
use transfer::QueryTransferResponse;
use transfer::TransferInfoRequest;
use transfer::TransferRequest;
use transfer::TransferStatus;
use transfer::TransferType;

const ASCP_LOG_FILE: &str = "aspera-scp-transfer.log";
/// default port of transferd if not specified in URL
const TRANSFERD_DEFAULT_PORT: u16 = 55002;
/// max wait time for the daemon to log its listening port
const STARTUP_TIMEOUT: Duration = Duration::from_secs(10);
/// max wait time for the connection to the daemon
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// max wait time for the daemon to stop gracefully
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);
/// API port in daemon log (text or JSON log format), e.g. `API Server: Listening on 127.0.0.1:55002 ...`
const PORT_REGEX: &str = r#"API Server: Listening on [^\s"]+:([0-9]+)"#;

/// Simplified interface for the Aspera Transfer SDK
pub struct TransferClient {
    config: Arc<Configuration>,
    server_address: String,
    server_port: u16,
    daemon_process: Option<Child>,
    transfer_service: Option<Box<TransferServiceClient<Channel>>>,
    daemon_name: String,
    daemon_log: PathBuf,
}

impl TransferClient {
    pub fn new(config: Arc<Configuration>) -> Self {
        let sdk_url = config.param_str("trsdk", "url").expect("Invalid trsdk url");
        let sdk_uri = url::Url::parse(&sdk_url).expect("Failed to parse SDK URL");
        let server_address = sdk_uri.host().expect("No host found").to_string();
        let server_port = sdk_uri.port().unwrap_or(TRANSFERD_DEFAULT_PORT);
        let daemon_name = config.get_path("sdk_daemon").unwrap_or_default().file_name().unwrap_or_default().to_string_lossy().to_string();
        let daemon_log = config.log_folder_path().join(format!("{}.log",daemon_name));
        TransferClient {
            config,
            server_address,
            server_port,
            daemon_name,
            daemon_log,
            transfer_service: None,
            daemon_process: None,
        }
    }
    /// Create a configuration file for the daemon
    fn daemon_create_config_file(&self, conf_file: &PathBuf) -> Result<(), Box<dyn Error>> {
        let ascp_level = self.config.param_str("trsdk", "ascp_level")?;
        let ascp_int_level = match ascp_level.as_str() {
            "info" => 0,
            "debug" => 1,
            "trace" => 2,
            _ => return Err(format!("Invalid ascp_level: {}", ascp_level).into()),
        };

        let config_info = json!({
            "address": self.server_address,
            "port": self.server_port,
            "log_directory": self.config.log_folder_path().to_string_lossy(),
            "log_level": self.config.param_str("trsdk","level")?,
            "fasp_runtime": {
                "use_embedded": true,
                "log": {
                    "dir": self.config.log_folder_path().to_string_lossy(),
                    "level": ascp_int_level,
                }
            }
        });
        let config_data = serde_json::to_string(&config_info).map_err(|e| e.to_string())?;
        let mut conf_stream = File::create(conf_file).map_err(|e| e.to_string())?;
        conf_stream
            .write_all(config_data.as_bytes())
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Create a path to the daemon file with the given extension
    fn daemon_file_path(&self, file_ext: &str) -> PathBuf {
        self.config
            .log_folder_path()
            .join(format!("{}.{}", self.daemon_name, file_ext))
    }

    pub fn daemon_start(&mut self) -> Result<(), Box<dyn Error>> {
        let conf_path = self.daemon_file_path("conf");
        let out_path = self.daemon_file_path("out");
        let err_path = self.daemon_file_path("err");
        let ascp_log_path = self.config.log_folder_path().join(ASCP_LOG_FILE);
        self.daemon_create_config_file(&conf_path)?;
        let stdout_file = File::create(out_path.clone())?;
        let stderr_file = File::create(err_path.clone())?;
        let daemon_path = self.config.get_path("sdk_daemon")?;
        let args = ["--config", conf_path.to_str().ok_or("Invalid path")?];
        log::debug!("daemon out: {out_path:?}");
        log::debug!("daemon err: {err_path:?}");
        log::debug!("daemon conf: {conf_path:?}");
        log::debug!("daemon log: {:?}", self.daemon_log);
        log::debug!("ascp log: {ascp_log_path:?}");
        log::debug!("starting: {} {}", daemon_path.display(), args.join(" "));

        // the log file may contain lines of previous executions: only read new lines
        let log_offset = std::fs::metadata(&self.daemon_log)
            .map(|m| m.len())
            .unwrap_or(0);
        // Start the subprocess in the background
        let daemon_process: Child = Command::new(daemon_path)
            .args(&args)
            .stdout(Stdio::from(stdout_file))
            .stderr(Stdio::from(stderr_file))
            .spawn()?;
        log::debug!("Started process with PID: {}", daemon_process.id());
        self.daemon_process = Some(daemon_process);
        self.wait_daemon_listening(log_offset)
    }
    /// Wait for the daemon to listen, and get the port if dynamically allocated (port 0).
    /// The port is read from the daemon log: requires log level `info` or more verbose.
    fn wait_daemon_listening(&mut self, log_offset: u64) -> Result<(), Box<dyn Error>> {
        let re: Regex = Regex::new(PORT_REGEX)?;
        let deadline = Instant::now() + STARTUP_TIMEOUT;
        loop {
            if let Some(daemon_process) = self.daemon_process.as_mut() {
                if let Some(status) = daemon_process.try_wait()? {
                    self.daemon_process = None;
                    log::error!("Check daemon log: {:?}", self.daemon_log);
                    return Err(format!("Daemon has finished with exit status: {:?}", status).into());
                }
            }
            // fixed port: readiness is checked on connection
            if self.server_port != 0 {
                return Ok(());
            }
            if let Some(port) = Self::find_listening_port(&re, &self.daemon_log, log_offset)? {
                self.server_port = port;
                log::info!("Allocated server port: {}", self.server_port);
                return Ok(());
            }
            if Instant::now() > deadline {
                return Err(format!(
                    "Listening port not found in daemon log after {:?}: {:?}",
                    STARTUP_TIMEOUT, self.daemon_log
                )
                .into());
            }
            thread::sleep(Duration::from_millis(200));
        }
    }
    /// Find the API listening port in the daemon log, after the given offset.
    /// Returns None if not found (yet).
    fn find_listening_port(
        re: &Regex,
        log_file: &PathBuf,
        log_offset: u64,
    ) -> Result<Option<u16>, Box<dyn Error>> {
        let content = match std::fs::read(log_file) {
            Ok(content) => content,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e.into()),
        };
        // log file was truncated
        let offset = if (content.len() as u64) < log_offset {
            0
        } else {
            log_offset as usize
        };
        let text = String::from_utf8_lossy(&content[offset..]);
        match re.captures(&text) {
            Some(captures) => Ok(Some(captures[1].parse::<u16>()?)),
            None => Ok(None),
        }
    }
    /// start daemon and connect to it
    pub async fn daemon_startup(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        if self.transfer_service.is_none() {
            self.daemon_start()?;
            self.daemon_connect().await?;
        }
        Ok(())
    }
    /// helper function to get mutable reference to transfer_service
    pub fn get_transfer_service(
        &mut self,
    ) -> Result<&mut TransferServiceClient<Channel>, Box<dyn Error>> {
        // Attempt to get a mutable reference to the transfer_service or return an error if not initialized
        self.transfer_service
            .as_mut()
            .ok_or_else(|| "Client is not initialized".into())
            .map(|client| &mut **client)
    }
    /// Connect to the daemon
    pub async fn daemon_connect(&mut self) -> Result<(), Box<dyn Error>> {
        let channel_address = format!("http://{}:{}", self.server_address, self.server_port);
        // retry until the daemon listens
        let deadline = Instant::now() + CONNECT_TIMEOUT;
        let mut client = loop {
            match TransferServiceClient::connect(channel_address.clone()).await {
                Ok(client) => break client,
                Err(e) if Instant::now() < deadline => {
                    log::debug!("waiting for daemon: {e}");
                    tokio::time::sleep(Duration::from_millis(200)).await;
                }
                Err(e) => return Err(e.into()),
            }
        };
        self.transfer_service = Some(Box::new(client.clone()));
        let _instance_info_response = client.get_info(InstanceInfoRequest {}).await?;
        log::debug!("Connected to daemon.");
        Ok(())
    }

    /// Start a transfer and return the transfer ID
    ///
    /// ### Arguments
    /// * `transfer_spec` - The transfer specification as a JSON value
    ///
    /// ### Returns
    /// The transfer ID
    pub async fn transfer_start(
        &mut self,
        transfer_spec: &serde_json::Value,
    ) -> Result<String, Box<dyn Error>> {
        // display transfer spec in log
        log::debug!("transfer_spec: {:?}", transfer_spec);
        // start the daemon if needed
        self.daemon_startup().await?;
        let request = TransferRequest {
            transfer_type: TransferType::FileRegular.into(),
            transfer_spec: transfer_spec.to_string(),
            config: None,
        };
        // get the actual transfer_service from the Option, and return Error if it's None
        let response = self
            .get_transfer_service()?
            .start_transfer(request)
            .await?
            .into_inner();
        let status = TransferStatus::try_from(response.status).unwrap_or(TransferStatus::UnknownStatus);
        if status == TransferStatus::Failed || status == TransferStatus::UnknownStatus {
            let description = response.error.map(|e| e.description).unwrap_or_default();
            return Err(format!("transfer start failed: {}: {}", status.as_str_name(), description).into());
        }
        Ok(response.transfer_id)
    }
    /// Start a transfer and wait for it to complete
    pub async fn transfer_start_and_wait(
        &mut self,
        transfer_spec: &serde_json::Value,
    ) -> Result<String, Box<dyn Error>> {
        let transfer_id = self.transfer_start(transfer_spec).await?;
        self.transfer_wait(&transfer_id).await?;
        Ok(transfer_id)
    }
    /// Wait for a transfer to complete and display status.
    pub async fn transfer_wait(
        &mut self,
        transfer_id: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        loop {
            let transfer_info_request = TransferInfoRequest {
                transfer_id: transfer_id.to_string(),
                ..Default::default()
            };
            let query_transfer_request = tonic::Request::new(transfer_info_request);
            let client: &mut TransferServiceClient<Channel> = self.get_transfer_service()?;
            let query_transfer_response: QueryTransferResponse = client
                .query_transfer(query_transfer_request)
                .await?
                .into_inner();
            let status = TransferStatus::try_from(query_transfer_response.status)
                .unwrap_or(TransferStatus::UnknownStatus);
            log::info!("transfer: {:?}", status.as_str_name());
            //log::debug!("response: {:?}", query_transfer_response);
            Self::transfer_check_failed_status(status, &query_transfer_response, transfer_id)?;
            if status == TransferStatus::Completed {
                break;
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        Ok(())
    }
    /// Shutdown the daemon gracefully, or kill it after a timeout, and wait for its termination
    pub fn daemon_shutdown(&mut self) -> Result<(), String> {
        self.transfer_service = None;
        if let Some(mut daemon_process) = self.daemon_process.take() {
            log::debug!("Shutting down daemon...");
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
        Ok(())
    }
    /// transferd stops cleanly on SIGINT (not on SIGTERM)
    #[cfg(unix)]
    fn interrupt(process: &mut Child) {
        // SAFETY: sends a signal to our own child process
        unsafe {
            libc::kill(process.id() as libc::pid_t, libc::SIGINT);
        }
    }
    /// Windows has no SIGINT for child processes: kill
    #[cfg(not(unix))]
    fn interrupt(process: &mut Child) {
        let _ = process.kill();
    }
    /// Check if transfer is failed.
    /// If failed, log error and return error
    fn transfer_check_failed_status(
        status: TransferStatus,
        response: &QueryTransferResponse,
        transfer_id: &str,
    ) -> Result<(), Box<dyn Error>> {
        if let Some(err) = &response.error {
            log::error!("Error code: {}", err.code);
            log::error!("Error description: {}", err.description);
        }
        if status == TransferStatus::Failed {
            log::error!("Transfer failed: {:?}", response.transfer_info);
            // `error` is empty on session errors: the cause is in transfer information
            let description = [
                response.error.as_ref().map(|err| err.description.as_str()),
                response.transfer_info.as_ref().map(|info| info.error_description.as_str()),
            ]
            .into_iter()
            .flatten()
            .map(str::trim)
            .find(|text| !text.is_empty())
            .unwrap_or("unknown error");
            return Err(format!("Transfer failed: {description}").into());
        }
        if status == TransferStatus::UnknownStatus {
            log::error!("Unknown transfer id: {transfer_id:?} : {response:?}");
            return Err("Unknown transfer id".into());
        }
        Ok(())
    }
}
impl Drop for TransferClient {
    fn drop(&mut self) {
        let _ = self.daemon_shutdown();
    }
}
