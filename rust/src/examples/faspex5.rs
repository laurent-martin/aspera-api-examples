use rust::utils::configuration::Configuration;
use rust::utils::transfer_client::TransferClient;
use serde_json::json;
use serde_json::Value;
use std::error::Error;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

const MIME_JSON: &str = "application/json";
const MIME_FORM: &str = "application/x-www-form-urlencoded";

// JWT Claims structure
#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct Claims {
    iss: String,
    aud: String,
    sub: String,
    exp: usize,
    nbf: usize,
    iat: usize,
    jti: String,
}

// Generate JWT assertion
fn generate_assertion(
    client_id: &str,
    username: &str,
    private_key: &str,
) -> Result<String, Box<dyn Error>> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs() as usize;
    let claims = Claims {
        iss: client_id.to_owned(),
        aud: client_id.to_owned(),
        sub: format!("user:{username}"),
        exp: now + 600,
        nbf: now - 60,
        iat: now - 60,
        jti: uuid::Uuid::new_v4().to_string(),
    };

    let private_key = std::fs::read_to_string(private_key)?;
    let token = jsonwebtoken::encode(
        &jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256),
        &claims,
        &jsonwebtoken::EncodingKey::from_rsa_pem(private_key.as_bytes())?,
    )?;
    Ok(token)
}

// Call Faspex 5 auth API and generate bearer token
async fn get_bearer_token(
    client: &reqwest::Client,
    token_url: &str,
    client_id: &str,
    username: &str,
    private_key: &str,
) -> Result<String, Box<dyn Error>> {
    let assertion = generate_assertion(client_id, username, private_key)?;
    let response: Value = client
        .post(token_url)
        .header("Accept", MIME_JSON)
        .header("Content-Type", MIME_FORM)
        .form(&[
            ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
            ("client_id", client_id),
            ("assertion", &assertion),
        ])
        .send()
        .await?
        .json()
        .await?;
    let token = response["access_token"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("Failed to get access token from response"))?;
    Ok(token.to_string())
}

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
    let token = get_bearer_token(
        &client,
        &token_url,
        &config.param_str("faspex5", "client_id")?,
        &config.param_str("faspex5", "username")?,
        &config.param_str("faspex5", "private_key")?,
    )
    .await?;
    // Create package
    let package_create_params = json!({
        "title": "test title",
        "recipients": [{
            "name": config.param_str("faspex5", "username")?
        }]
    });
    let res: Value = client
        .post(&format!("{api_base_url}/packages"))
        .header("Content-Type", MIME_JSON)
        .header("Authorization", format!("Bearer {token}"))
        .json(&package_create_params)
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
        .header("Content-Type", MIME_JSON)
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
