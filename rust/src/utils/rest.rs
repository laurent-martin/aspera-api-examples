use serde_json::Value;
use std::error::Error;
use std::time::{SystemTime, UNIX_EPOCH};

pub const MIME_JSON: &str = "application/json";
pub const MIME_FORM: &str = "application/x-www-form-urlencoded";
pub const IETF_GRANT_JWT: &str = "urn:ietf:params:oauth:grant-type:jwt-bearer";

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
pub fn generate_assertion(
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
pub async fn get_bearer_token(
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
            ("grant_type", IETF_GRANT_JWT),
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
