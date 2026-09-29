package utils;

// import kong.unirest.Unirest;
import kong.unirest.core.HttpRequestWithBody;
import kong.unirest.core.Unirest;
import java.util.logging.Level;
import java.util.logging.Logger;
import io.jsonwebtoken.JwtBuilder;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.Base64;
import java.util.stream.Collectors;
import io.jsonwebtoken.Jwts;
import org.json.JSONObject;
import org.json.JSONTokener;

/**
 * Simple REST client, with Basic or OAuth 2 JWT Bearer authentication.
 */
public class Rest {
    static private final Logger logger = Logger.getLogger(Rest.class.getName());

    private static final int JWT_CLIENT_SERVER_OFFSET_SEC = 60;
    private static final int JWT_VALIDITY_SEC = 600;
    private static final String MIME_JSON = "application/json";
    private static final String MIME_WWW = "application/x-www-form-urlencoded";
    private static final String IETF_GRANT_JWT = "urn:ietf:params:oauth:grant-type:jwt-bearer";

    private final String baseUrl;
    private final Map<String, String> headers;
    private final Map<String, String> authData;

    /**
     * Create a REST client.
     *
     * @param url base URL of the API
     */
    public Rest(final String url) {
        baseUrl = url;
        headers = new HashMap<String, String>();
        authData = new HashMap<String, String>();
    }

    /**
     * Enable or disable the verification of the server certificate, for all REST clients.
     *
     * @param verify false for development servers with a self-signed certificate
     */
    public void setVerify(final boolean verify) {
        Unirest.config().verifySsl(verify);
    }

    /**
     * Use Basic authentication.
     *
     * @param username user name
     * @param password password
     */
    public void setAuthBasic(final String username, final String password) {
        final String credentials = username + ":" + password;
        headers.put("Authorization",
                "Basic " + Base64.getEncoder().encodeToString(credentials.getBytes()));
    }

    /**
     * Use OAuth 2 Bearer authentication, with a JWT signed with a private key.
     *
     * @param authData {@code token_url}, {@code key_pem_path}, {@code client_id}, {@code client_secret}, {@code iss}, {@code aud}, {@code sub}, and optionally {@code org}
     */
    public void setAuthBearer(final Map<String, String> authData) {
        this.authData.putAll(authData);
    }

    /**
     * Generate a bearer token, and use it for all subsequent requests.
     *
     * A new token is generated for each execution of the sample.
     * In real code, the token should be reused until it expires.
     *
     * @param scope OAuth scope of the token, or none
     * @throws Exception on HTTP error
     */
    public void setDefaultScope(Optional<String> scope) throws Exception {
        headers.put("Authorization", getBearerToken(scope));
    }

    /**
     * Generate a bearer token, with the JWT Bearer grant.
     *
     * @param scope OAuth scope of the token, or none
     * @return value of the Authorization header: {@code Bearer <token>}
     */
    public String getBearerToken(Optional<String> scope) {
        final long epochDate = Instant.now().getEpochSecond();
        try {
            final Map<String, Object> jwt_payload = new HashMap<>();
            jwt_payload.put("iss", authData.get("iss"));
            jwt_payload.put("sub", authData.get("sub"));
            jwt_payload.put("aud", authData.get("aud"));
            jwt_payload.put("iat", epochDate - JWT_CLIENT_SERVER_OFFSET_SEC);
            jwt_payload.put("nbf", epochDate - JWT_CLIENT_SERVER_OFFSET_SEC);
            jwt_payload.put("exp", epochDate + JWT_VALIDITY_SEC);
            jwt_payload.put("jti", UUID.randomUUID().toString());

            // header `alg` is set by `signWith`
            final JwtBuilder assertion = Jwts.builder()//
                    .signWith(Crypto.loadKey(authData.get("key_pem_path")), Jwts.SIG.RS256) //
                    .header().add("typ", "JWT").and() //
                    .claims(jwt_payload);
            if (authData.containsKey("org")) {
                assertion.claim("org", authData.get("org"));

            }
            Map<String, String> www_form = new HashMap<>();
            www_form.put("client_id", authData.get("client_id"));
            www_form.put("grant_type", IETF_GRANT_JWT);
            www_form.put("assertion", assertion.compact());
            scope.ifPresent(s -> www_form.put("scope", s));
            final String form = www_form.entrySet().stream()
                    .map(e -> URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8) + "="
                            + URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8))
                    .collect(Collectors.joining("&"));

