// cspell:ignore reqwest jsonwebtoken
use super::configuration::log_dump;
use log::Level::Debug;
use serde_json::Value;
use std::collections::HashMap;
use std::error::Error;
use std::time::{SystemTime, UNIX_EPOCH};

// Offset allowed between client and server
const JWT_CLIENT_SERVER_OFFSET_SEC: usize = 60;
// Validity period for JW Token
const JWT_VALIDITY_SEC: usize = 600;
const MIME_JSON: &str = "application/json";
const MIME_WWW: &str = "application/x-www-form-urlencoded";
const IETF_GRANT_JWT: &str = "urn:ietf:params:oauth:grant-type:jwt-bearer";


/// Parameters of OAuth 2 Bearer authentication, with a JWT signed with a private key.
#[derive(Clone)]
pub struct BearerData {
    pub token_url: String,
    pub key_pem_path: String,
    pub client_id: String,
    pub client_secret: String,
    pub iss: String,
    pub aud: String,
    pub sub: String,
    pub org: Option<String>,
}
/// Parameters of Basic authentication.
pub struct BasicData {
    pub username: String,
    pub password: String,
}
/// Authentication of the REST client.
pub enum AuthData {
    Bearer(BearerData),
    Basic(BasicData),
    None,
}
/// Claims of the JWT.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct Claims {
    iss: String,
    aud: String,
    sub: String,
    exp: usize,
    nbf: usize,
    iat: usize,
    jti: String,
    org: Option<String>,
}
/// Simple REST client, with Basic or OAuth 2 JWT Bearer authentication.
pub struct Rest {
    base_url: String,
    auth: AuthData,
    headers: HashMap<String, String>,
    client: reqwest::Client,
}
impl Rest {
    /// Create a REST client.
    ///
    /// # Arguments
    /// * `url` - base URL of the API
    /// * `verify` - false for development servers with a self-signed certificate
    ///
    /// # Returns
    /// REST client
    pub fn new(url: &str, verify: bool) -> Result<Self, Box<dyn Error>> {
        let mut client_builder = reqwest::Client::builder();
        if !verify {
            client_builder = client_builder.danger_accept_invalid_certs(true);
        }
        Ok(Self {
            base_url: url.to_string(),
            auth: AuthData::None,
            headers: HashMap::new(),
            client: client_builder.build()?,
        })
    }
    /// Use Basic authentication.
    ///
    /// # Arguments
    /// * `username` - user name
    /// * `password` - password
    pub fn set_basic(&mut self, username: &str, password: &str) {
        self.auth = AuthData::Basic(BasicData {
            username: username.to_owned(),
            password: password.to_owned(),
        });
    }
    /// Use OAuth 2 Bearer authentication, with a JWT signed with a private key.
    ///
    /// # Arguments
    /// * `auth_data` - parameters of Bearer authentication
    pub fn set_bearer(&mut self, auth_data: BearerData) {
        self.auth = AuthData::Bearer(auth_data);
    }

    /// Generate a bearer token, and use it for all subsequent requests.
    ///
    /// A new token is generated for each execution of the sample.
    /// In real code, the token should be reused until it expires.
    ///
    /// # Arguments
    /// * `scope` - OAuth scope of the token, or none
    pub async fn set_default_scope(&mut self, scope: Option<String>) -> Result<(), Box<dyn Error>> {
        let token = self.get_bearer_token(scope).await?;
        self.headers.insert("Authorization".to_string(), token);
        Ok(())
    }

