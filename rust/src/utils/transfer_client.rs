use super::configuration::Configuration;
use serde_json::json;
use std::error::Error;
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tonic::transport::Channel;

pub mod transfer {
    // Import your gRPC definitions with default package name in proto file
    tonic::include_proto!("transfersdk");
}

use transfer::transfer_service_client::TransferServiceClient;
use transfer::InstanceInfoRequest;
use transfer::QueryTransferResponse;
use transfer::TransferInfoRequest;
use transfer::TransferRequest;
use transfer::TransferStatus;
use transfer::TransferType;

const TRANSFER_SDK_DAEMON: &str = "asperatransferd";
const DAEMON_LOG_FILE: &str = "asperatransferd.log";
const ASCP_LOG_FILE: &str = "aspera-scp-transfer.log";
const MAX_CONNECTION_WAIT_SEC: u64 = 10;

pub struct TransferClient {
    config: Arc<Configuration>,
    server_address: String,
    server_port: u16,
    transfer_service: Option<Box<TransferServiceClient<Channel>>>,
    daemon_process: Option<Child>,
}

impl TransferClient {
    pub fn new(config: Arc<Configuration>) -> Self {
        let sdk_url = config.param_str("trsdk", "url").expect("Invalid trsdk url");
        let sdk_uri = url::Url::parse(&sdk_url).expect("Failed to parse SDK URL");
        let server_address = sdk_uri.host().expect("No host found").to_string();
        let server_port = sdk_uri.port().unwrap_or(22); // Default to port 22

        TransferClient {
            config,
            server_address,
            server_port,
            transfer_service: None,
            daemon_process: None,
        }
    }

    pub fn create_config_file(&self, conf_file: &PathBuf) -> Result<(), Box<dyn Error>> {
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
                "use_embedded": false,
                "user_defined": {
                    "bin": self.config.get_path("sdk_runtime")?,
                    "etc": self.config.get_path("sdk_runtime")?,
                },
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

    fn daemon_file_path(&self, file_ext: &str) -> PathBuf {
        self.config
            .log_folder_path()
            .join(format!("{}.{}", TRANSFER_SDK_DAEMON, file_ext))
    }

    pub fn start_daemon(&mut self) -> Result<(), Box<dyn Error>> {
        let conf_path = self.daemon_file_path("conf");
        let out_path = self.daemon_file_path("out");
        let err_path = self.daemon_file_path("err");
        let log_path = self.config.log_folder_path().join(DAEMON_LOG_FILE);
        self.create_config_file(&conf_path)?;
        let stdout_file = File::create(out_path.clone())?;
        let stderr_file = File::create(err_path.clone())?;
        let sdk_runtime_path = self.config.get_path("sdk_runtime")?;
        let sdk_path: PathBuf = sdk_runtime_path.join(TRANSFER_SDK_DAEMON);
        let command = sdk_path.to_str().ok_or("Invalid path")?;
        let args = ["--config", conf_path.to_str().ok_or("Invalid path")?];
        log::debug!("daemon out: {:?}", out_path);
        log::debug!("daemon err: {:?}", err_path);
        log::debug!("daemon conf: {:?}", conf_path);
        log::debug!("daemon log: {:?}", log_path);
        log::debug!("starting: {:?} {}", log_path, args.join(" "));

        // Start the subprocess in the background
        let mut daemon_process: Child = Command::new(command)
            .args(&args)
            .stdout(Stdio::from(stdout_file))
            .stderr(Stdio::from(stderr_file))
            .spawn()?;

        // Print the PID of the child process
        log::debug!("Started process with PID: {}", daemon_process.id());

        // Wait for 2 seconds
        thread::sleep(Duration::from_secs(2));

        // Check if the child process is still running
        match daemon_process.try_wait() {
            Ok(Some(status)) => {
                return Err(format!("Process has finished with exit status: {:?}", status).into());
            }
            Ok(None) => {
                log::debug!("Process is still running.");
            }
            Err(e) => {
                return Err(format!("Error checking process status: {}", e).into());
            }
        }
        self.daemon_process = Some(daemon_process);
        Ok(())
    }

    pub async fn startup(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        if self.transfer_service.is_none() {
            self.start_daemon()?;
            self.connect_to_daemon().await?;
        }
        Ok(())
    }

    pub fn get_transfer_service(
        &mut self,
    ) -> Result<&mut TransferServiceClient<Channel>, Box<dyn Error>> {
        // Attempt to get a mutable reference to the transfer_service or return an error if not initialized
        self.transfer_service
            .as_mut()
            .ok_or_else(|| "Client is not initialized".into())
            .map(|client| &mut **client)
    }

    pub async fn connect_to_daemon(&mut self) -> Result<(), Box<dyn Error>> {
        let channel_address = format!("http://{}:{}", self.server_address, self.server_port);
        let mut client = TransferServiceClient::connect(channel_address).await?;
        self.transfer_service = Some(Box::new(client.clone()));
        let instance_info_response = client.get_info(InstanceInfoRequest {}).await?;
        log::debug!("Connected to daemon: {:?}", instance_info_response);
        Ok(())
    }

    pub async fn start_transfer(
        &mut self,
        transfer_spec: &serde_json::Value,
    ) -> Result<String, Box<dyn Error>> {
        // display transfer spec in log
        log::debug!("transfer_spec: {:?}", transfer_spec);
        let request = TransferRequest {
            transfer_type: TransferType::FileRegular.into(),
            transfer_spec: transfer_spec.to_string(),
            config: None,
        };
        // get the actual transfer_service from the Option, and return Error if it's None
        let response = self.get_transfer_service()?.start_transfer(request).await?;
        // return field .transfer_id from response
        Ok(response.into_inner().transfer_id)
    }
    pub async fn start_transfer_and_wait(
        &mut self,
        transfer_spec: &serde_json::Value,
    ) -> Result<String, Box<dyn Error>> {
        // Ensure daemon is started and we are connected
        self.startup().await?; // Ensure this returns a Result type
        let transfer_id = self.start_transfer(transfer_spec).await?;
        self.wait_transfer(&transfer_id).await?;
        Ok(transfer_id)
    }

    pub async fn wait_transfer(
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
            let status = TransferStatus::from_i32(query_transfer_response.status)
                .unwrap_or(TransferStatus::UnknownStatus);
            log::info!("transfer: {:?}", status.as_str_name());
            if status == TransferStatus::Completed {
                break;
            } else if status == TransferStatus::Failed {
                log::debug!(
                    "query_transfer_response: {:?}",
                    query_transfer_response.transfer_info
                );
                return Err("Transfer failed".into());
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        Ok(())
    }

    pub fn shutdown(&mut self) -> Result<(), String> {
        if let Some(ref mut daemon_process) = self.daemon_process {
            log::debug!("Shutting down daemon...");
            daemon_process.kill().map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}
//destructor
impl Drop for TransferClient {
    fn drop(&mut self) {
        self.shutdown().unwrap();
    }
}