            final String tokenUrl = authData.get("token_url");
            final var request = Unirest.post(tokenUrl)//
                    .basicAuth(authData.get("client_id"), authData.get("client_secret"))//
                    .header("Accept", MIME_JSON)//
                    .header("Content-Type", MIME_WWW);
            final String responseBody = send("POST", tokenUrl, request, form);
            return "Bearer " + new JSONObject(responseBody).getString("access_token");
        } catch (final GeneralSecurityException e) {
            throw new Error(e);
        } catch (final IOException e) {
            throw new Error(e);
        }

    }

    /**
     * Call the API: send a request, and get the response data.
     *
     * @param method HTTP method
     * @param endpoint path of the endpoint, relative to the base URL
     * @param body request data, sent in JSON
     * @param query query parameters
     * @return response data, or null if the response is empty
     * @throws Exception on HTTP error
     */
    public Object call(//
            String method, //
            String endpoint, //
            Optional<JSONObject> body, //
            Optional<Map<String, String>> query//
    ) throws Exception {
        String url = baseUrl;
        if (endpoint != null) {
            url = url + "/" + endpoint;
        }
        // final String url = "http://localhost:12345";
        final var request = Unirest//
                .request(method, url) //
                .header("Content-Type", MIME_JSON)//
                .header("Accept", MIME_JSON);
        headers.forEach(request::header);
        query.ifPresent(p -> {
            for (var e : p.entrySet()) {
                request.queryString(e.getKey(), e.getValue());
            }
        });
        final String responseBody = send(method, url, request, body.map(JSONObject::toString).orElse(""));
        if (responseBody.isEmpty()) {
            return null;
        }
        return new JSONTokener(responseBody).nextValue();
    }

    /**
     * Send an HTTP request, log request and response bodies, and throw an exception on error.
     *
     * @param method HTTP method
     * @param url URL without query
     * @param request HTTP request
     * @param body request body
     * @return response body
     */
    private static String send(final String method, final String url, final HttpRequestWithBody request,
            final String body) {
        logger.log(Level.FINE, "HTTP {0} {1}", new Object[] {method, url});
        if (!body.isEmpty()) {
            Configuration.logDump("Request body", body);
        }
        final var response = request.body(body).asString();
        final String responseBody = response.getBody() == null ? "" : response.getBody();
        if (!response.isSuccess()) {
            throw new RuntimeException(
                    "HTTP " + response.getStatus() + " for " + method + " " + url + ": " + responseBody);
        }
        if (!responseBody.isEmpty()) {
            Configuration.logDump("Response body", responseBody);
        }
        return responseBody;
    }

    /**
     * Create a resource (HTTP POST).
     *
     * @param endpoint path of the endpoint, relative to the base URL
     * @param data request data, sent in JSON
     * @return response data
     * @throws Exception on HTTP error
     */
    public Object create(String endpoint, JSONObject data) throws Exception {
        return call("POST", endpoint, Optional.of(data), Optional.empty());
    }

    /**
     * Create a resource (HTTP POST).
     *
     * @param endpoint path of the endpoint, relative to the base URL
     * @param data request data, sent in JSON
     * @param params query parameters
     * @return response data
     * @throws Exception on HTTP error
     */
    public Object create(String endpoint, JSONObject data, Map<String, String> params)
            throws Exception {
        return call("POST", endpoint, Optional.of(data), Optional.of(params));
    }

    /**
     * Read a resource (HTTP GET).
     *
     * @param endpoint path of the endpoint, relative to the base URL
     * @param params query parameters
     * @return response data
     * @throws Exception on HTTP error
     */
    public Object read(String endpoint, Map<String, String> params) throws Exception {
        return call("GET", endpoint, Optional.empty(), Optional.of(params));
    }

    /**
     * Read a resource (HTTP GET).
     *
     * @param endpoint path of the endpoint, relative to the base URL
     * @return response data
     * @throws Exception on HTTP error
     */
    public Object read(String endpoint) throws Exception {
        return call("GET", endpoint, Optional.empty(), Optional.empty());
    }

    /**
     * Update a resource (HTTP PUT).
     *
     * @param endpoint path of the endpoint, relative to the base URL
     * @param data request data, sent in JSON
     * @throws Exception on HTTP error
     */
    public void update(String endpoint, JSONObject data) throws Exception {
        call("PUT", endpoint, Optional.of(data), Optional.empty());
    }

    /**
     * Delete a resource (HTTP DELETE).
     *
     * @param endpoint path of the endpoint, relative to the base URL
     * @throws Exception on HTTP error
     */
    public void delete(String endpoint) throws Exception {
        call("DELETE", endpoint, Optional.empty(), Optional.empty());
    }
}
