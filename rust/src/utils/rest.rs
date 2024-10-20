// cspell:ignore reqwest jsonwebtoken
use serde_json::Value;
use std::collections::HashMap;
use std::error::Error;
use std::time::{SystemTime, UNIX_EPOCH};

pub const MIME_JSON: &str = "application/json";
pub const MIME_FORM: &str = "application/x-www-form-urlencoded";
pub const IETF_GRANT_JWT: &str = "urn:ietf:params:oauth:grant-type:jwt-bearer";

// Offset allowed between client and server
const JWT_NOT_BEFORE_OFFSET_SEC: usize = 60;
// Validity period for JW Token
const JWT_EXPIRY_OFFSET_SEC: usize = 600;

#[derive(Clone)]
pub struct BearerData {
    pub token_url: String,
    pub aud: String,
    pub client_id: String,
    pub client_secret: String,
    pub key_pem_path: String,
    pub iss: String,
    pub sub: String,
    pub add: Option<String>,
}
pub struct BasicData {
    pub username: String,
    pub password: String,
}
pub enum AuthData {
    Bearer(BearerData),
    Basic(BasicData),
    None,
}

pub struct Rest {
    base_url: String,
    auth: AuthData,
    headers: HashMap<String, String>,
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

impl Rest {
    pub fn new(base_url: &str, verify: bool) -> Result<Self, Box<dyn Error>> {
        let mut client_builder = reqwest::Client::builder();
        if !verify {
            client_builder = client_builder.danger_accept_invalid_certs(true);
        }
        Ok(Self {
            base_url: base_url.to_string(),
            auth: AuthData::None,
            headers: HashMap::new(),
            client: client_builder.build()?,
        })
    }
    pub fn set_basic(&mut self, username: &str, password: &str) {
        self.auth = AuthData::Basic(BasicData {
            username: username.to_owned(),
            password: password.to_owned(),
        });
    }
    /// API is authenticated using a bearer token.
    ///
    /// ### Arguments
    /// * `auth_data` - Information for JWT generation
    pub fn set_bearer(&mut self, auth_data: BearerData) {
        self.auth = AuthData::Bearer(auth_data);
    }

    /// Set the default scope for the bearer token and update the headers
    ///
    /// ### Arguments
    /// * `scope` - The scope to set
    pub async fn set_default_scope(&mut self, scope: Option<String>) -> Result<(), Box<dyn Error>> {
        let token = self.get_bearer_token(scope).await?;
        self.headers.insert("Authorization".to_string(), token);
        Ok(())
    }

    /// Get a bearer token from the server
    ///
    /// ### Arguments
    /// * `scope` - The scope to set
    pub async fn get_bearer_token(
        &mut self,
        scope: Option<String>,
    ) -> Result<String, Box<dyn Error>> {
        let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs() as usize;
        // get copy of self.auth as BearerData, else return error
        let auth = match &self.auth {
            AuthData::Bearer(auth) => auth.clone(),
            _ => return Err(anyhow::anyhow!("Bearer").into()),
        };
        let claims = Claims {
            iss: auth.client_id.to_owned(),
            sub: auth.sub.to_owned(),
            aud: auth.client_id.to_owned(),
            iat: now - JWT_NOT_BEFORE_OFFSET_SEC,
            nbf: now - JWT_NOT_BEFORE_OFFSET_SEC,
            exp: now + JWT_EXPIRY_OFFSET_SEC,
            jti: uuid::Uuid::new_v4().to_string(),
        };
        let private_key = std::fs::read_to_string(auth.key_pem_path)?;
        let assertion = jsonwebtoken::encode(
            &jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256),
            &claims,
            &jsonwebtoken::EncodingKey::from_rsa_pem(private_key.as_bytes())?,
        )?;
        let mut data = vec![
            ("grant_type", IETF_GRANT_JWT.to_string()),
            ("client_id", auth.client_id.to_owned()),
            ("assertion", assertion),
        ];
        if let Some(scope) = scope {
            data.push(("scope", scope));
        }
        // debug data
        log::debug!("Bearer data: {:?}", data);
        let response = self
            .client
            .post(auth.token_url)
            .basic_auth(
                auth.client_id.to_owned(),
                Some(auth.client_secret.to_owned()),
            )
            .header("Accept", MIME_JSON)
            .header("Content-Type", MIME_FORM)
            .form(&data)
            .send()
            .await?;
        // check response error
        if !response.status().is_success() {
            return Err(
                anyhow::anyhow!("Failed to get access token: {}", response.status()).into(),
            );
        }
        let jdata: Value = response.json().await?;
        let token = jdata["access_token"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("Failed to get access token from response"))?;
        Ok(token.to_string())
    }

    /// CRUD: Create
    ///
    /// ### Arguments
    /// * `path` - The path to the API endpoint
    /// * `value` - The JSON value to send
    /// * `query` - Optional query parameters
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
        // loop on headers and add them to the request
        for (key, value) in &self.headers {
            request_builder = request_builder.header(key, value);
        }
        if let Some(query) = query {
            request_builder = request_builder.query(query);
        }
        // add basic if here
        if let AuthData::Basic(data) = &self.auth {
            request_builder = request_builder.basic_auth(&data.username, Some(&data.password));
        }
        let response = request_builder.json(value).send().await?;
        // check http code and transform to error
        if !response.status().is_success() {
            return Err(anyhow::anyhow!("Failed to create: {}", response.status()).into());
        }
        Ok(response.json().await?)
    }
}
