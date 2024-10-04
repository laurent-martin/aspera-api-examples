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
    let mut f5_api = rest::Client::new(
        &format!("{faspex_base_url}/api/v5"),
        config.param_bool("faspex5", "verify")?,
    )?;
    f5_api
        .auth_jwt(
            &format!("{faspex_base_url}/auth/token"),
            &config.param_str("faspex5", "client_id")?,
            &config.param_str("faspex5", "username")?,
            &config.param_str("faspex5", "private_key")?,
        )
        .await?;
    // Create package
    let res: Value = f5_api
        .create(
            "packages",
            &json!({
                "title": "test title",
                "recipients": [{
                    "name": config.param_str("faspex5", "username")?
                }]
            }),
            None,
        )
        .await?;
    log::info!("Package created: {:?}", res);
    let package_id = res["id"].as_str().unwrap();
    // Create transfer spec
    let mut upload_request = json!({});
    config.add_files_to_ts("paths", &mut upload_request)?;
    let transfer_spec_res: Value = f5_api
        .create(
            &format!("packages/{package_id}/transfer_spec/upload"),
            &upload_request,
            Some(&[("transfer_type", "connect")]),
        )
        .await?;
    let mut transfer_spec = transfer_spec_res.clone();
    transfer_spec
        .as_object_mut()
        .unwrap()
        .remove("authentication");
    config.add_files_to_ts("paths", &mut transfer_spec)?;
    // upload files to package
    transfer_client
        .transfer_start_and_wait(&transfer_spec)
        .await?;
    Ok(())
}
