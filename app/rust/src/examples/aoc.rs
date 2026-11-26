// Aspera on Cloud
// Send a package to shared inbox (name in config file) in given workspace (name in config file)
use log::info;
use samples::utils::configuration::Configuration;
use samples::utils::rest;
use samples::utils::transfer_client::TransferClient;
use serde_json::{Value, json};
use std::error::Error;
use std::sync::Arc;

// AoC API base URL: https://developer.ibm.com/apis/catalog?search=%22aspera%20on%20cloud%20api%22
const AOC_API_V1_BASE_URL: &str = "https://api.ibmaspera.com/api/v1";
const AOC_OAUTH_AUDIENCE: &str = "https://api.asperafiles.com/api/v1/oauth2/token";

// name of package to send
const PACKAGE_NAME: &str = "sample package Rust";

// number of parallel transfer sessions (typically, 1)
const TRANSFER_SESSIONS: u32 = 1;

/// Encode a string in base64.
///
/// # Arguments
/// * `clear_string` - string to encode
///
/// # Returns
/// Base64 string
fn base64_encode(clear_string: &str) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut encoded = String::new();
    // each group of 3 bytes (24 bits) gives 4 characters (6 bits each), the last group is padded with `=`
    for chunk in clear_string.as_bytes().chunks(3) {
        let bits = chunk
            .iter()
            .enumerate()
            .fold(0u32, |bits, (index, byte)| bits | (u32::from(*byte) << (16 - 8 * index)));
        for index in 0..4 {
            if index <= chunk.len() {
                encoded.push(char::from(ALPHABET[((bits >> (18 - 6 * index)) & 0x3F) as usize]));
            } else {
                encoded.push('=');
            }
        }
    }
    encoded
}

/// Get a string attribute of a JSON object.
///
/// # Arguments
/// * `dict` - JSON object
/// * `key` - name of the attribute
///
/// # Returns
/// Value of the attribute
fn attribute_str<'a>(dict: &'a Value, key: &str) -> Result<&'a str, Box<dyn Error>> {
    dict[key]
        .as_str()
        .ok_or_else(|| format!("Missing attribute: {key}").into())
}

/// Generate the transfer cookie of AoC, that identifies the application and the user.
///
/// # Arguments
/// * `app` - AoC application, e.g. `packages`
/// * `user_name` - name of the user
/// * `user_id` - identifier of the user: email
///
/// # Returns
/// Cookie
fn generate_cookie(app: &str, user_name: &str, user_id: &str) -> String {
    format!(
        "aspera.aoc:{}:{}:{}",
        base64_encode(app),
        base64_encode(user_name),
        base64_encode(user_id)
    )
}

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

    // Get my user information (get my name, etc...)
    info!("Getting user information");
    let user_info = aoc_api.read("self", None).await?;

    // Get workspace information
    let workspace_name = config.param_str("aoc", "workspace")?;
    info!("Getting workspace: {workspace_name}");
    let workspace_response = aoc_api
        .read("workspaces", Some(&[("q", &workspace_name)]))
        .await?;
    let workspace_list = workspace_response
        .as_array()
        .ok_or("Workspaces: expected a list")?;
    if workspace_list.len() != 1 {
        return Err(format!("Found {} workspaces for {workspace_name}", workspace_list.len()).into());
    }
    let workspace_info = &workspace_list[0];
    let workspace_id = attribute_str(workspace_info, "id")?;

    // Get shared inbox (dropbox) information
    let shared_inbox_name = config.param_str("aoc", "shared_inbox")?;
    info!("Getting shared inbox: {shared_inbox_name}");
    let dropbox_response = aoc_api
        .read(
            "dropboxes",
            Some(&[
                ("current_workspace_id", workspace_id),
                ("q", &shared_inbox_name),
            ]),
        )
        .await?;
    let dropbox_list = dropbox_response
        .as_array()
        .ok_or("Shared inboxes: expected a list")?;
    if dropbox_list.len() != 1 {
        return Err(format!("Found {} shared inboxes for {shared_inbox_name}", dropbox_list.len()).into());
    }
    let dropbox_info = &dropbox_list[0];

    // Create a new package (this allocates a reception folder on package storage)
    // `sent` and `transfers_expected` could also be added on a later call with PUT packages/{id}
    info!("Creating package");
    let package_info = aoc_api
        .create(
            "packages",
            &json!({
                "workspace_id": workspace_id,
                "recipients": [{ "id": dropbox_info["id"], "type": "dropbox" }],
                "name": PACKAGE_NAME,
                "note": "My package note",
                "sent": true,
                "transfers_expected": TRANSFER_SESSIONS
            }),
            None,
        )
        .await?;

    // Get node information for the node on which package was created
    info!("Getting node information");
    let node_id = attribute_str(&package_info, "node_id")?;
    let node_info = aoc_api.read(&format!("nodes/{node_id}"), None).await?;
    let access_key = attribute_str(&node_info, "access_key")?;

    // Generate a bearer token for the node on which package was created
    // Tags of the transfer spec:
    // - `node`: mandatory, HSTS authorizes the bearer token for this access key and folder
    // - `app`, `files`: mandatory, AoC links the transfer to the package
    // - `usage_id`, `xfer_retry`: optional
    let mut transfer_spec = json!({
        "direction": "send",
        "token": aoc_api.get_bearer_token(Some(format!("node.{access_key}:user:all"))).await?,
        "tags": {
            "aspera": {
                "app": "packages",
                "files": {
                    "node_id": node_info["id"],
                    "package_id": package_info["id"],
                    "package_name": package_info["name"],
                    "package_operation": "upload",
                    "files_transfer_action": "upload_package",
                    "workspace_name": workspace_info["name"],
                    "workspace_id": workspace_id
                },
                "node": {
                    "access_key": access_key,
                    "file_id": package_info["contents_file_id"]
                },
                "usage_id": format!("aspera.files.workspace.{workspace_id}"),
                "xfer_retry": 3600
            }
        },
        "remote_host": node_info["host"],
        "remote_user": "xfer",
        "ssh_port": 33001,
        "fasp_port": 33001,
        "cookie": generate_cookie(
            "packages",
            attribute_str(&user_info, "name")?,
            attribute_str(&user_info, "email")?
        ),
        "create_dir": true,
        "target_rate_kbps": 100000,
        "paths": []
    });

    if TRANSFER_SESSIONS != 1 {
        transfer_spec["multi_session"] = json!(TRANSFER_SESSIONS);
        transfer_spec["multi_session_threshold"] = json!(500000);
    }

    // Add files to transfer spec
    config.add_files_to_ts("paths", &mut transfer_spec)?;

    // Upload files to package folder on server
    info!("Uploading files");
    transfer_client
        .transfer_start_and_wait(&transfer_spec)
        .await?;

    Ok(())
}
