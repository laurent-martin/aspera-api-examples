// Simplified REST API call class
package utils

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

const (
	JWT_CLIENT_SERVER_OFFSET_SEC = 60
	JWT_VALIDITY_SEC             = 600
	MIME_JSON                    = "application/json"
	MIME_WWW                     = "application/x-www-form-urlencoded"
)

// Rest is a simple REST client, with Basic or OAuth 2 JWT Bearer authentication.
type Rest struct {
	BaseURL  string
	Verify   bool
	Headers  map[string]string
	AuthData map[string]string
}

// NewRest creates a REST client.
//
// Parameters:
//   - url: base URL of the API
//
// Returns: REST client
func NewRest(url string) *Rest {
	return &Rest{
		BaseURL:  url,
		Verify:   true,
		Headers:  map[string]string{},
		AuthData: map[string]string{},
	}
}

// SetVerify enables or disables the verification of the server certificate.
//
// Parameters:
//   - verify: false for development servers with a self-signed certificate
func (r *Rest) SetVerify(verify bool) {
	r.Verify = verify
}

// SetHeaders adds headers to all subsequent requests.
//
// Parameters:
//   - headers: header names and values
func (r *Rest) SetHeaders(headers map[string]string) {
	for k, v := range headers {
		r.Headers[k] = v
	}
}

// SetBasic uses Basic authentication.
//
// Parameters:
//   - user: user name
//   - pass: password
func (r *Rest) SetBasic(user, pass string) {
	r.Headers["Authorization"] = "Basic " + basicAuthHeader(user, pass)
}

// basicAuthHeader creates the credentials of an HTTP Basic Authorization header.
//
// Parameters:
//   - user: user name
//   - pass: password
//
// Returns: credentials in base64
func basicAuthHeader(user, pass string) string {
	auth := user + ":" + pass
	return base64.StdEncoding.EncodeToString([]byte(auth))
}

// SetDefaultScope generates a bearer token, and uses it for all subsequent requests.
//
// A new token is generated for each execution of the sample.
// In real code, the token should be reused until it expires.
//
// Parameters:
//   - scope: OAuth scope of the token, or empty
func (r *Rest) SetDefaultScope(scope string) error {
	bearer, err := r.getBearer(scope)
	if err != nil {
		return err
	}
	r.Headers["Authorization"] = bearer
	return nil
}

// SetBearer uses OAuth 2 Bearer authentication, with a JWT signed with a private key.
//
// Parameters:
//   - bearerData: `token_url`, `key_pem_path`, `client_id`, `client_secret`, `iss`, `aud`, `sub`, and optionally `org`
func (r *Rest) SetBearer(bearerData map[string]string) {
	r.AuthData = bearerData
}

