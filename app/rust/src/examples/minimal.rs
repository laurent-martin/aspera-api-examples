//! Upload files to an HSTS with SSH credentials, with the Transfer Daemon API only (gRPC).
//! Read this sample first: the other samples use the helper class TransferClient, which does the same steps.
//! The class Configuration only reads the parameters of the test environment: replace config.param_str(...) with your values.
use samples::utils::configuration::Configuration;
use serde_json::json;
use std::error::Error;
use std::fs::File;
use std::path::Path;
use std::process::Command;
use std::time::{Duration, Instant};
use url::Url;

/// stub code generated from transferd.proto (see build.rs): the sample uses only part of it
#[allow(dead_code)]
mod transferd {
    tonic::include_proto!("transferd.api");
}
use transferd::transfer_service_client::TransferServiceClient;
use transferd::{
    RegistrationFilter, RegistrationRequest, TransferRequest, TransferStatus, TransferType,
};

/// address of the gRPC API, set in the default configuration file of the SDK: etc/transferd.json
const DAEMON_ADDRESS: &str = "127.0.0.1:55002";

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let config = Configuration::new()?;

    // 1. Start the Transfer Daemon. Without option, transferd reads etc/transferd.json of the SDK.
    //    In production, the daemon can also run as a service, started separately.
    let daemon_out = std::env::temp_dir().join("transferd_minimal.out");
    let out = File::create(&daemon_out)?;
    log::info!("Starting daemon");
    let mut daemon = Command::new(config.get_path("sdk_daemon")?)
        .stdout(out.try_clone()?)
        .stderr(out)
        .spawn()?;

    let result = transfer(&config, &daemon_out).await;

    // 6. Stop the daemon: transferd stops cleanly on SIGINT (Windows: killed)
    log::info!("Stopping daemon");
    #[cfg(unix)]
    // SAFETY: sends a signal to our own child process
    unsafe {
        libc::kill(daemon.id() as libc::pid_t, libc::SIGINT);
    }
    #[cfg(not(unix))]
    daemon.kill()?;
    daemon.wait()?;
    result
}

/// Connect to the daemon, start the transfer, and follow it until its end.
///
/// # Arguments
/// * `config` - configuration of the samples
/// * `daemon_out` - output file of the daemon
async fn transfer(config: &Configuration, daemon_out: &Path) -> Result<(), Box<dyn Error>> {
    // 2. Connect to the gRPC API of the daemon: retry until the daemon listens
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut client = loop {
        match TransferServiceClient::connect(format!("http://{DAEMON_ADDRESS}")).await {
            Ok(client) => break client,
            Err(_) if Instant::now() < deadline => {
                tokio::time::sleep(Duration::from_millis(200)).await
            }
            Err(_) => {
                return Err(format!(
                    "Failed to connect to daemon: {DAEMON_ADDRESS}, see: {}",
                    daemon_out.display()
                )
                .into());
            }
        }
    };
    log::info!("Connected to daemon: {DAEMON_ADDRESS}");

    // 3. Build the transfer spec: upload (send) with SSH credentials
    let server_url = Url::parse(&config.param_str("server", "url")?)?;
    // files to transfer: arguments of the command line
    let paths: Vec<_> = std::env::args()
        .skip(1)
        .map(|file| json!({ "source": file }))
        .collect();
    let transfer_spec = json!({
        "direction": "send",
        "remote_host": server_url.host_str().unwrap_or_default(),
        "ssh_port": server_url.port(),
        "remote_user": config.param_str("server", "username")?,
        "remote_password": config.param_str("server", "password")?,
        "destination_root": config.param_str("server", "folder_upload")?,
        "paths": paths,
    });

    // 4. Start the transfer: the daemon returns a transfer id
    log::info!("Uploading files");
    let response = client
        .start_transfer(TransferRequest {
            transfer_type: TransferType::FileRegular.into(),
            transfer_spec: transfer_spec.to_string(),
            config: None,
        })
        .await?
        .into_inner();
    if response.status() == TransferStatus::Failed {
        let description = response
            .error
            .map(|error| error.description)
            .unwrap_or_default();
        return Err(format!("Transfer failed: {description}").into());
    }

    // 5. Follow the transfer: the daemon sends an event on each change, until the end
    let mut events = client
        .monitor_transfers(RegistrationRequest {
            filters: vec![RegistrationFilter {
                transfer_id: vec![response.transfer_id],
                ..Default::default()
            }],
            ..Default::default()
        })
        .await?
        .into_inner();
    while let Some(event) = events.message().await? {
        let status = event.status();
        let info = event.transfer_info.unwrap_or_default();
        log::info!(
            "Transfer: {} {} bytes",
            status.as_str_name(),
            info.bytes_transferred
        );
        match status {
            TransferStatus::Failed | TransferStatus::Canceled => {
                // the cause is in error, or else in transferInfo
                let description = event
                    .error
                    .map(|error| error.description)
                    .filter(|text| !text.is_empty())
                    .unwrap_or(info.error_description);
                return Err(format!("Transfer failed: {}", description.trim()).into());
            }
            TransferStatus::Completed => break,
            _ => {}
        }
    }
    Ok(())
}
