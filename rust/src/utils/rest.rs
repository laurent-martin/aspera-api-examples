use serde_json::Value;
use std::error::Error;
use std::time::{SystemTime, UNIX_EPOCH};
use tonic::client;

pub const MIME_JSON: &str = "application/json";
pub const MIME_FORM: &str = "application/x-www-form-urlencoded";
pub const IETF_GRANT_JWT: &str = "urn:ietf:params:oauth:grant-type:jwt-bearer";

const JWT_NOT_BEFORE_OFFSET_SEC: usize = 60;
// take some validity for the JWT
const JWT_EXPIRY_OFFSET_SEC: usize = 600;

pub struct Client {
    base_url: String,
    auth: Option<String>,
    client: reqwest::Client,
}
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

impl Client {
    pub fn new(base_url: &str, verify: bool) -> Result<Self, Box<dyn Error>> {
        let mut client_builder = reqwest::Client::builder();
        if !verify {
            client_builder = client_builder.danger_accept_invalid_certs(true);
        }
        let client = client_builder.build()?;
        Ok(Self {
            base_url: base_url.to_string(),
            auth: None,
            client: client,
        })
    }
    pub async fn auth_jwt(
        &mut self,
        token_url: &str,
        client_id: &str,
        username: &str,
        private_key: &str,
    ) -> Result<(), Box<dyn Error>> {
        let token =
            get_bearer_token(&self.client, &token_url, client_id, username, private_key).await?;
        self.auth = Some(format!("Bearer {token}"));
        Ok(())
    }
    pub async fn create(
        &self,
        path: &str,
        value: &Value,
        query: Option<&[(&str, &str)]>,
    ) -> Result<Value, Box<dyn Error>> {
        let mut request_builder: reqwest::RequestBuilder = self
            .client
            .post(&format!("{}/{path}", self.base_url))
            .header("Content-Type", MIME_JSON)
            .header("Accept", MIME_JSON);
        if let Some(auth) = &self.auth {
            request_builder = request_builder.header("Authorization", auth);
        }
        if let Some(query) = query {
            request_builder = request_builder.query(query);
        }
        let response: Value = request_builder.json(value).send().await?.json().await?;
        Ok(response)
    }
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
        sub: format!("user:{username}"),
        aud: client_id.to_owned(),
        iat: now - JWT_NOT_BEFORE_OFFSET_SEC,
        nbf: now - JWT_NOT_BEFORE_OFFSET_SEC,
        exp: now + JWT_EXPIRY_OFFSET_SEC,
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
