use log::info;
use rust::utils::configuration::Configuration;
use rust::utils::transfer_client::TransferClient;
use serde_json::json;
use std::error::Error;
use std::sync::Arc;
use url::Url;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let config = Configuration::new()?;
    let mut transfer_client: TransferClient = TransferClient::new(Arc::new(config));
    transfer_client.startup().await?;
    let server_url = config.param_str("server", "url")?;
    info!("Server URL: {}", server_url);
    let server_uri = Url::parse(&server_url)?;
    assert_eq!(server_uri.scheme(), "ssh");
    // Create V2 transfer spec
    let mut transfer_spec = json!({
        "title": "test with transfer spec V2",
        "remote_host": server_uri.host_str().unwrap_or_default(),
        "session_initiation": {
            "ssh": {
                "ssh_port": server_uri.port_or_known_default().unwrap_or(33001),
                "remote_user": config.param_str("server", "username")?,
                "remote_password": config.param_str("server", "password")?,
            }
        },
        "direction": "send",
        "assets": {
            "destination_root": config.param_str("server", "folder_upload")?,
            "paths": []
        }
    });
    config.add_files_to_ts("assets.paths", &mut transfer_spec)?;
    transfer_client
        .start_transfer_and_wait(&transfer_spec)
        .await?;
    Ok(())
}
