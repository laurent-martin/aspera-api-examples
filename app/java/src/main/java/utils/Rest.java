package utils;

// import kong.unirest.Unirest;
import kong.unirest.core.Unirest;
import java.util.logging.Level;
import java.util.logging.Logger;
import io.jsonwebtoken.JwtBuilder;
import java.io.IOException;
import java.security.GeneralSecurityException;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.Base64;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;
import org.json.JSONObject;
import org.json.JSONTokener;

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

    public Rest(final String url) {
        baseUrl = url;
        headers = new HashMap<String, String>();
        authData = new HashMap<String, String>();
    }

    public void setVerify(final boolean verify) {
        Unirest.config().verifySsl(verify);
    }

    public void setAuthBasic(final String username, final String password) {
        final String credentials = username + ":" + password;
        headers.put("Authorization",
                "Basic " + Base64.getEncoder().encodeToString(credentials.getBytes()));
    }

    public void setAuthBearer(final Map<String, String> authData) {
        logger.log(Level.FINE, "authData>> {0}", authData);
        this.authData.putAll(authData);
    }

    public void setDefaultScope(Optional<String> scope) throws Exception {
        headers.put("Authorization", getBearerToken(scope));
    }

    // call Faspex 5 authData api and generate bearer token
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

            final JwtBuilder assertion = Jwts.builder()//
                    .signWith(Crypto.loadKey(authData.get("key_pem_path")),
                            SignatureAlgorithm.RS256) //
                    .setHeaderParam("typ", "JWT") //
                    .setHeaderParam("alg", "RS256") //
                    .setClaims(jwt_payload);
            if (authData.containsKey("org")) {
                assertion.claim("org", authData.get("org"));

            }
            Map<String, Object> www_form = new HashMap<>();
            www_form.put("client_id", authData.get("client_id"));
            www_form.put("grant_type", IETF_GRANT_JWT);
            www_form.put("assertion", assertion.compact());
            scope.ifPresent(s -> www_form.put("scope", s));

            final var req = Unirest.post(authData.get("token_url"))//
                    .basicAuth(authData.get("client_id"), authData.get("client_secret"))//
                    .header("Accept", MIME_JSON)//
                    .header("Content-Type", MIME_WWW)//
                    .fields(www_form);

            final var response = req.asJson();
            if (!response.isSuccess()) {
                throw new Error("Failed to get access token: " + response.getStatus());
            }
            logger.log(Level.FINE, "token>> {0}", response.getBody().toPrettyString());
            return "Bearer " + response.getBody().getObject().getString("access_token");
        } catch (final GeneralSecurityException e) {
            throw new Error(e);
        } catch (final IOException e) {
            throw new Error(e);
        }

    }

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
        body.ifPresent(v -> logger.log(Level.FINE, "Body: {0}", v));
        query.ifPresent(q -> q
                .forEach((k, v) -> logger.log(Level.FINE, "param>> {0}={1}", new Object[] {k, v})));
        var request_builder = Unirest//
                .request(method, url) //
                .header("Content-Type", MIME_JSON)//
                .header("Accept", MIME_JSON).body("");
        headers.forEach(request_builder::header);
        query.ifPresent(p -> {
            for (var e : p.entrySet()) {
                request_builder.queryString(e.getKey(), e.getValue());
            }
        });
        body.ifPresent(v -> request_builder.body(v.toString()));
        final var response = request_builder.asString();
        if (!response.isSuccess()) {
            logger.log(Level.SEVERE, "Request failed with status: {0}", response.getStatus());
            logger.log(Level.SEVERE, "Request failed with body: {0}",
                    response.getBody().toString());
            throw new Exception("Request failed: " + response.getStatus());
        }
        logger.log(Level.FINE, "res>> {0}", response.getBody());
        return new JSONTokener(response.getBody().toString()).nextValue();
    }

    public Object create(String endpoint, JSONObject data) throws Exception {
        return call("POST", endpoint, Optional.of(data), Optional.empty());
    }

    public Object create(String endpoint, JSONObject data, Map<String, String> params)
            throws Exception {
        return call("POST", endpoint, Optional.of(data), Optional.of(params));
    }

    public Object read(String endpoint, Map<String, String> params) throws Exception {
        return call("GET", endpoint, Optional.empty(), Optional.of(params));
    }

    public Object read(String endpoint) throws Exception {
        return call("GET", endpoint, Optional.empty(), Optional.empty());
    }

    public void update(String endpoint, JSONObject data) throws Exception {
        call("PUT", endpoint, Optional.of(data), Optional.empty());
    }

    public void delete(String endpoint) throws Exception {
        call("DELETE", endpoint, Optional.empty(), Optional.empty());
    }
}
