use log::info;
use samples::utils::configuration::Configuration;
use samples::utils::rest;
use samples::utils::transfer_client::TransferClient;
use serde_json::json;
use std::error::Error;
use std::sync::Arc;

const AOC_API_V1_BASE_URL: &str = "https://api.ibmaspera.com/api/v1";
const AOC_OAUTH_AUDIENCE: &str = "https://api.asperafiles.com/api/v1/oauth2/token";

/// Example showing access to Aspera on Cloud (AoC) API
#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    // Configuration and Transfer Client setup
    let config = Arc::new(Configuration::new()?);
    let mut transfer_client: TransferClient = TransferClient::new(Arc::clone(&config));

    // Initialize the AoC API REST client
    let mut aoc_api = rest::Rest::new(AOC_API_V1_BASE_URL, true)?;

    // Set Bearer token parameters for authentication using JWT
    aoc_api.set_bearer(rest::BearerData {
        token_url: format!(
            "{}/oauth2/{}/token",
            AOC_API_V1_BASE_URL,
            config.param_str("aoc", "org")?
        ),
        key_pem_path: config.param_str("aoc", "private_key")?,
        client_id: config.param_str("aoc", "client_id")?,
        client_secret: config.param_str("aoc", "client_secret")?,
        iss: config.param_str("aoc", "client_id")?,
        aud: AOC_OAUTH_AUDIENCE.to_string(),
        sub: config.param_str("aoc", "user_email")?,
        org: Some(config.param_str("aoc", "org")?),
    });
    // generate the bearer token
    aoc_api
        .set_default_scope(Some("user:all".to_string()))
        .await?;

    // Get workspace information
    let workspace_name = config.param_str("aoc", "workspace")?;
    info!("Getting workspace information for {}", workspace_name);

    let workspace_response = aoc_api
        .read("workspaces", Some(&[("q", &workspace_name)]))
        .await?;
    let workspace_list = workspace_response.as_array().unwrap();
    if workspace_list.len() != 1 {
        return Err(Box::from(format!(
            "Found {} workspaces for {}",
            workspace_list.len(),
            workspace_name
        )));
    }
    let workspace_info = &workspace_list[0];

    // Get shared inbox (dropbox) information
    let shared_inbox_name = config.param_str("aoc", "shared_inbox")?;
    info!("Getting shared inbox information");
    let dropbox_response = aoc_api
        .read(
            "dropboxes",
            Some(&[
                ("current_workspace_id", &workspace_info["id"].to_string()),
                ("q", &shared_inbox_name),
            ]),
        )
        .await?;
    let dropbox_list = dropbox_response.as_array().unwrap();
    if dropbox_list.len() != 1 {
        return Err(Box::from(format!(
            "Found {} dropboxes for {}",
            dropbox_list.len(),
            shared_inbox_name
        )));
    }
    let dropbox_info = &dropbox_list[0];

    // Create a new package
    info!("Creating package");
    let package_response = aoc_api
        .create(
            "packages",
            &json!({
                "workspace_id": workspace_info["id"],
                "recipients": [{ "id": dropbox_info["id"], "type": "dropbox" }],
                "name": "sample package",
                "note": "My package note"
            }),
            None,
        )
        .await?;
    let package_info = package_response.as_object().unwrap();
    info!("Package created: {:?}", package_info);

    // Get node information for the package
    let node_id = package_info["node_id"].as_str().unwrap();
    info!("Getting node information for {node_id}");
    let node_response = aoc_api.read(&format!("nodes/{node_id}"), None).await?;
    let node_info = node_response.as_object().unwrap();
    info!("Node information: {:?}", node_info);

    // Set expected transfers for the package
    info!("Setting expected transfers");
    aoc_api
        .update(
            &format!("packages/{}", package_info["id"].as_str().unwrap()),
            &json!({
                "sent": true,
                "transfers_expected": 1
            }),
        )
        .await?;

    info!("Creating Transfer spec");
    // Generate the transfer spec
    let mut transfer_spec = json!({
        "direction": "send",
        "token": aoc_api.get_bearer_token(Some(format!("node.{}:user:all", node_info["access_key"].as_str().unwrap()))).await?,
        "tags": {
            "aspera": {
                "app": "packages",
                "files": {
                    "node_id": node_info["id"].as_str().unwrap(),
                    "package_id": package_info["id"].as_str().unwrap(),
                    "package_name": package_info["name"].as_str().unwrap(),
                    "package_operation": "upload",
                    "files_transfer_action": "upload_package",
                    "workspace_name": workspace_info["name"].as_str().unwrap(),
                    "workspace_id": workspace_info["id"].as_str().unwrap()
                },
                "node": {
                    "access_key": node_info["access_key"].as_str().unwrap(),
                    "file_id": package_info["contents_file_id"].as_str().unwrap()
                },
                "usage_id": format!("aspera.files.workspace.{}", workspace_info["id"].as_str().unwrap()),
                "xfer_id": uuid::Uuid::new_v4().to_string(),
                "xfer_retry": 3600
            }
        },
        "remote_host": node_info["host"].as_str().unwrap(),
        "remote_user": "xfer",
        "ssh_port": 33001,
        "fasp_port": 33001,
        "create_dir": true,
        "target_rate_kbps": 100000,
        "paths": []
    });

    // Add files to transfer spec
    config.add_files_to_ts("paths", &mut transfer_spec)?;

    // Upload files to package folder on server
    transfer_client
        .transfer_start_and_wait(&transfer_spec)
        .await?;

    Ok(())
}