// getBearer generates a bearer token, with the JWT Bearer grant.
//
// Parameters:
//   - scope: OAuth scope of the token, or empty
//
// Returns: value of the Authorization header: `Bearer <token>`
func (r *Rest) getBearer(scope string) (string, error) {
	privateKeyPem, err := os.ReadFile(r.AuthData["key_pem_path"])
	if err != nil {
		return "", err
	}

	secondsSinceEpoch := time.Now().Unix()

	jwtPayload := jwt.MapClaims{
		"iss": r.AuthData["iss"],
		"sub": r.AuthData["sub"],
		"aud": r.AuthData["aud"],
		"nbf": secondsSinceEpoch - JWT_CLIENT_SERVER_OFFSET_SEC,
		"exp": secondsSinceEpoch + JWT_VALIDITY_SEC,
		"iat": secondsSinceEpoch - JWT_CLIENT_SERVER_OFFSET_SEC,
		"jti": uuid.NewString(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwtPayload)
	signKey, err := jwt.ParseRSAPrivateKeyFromPEM(privateKeyPem)
	if err != nil {
		return "", err
	}
	signedToken, err := token.SignedString(signKey)
	if err != nil {
		return "", err
	}

	data := map[string]string{
		"client_id":  r.AuthData["client_id"],
		"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
		"assertion":  signedToken,
	}
	if scope != "" {
		data["scope"] = scope
	}
	auth_api := NewRest(r.AuthData["token_url"])
	//auth_api := NewRest("http://localhost:12345")
	auth_api.SetVerify(r.Verify)
	auth_api.SetHeaders(map[string]string{
		"Content-Type": MIME_WWW,
	})
	auth_api.SetBasic(r.AuthData["client_id"], r.AuthData["client_secret"])
	responseData, err := auth_api.Create("", data)
	if err != nil {
		return "", err
	}
	accessToken, ok := responseData["access_token"].(string)
	if !ok {
		return "", errors.New("No access_token in token response")
	}
	return fmt.Sprintf("Bearer %s", accessToken), nil
}

// Call calls the API: sends a request, and gets the response data.
// Request and response bodies are logged.
//
// Parameters:
//   - method: HTTP method
//   - endpoint: path of the endpoint, relative to the base URL
//   - body: request data, sent in JSON
//   - query: query parameters
//
// Returns: response data, or nil if the response is empty
func (r *Rest) Call(
	method string,
	endpoint string,
	body interface{},
	query map[string]string,
) (map[string]interface{}, error) {
	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	// Marshal the body if body is provided
	var bodyBytes []byte
	var err error
	if body != nil {
		if r.Headers["Content-Type"] == MIME_WWW {
			values := url.Values{}
			for key, value := range body.(map[string]string) {
				values.Set(key, value)
			}
			bodyBytes = []byte(values.Encode())
		} else {
			bodyBytes, err = json.Marshal(body)
			if err != nil {
				return nil, err
			}
		}
	}

	fullURL := r.BaseURL
	if endpoint != "" {
		fullURL = fmt.Sprintf("%s/%s", fullURL, endpoint)
	}
	req, err := http.NewRequest(method, fullURL, bytes.NewBuffer(bodyBytes))
	if err != nil {
		return nil, err
	}

	// Set headers
	req.Header.Set("Accept", MIME_JSON)
	if method != http.MethodGet {
		req.Header.Set("Content-Type", MIME_JSON)
	}
	for k, v := range r.Headers {
		req.Header.Set(k, v)
	}

	// Add query parameters for GET requests
	if query != nil && method == http.MethodGet {
		q := req.URL.Query()
		for k, v := range query {
			q.Add(k, v)
		}
		req.URL.RawQuery = q.Encode()
	}

	// Send the request
	logger.Debugf("HTTP %s %s", method, fullURL)
	if len(bodyBytes) != 0 {
		LogDump("Request body", string(bodyBytes))
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	bodyResp, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d for %s %s: %s", resp.StatusCode, method, fullURL, bodyResp)
	}

	// If there's no content to return, avoid trying to parse it
	if len(bodyResp) == 0 {
		return nil, nil
	}
	LogDump("Response body", string(bodyResp))

	var result map[string]interface{}
	if err := json.Unmarshal(bodyResp, &result); err != nil {
		return nil, err
	}

	return result, nil
}

// Create creates a resource (HTTP POST).
//
// Parameters:
//   - endpoint: path of the endpoint, relative to the base URL
//   - data: request data, sent in JSON
//
// Returns: response data
func (r *Rest) Create(endpoint string, data interface{}) (map[string]interface{}, error) {
	return r.Call(http.MethodPost, endpoint, data, nil)
}

// Read reads a resource (HTTP GET).
//
// Parameters:
//   - endpoint: path of the endpoint, relative to the base URL
//   - params: query parameters
//
// Returns: response data
func (r *Rest) Read(endpoint string, params map[string]string) (map[string]interface{}, error) {
	return r.Call(http.MethodGet, endpoint, nil, params)
}

// Update updates a resource (HTTP PUT).
//
// Parameters:
//   - endpoint: path of the endpoint, relative to the base URL
//   - data: request data, sent in JSON
func (r *Rest) Update(endpoint string, data interface{}) error {
	_, err := r.Call(http.MethodPut, endpoint, data, nil)
	return err
}

// Delete deletes a resource (HTTP DELETE).
//
// Parameters:
//   - endpoint: path of the endpoint, relative to the base URL
//
// Returns: response data
func (r *Rest) Delete(endpoint string) (map[string]interface{}, error) {
	return r.Call(http.MethodDelete, endpoint, nil, nil)
}