    /// Generate a bearer token, with the JWT Bearer grant.
    ///
    /// # Arguments
    /// * `scope` - OAuth scope of the token, or none
    ///
    /// # Returns
    /// Value of the Authorization header: `Bearer <token>`
    pub async fn get_bearer_token(
        &mut self,
        scope: Option<String>,
    ) -> Result<String, Box<dyn Error>> {
        let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs() as usize;
        // get copy of self.auth as BearerData, else return error
        let auth = match &self.auth {
            AuthData::Bearer(auth) => auth.clone(),
            _ => return Err("Auth data not set".into()),
        };
        let claims = Claims {
            iss: auth.iss.to_owned(),
            sub: auth.sub.to_owned(),
            aud: auth.aud.to_owned(),
            iat: now - JWT_CLIENT_SERVER_OFFSET_SEC,
            nbf: now - JWT_CLIENT_SERVER_OFFSET_SEC,
            exp: now + JWT_VALIDITY_SEC,
            jti: uuid::Uuid::new_v4().to_string(),
            org: auth.org.to_owned(),
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
        let request_builder = self
            .client
            .post(auth.token_url) // "http://localhost:12345")//
            .basic_auth(
                auth.client_id.to_owned(),
                Some(auth.client_secret.to_owned()),
            )
            .header("Accept", MIME_JSON)
            .header("Content-Type", MIME_WWW)
            .form(&data);
        let jdata: Value = serde_json::from_str(&self.send(request_builder).await?)?;
        let token = jdata["access_token"]
            .as_str()
            .ok_or("No access_token in token response")?;
        Ok(format!("Bearer {token}"))
    }

    /// Call the API: send a request, and get the response data.
    ///
    /// # Arguments
    /// * `method` - HTTP method
    /// * `endpoint` - path of the endpoint, relative to the base URL
    /// * `body` - request data, sent in JSON
    /// * `query` - query parameters
    ///
    /// # Returns
    /// Response data, or none if the response is empty
    pub async fn call(
        &self,
        method: reqwest::Method,
        endpoint: &str,
        body: Option<&Value>,
        query: Option<&[(&str, &str)]>,
    ) -> Result<Option<Value>, Box<dyn Error>> {
        let mut request_builder: reqwest::RequestBuilder = self
            .client
            .request(method, &format!("{}/{endpoint}", self.base_url))
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
        // add json body if present
        if let Some(value) = body {
            request_builder = request_builder.json(value);
        }
        let body = self.send(request_builder).await?;
        Ok(serde_json::from_str(&body).ok())
    }
    /// Send an HTTP request, log request and response bodies, and return an error on failure.
    ///
    /// # Arguments
    /// * `request_builder` - HTTP request
    ///
    /// # Returns
    /// Response body
    async fn send(&self, request_builder: reqwest::RequestBuilder) -> Result<String, Box<dyn Error>> {
        let request = request_builder.build()?;
        let method = request.method().clone();
        let mut url = request.url().clone();
        url.set_query(None);
        log::debug!("HTTP {method} {url}");
        if let Some(body) = request.body().and_then(|body| body.as_bytes()) {
            log_dump("Request body", String::from_utf8_lossy(body), Debug);
        }
        let response = self.client.execute(request).await?;
        let status = response.status();
        let body = response.text().await?;
        if !status.is_success() {
            return Err(format!("HTTP {} for {method} {url}: {body}", status.as_u16()).into());
        }
        if !body.is_empty() {
            log_dump("Response body", &body, Debug);
        }
        Ok(body)
    }
    /// Create a resource (HTTP POST).
    ///
    /// # Arguments
    /// * `endpoint` - path of the endpoint, relative to the base URL
    /// * `value` - request data, sent in JSON
    /// * `query` - query parameters
    ///
    /// # Returns
    /// Response data
    pub async fn create(
        &self,
        endpoint: &str,
        value: &Value,
        query: Option<&[(&str, &str)]>,
    ) -> Result<Value, Box<dyn Error>> {
        Ok(self
            .call(reqwest::Method::POST, endpoint, Some(value), query)
            .await?
            .unwrap())
    }
    /// Read a resource (HTTP GET).
    ///
    /// # Arguments
    /// * `endpoint` - path of the endpoint, relative to the base URL
    /// * `query` - query parameters
    ///
    /// # Returns
    /// Response data
    pub async fn read(
        &self,
        endpoint: &str,
        query: Option<&[(&str, &str)]>,
    ) -> Result<Value, Box<dyn Error>> {
        Ok(self
            .call(reqwest::Method::GET, endpoint, None, query)
            .await?
            .unwrap())
    }
    /// Update a resource (HTTP PUT).
    ///
    /// # Arguments
    /// * `endpoint` - path of the endpoint, relative to the base URL
    /// * `value` - request data, sent in JSON
    pub async fn update(&self, endpoint: &str, value: &Value) -> Result<(), Box<dyn Error>> {
        let _ = self
            .call(reqwest::Method::PUT, endpoint, Some(value), None)
            .await?;
        Ok(())
    }
    /// Delete a resource (HTTP DELETE).
    ///
    /// # Arguments
    /// * `endpoint` - path of the endpoint, relative to the base URL
    pub async fn delete(&self, endpoint: &str) -> Result<(), Box<dyn Error>> {
        let _ = self.call(reqwest::Method::DELETE, endpoint, None, None).await?;
        Ok(())
    }
}
