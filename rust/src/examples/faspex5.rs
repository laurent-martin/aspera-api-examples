use rust::utils::configuration::Configuration;
use rust::utils::rest;
use rust::utils::transfer_client::TransferClient;
use serde_json::json;
use serde_json::Value;
use std::error::Error;
use std::sync::Arc;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let config = Arc::new(Configuration::new()?);
    let mut transfer_client: TransferClient = TransferClient::new(Arc::clone(&config));
    let faspex_base_url = config.param_str("faspex5", "url")?;
    let api_base_url = format!("{faspex_base_url}/api/v5");
    let token_url = format!("{faspex_base_url}/auth/token");
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(!config.param_bool("faspex5", "verify")?)
        .build()?;
    let token = rest::get_bearer_token(
        &client,
        &token_url,
        &config.param_str("faspex5", "client_id")?,
        &config.param_str("faspex5", "username")?,
        &config.param_str("faspex5", "private_key")?,
    )
    .await?;
    // Create package
    let res: Value = client
        .post(&format!("{api_base_url}/packages"))
        .header("Content-Type", rest::MIME_JSON)
        .header("Authorization", format!("Bearer {token}"))
        .json(&json!({
            "title": "test title",
            "recipients": [{
                "name": config.param_str("faspex5", "username")?
            }]
        }))
        .send()
        .await?
        .json()
        .await?;
    log::info!("Package created: {:?}", res);
    let package_id = res["id"].as_str().unwrap();
    // Create transfer spec and upload files
    let mut upload_request = json!({});
    config.add_files_to_ts("paths", &mut upload_request)?;
    let transfer_spec_res: Value = client
        .post(&format!(
            "{api_base_url}/packages/{package_id}/transfer_spec/upload"
        ))
        .header("Content-Type", rest::MIME_JSON)
        .header("Authorization", format!("Bearer {token}"))
        .query(&[("transfer_type", "connect")])
        .json(&upload_request)
        .send()
        .await?
        .json()
        .await?;
    let mut transfer_spec = transfer_spec_res.clone();
    transfer_spec
        .as_object_mut()
        .unwrap()
        .remove("authentication");
    config.add_files_to_ts("paths", &mut transfer_spec)?;
    transfer_client
        .transfer_start_and_wait(&transfer_spec)
        .await?;
    Ok(())
}
