use samples::utils::configuration::Configuration;
use samples::utils::rest;
use samples::utils::transfer_client::TransferClient;
use serde_json::json;
use serde_json::Value;
use std::error::Error;
use std::sync::Arc;

const F5_API_PATH_V5: &str = "/api/v5";
const F5_API_PATH_TOKEN: &str = "/auth/token";

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    // config file parameters for sample code
    let config = Arc::new(Configuration::new()?);
    // simplified transfer client
    let mut transfer_client: TransferClient = TransferClient::new(Arc::clone(&config));
    // Faspex 5 API
    let faspex_base_url = config.param_str("faspex5", "url")?;
    let mut f5_api = rest::Rest::new(
        &format!("{faspex_base_url}{F5_API_PATH_V5}"),
        config.param_bool("faspex5", "verify")?,
    )?;
    f5_api.set_bearer(rest::BearerData {
        token_url: format!("{faspex_base_url}{F5_API_PATH_TOKEN}"),
        key_pem_path: config.param_str("faspex5", "private_key")?,
        client_id: config.param_str("faspex5", "client_id")?,
        client_secret: config.param_str("faspex5", "client_secret")?,
        iss: config.param_str("faspex5", "client_id")?,
        aud: config.param_str("faspex5", "client_id")?,
        sub: format!("user:{}", config.param_str("faspex5", "username")?),
        org: None,
    });
    f5_api.set_default_scope(None).await?;
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
    let mut transfer_spec: Value = f5_api
        .create(
            &format!("packages/{package_id}/transfer_spec/upload"),
            &upload_request,
            Some(&[("transfer_type", "connect")]),
        )
        .await?;
    // remove key "authentication" from transfer spec
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
