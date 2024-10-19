package utils

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"time"

	"github.com/dgrijalva/jwt-go"
	"github.com/twinj/uuid"
)

const (
	JWTNotBeforeOffsetSec = 60
	JWTExpiryOffsetSec    = 600
	MIME_JSON             = "application/json"
	MIME_WWW              = "application/x-www-form-urlencoded"
)

// Rest is a client to interact with REST APIs
type Rest struct {
	BaseURL  string
	Verify   bool
	Headers  map[string]string
	AuthData map[string]string
}

// NewRest creates a new Rest client
func NewRest(baseURL string) *Rest {
	return &Rest{
		BaseURL:  baseURL,
		Verify:   true,
		Headers:  map[string]string{},
		AuthData: map[string]string{},
	}
}

func (r *Rest) SetVerify(verify bool) {
	r.Verify = verify
}
func (r *Rest) SetHeaders(headers map[string]string) {
	for k, v := range headers {
		r.Headers[k] = v
	}
}

// SetBasic sets the Authorization header with Basic Auth
func (r *Rest) SetBasic(user, pass string) {
	r.Headers["Authorization"] = "Basic " + basicAuthHeader(user, pass)
}

// Helper function to create Basic Auth header
func basicAuthHeader(user, pass string) string {
	auth := user + ":" + pass
	return base64.StdEncoding.EncodeToString([]byte(auth))
}

func (r *Rest) SetDefaultScope(scope string) {
	r.Headers["Authorization"] = r.getBearer(scope)
}

func (r *Rest) SetBearer(bearerData map[string]string) {
	r.AuthData = bearerData
	log.Printf("Bearer data: %v", r.AuthData)
}

func (r *Rest) getBearer(scope string) string {
	log.Println("Getting API authorization")
	log.Printf("Bearer data: %v", r.AuthData)
	privateKeyPem, err := os.ReadFile(r.AuthData["key_pem_path"])
	if err != nil {
		log.Fatalf("Failed to read private key: %v", err)
	}
	log.Printf("file content: %s", privateKeyPem)

	secondsSinceEpoch := time.Now().Unix()

	jwtPayload := jwt.MapClaims{
		"iss": r.AuthData["iss"],
		"sub": r.AuthData["sub"],
		"aud": r.AuthData["aud"],
		"nbf": secondsSinceEpoch - JWTNotBeforeOffsetSec,
		"exp": secondsSinceEpoch + JWTExpiryOffsetSec,
		"iat": secondsSinceEpoch - JWTNotBeforeOffsetSec,
		"jti": uuid.NewV4().String(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwtPayload)
	signKey, err := jwt.ParseRSAPrivateKeyFromPEM(privateKeyPem)
	if err != nil {
		log.Fatalf("Failed to parse private key: %v", err)
	}
	signedToken, err := token.SignedString(signKey)
	if err != nil {
		log.Fatalf("Failed to sign token: %v", err)
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
		log.Fatalf("Failed to get bearer token: %v", err)
	}

	return fmt.Sprintf("Bearer %s", responseData["access_token"].(string))
}

// Call handles generic HTTP requests for GET, POST, PUT, DELETE
func (r *Rest) Call(method, endpoint string, data interface{}, params map[string]string) (map[string]interface{}, error) {
	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	// Marshal the body if data is provided
	var bodyBytes []byte
	var err error
	if data != nil {
		if r.Headers["Content-Type"] == MIME_WWW {
			values := url.Values{}
			for key, value := range data.(map[string]string) {
				values.Set(key, value)
			}
			bodyBytes = []byte(values.Encode())
		} else {
			bodyBytes, err = json.Marshal(data)
			if err != nil {
				return nil, err
			}
		}
	}

	req, err := http.NewRequest(method, fmt.Sprintf("%s/%s", r.BaseURL, endpoint), bytes.NewBuffer(bodyBytes))
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
	if params != nil && method == http.MethodGet {
		q := req.URL.Query()
		for k, v := range params {
			q.Add(k, v)
		}
		req.URL.RawQuery = q.Encode()
	}

	// Send the request
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP request failed with status %d", resp.StatusCode)
	}

	bodyResp, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	// If there's no content to return, avoid trying to parse it
	if len(bodyResp) == 0 {
		return nil, nil
	}

	var result map[string]interface{}
	if err := json.Unmarshal(bodyResp, &result); err != nil {
		return nil, err
	}

	return result, nil
}

// Post performs a POST request
func (r *Rest) Create(endpoint string, data interface{}) (map[string]interface{}, error) {
	return r.Call(http.MethodPost, endpoint, data, nil)
}

// Get performs a GET request
func (r *Rest) Read(endpoint string, params map[string]string) (map[string]interface{}, error) {
	return r.Call(http.MethodGet, endpoint, nil, params)
}

// Put performs a PUT request
func (r *Rest) Update(endpoint string, data interface{}) error {
	_, err := r.Call(http.MethodPut, endpoint, data, nil)
	return err
}

// Delete performs a DELETE request
func (r *Rest) Delete(endpoint string) (map[string]interface{}, error) {
	return r.Call(http.MethodDelete, endpoint, nil, nil)
}
