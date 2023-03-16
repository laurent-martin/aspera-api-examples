package client;

import kong.unirest.GetRequest;
import kong.unirest.HttpRequestWithBody;
import kong.unirest.HttpResponse;
import kong.unirest.JsonNode;
import kong.unirest.Unirest;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;
import java.security.GeneralSecurityException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;
import io.jsonwebtoken.io.IOException;

/**
 * Utility class for loading keys. one can also use bouncy castle
 */
public final class Rest {
    String mUrl;
    String mAuthUrl;
    String mAuthorize;

    Rest(final String base_url) {
        mUrl = base_url;
        mAuthUrl = null;
        mAuthorize = null;
    }

    void oauth_jwt(final String auth_url, final String subject, final String client_id,
            final String private_key_path) throws Exception {
        mAuthUrl = auth_url;
        final Instant now = Instant.now();

        try {
            String jws = Jwts.builder()//
                    .setHeaderParam("typ", "JWT")//
                    .setIssuer(client_id) //
                    .setAudience(client_id) //
                    .setSubject(subject) //
                    .setExpiration(Date.from(now.plusSeconds(600)))//
                    .setNotBefore(Date.from(now.minusSeconds(60)))//
                    .setIssuedAt(Date.from(now.minusSeconds(60)))
                    .claim("jti", UUID.randomUUID().toString())//
                    .signWith(EncryptionUtils.loadKey(private_key_path), SignatureAlgorithm.RS256)
                    .compact();
            // System.out.println(jws);
            final HttpResponse<JsonNode> result =
                    Unirest.post(auth_url + "/token").header("Accept", "application/json")
                            .header("Content-Type", "application/x-www-form-urlencoded")
                            .field("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer") //
                            .field("client_id", client_id) //
                            .field("assertion", jws) //
                            .asJson();
            System.out.println(">>" + result.getBody().toPrettyString());
            final String token = result.getBody().getObject().getString("access_token");
            mAuthorize = "Bearer " + token;
            // System.out.println(">>" + token);
        } catch (final GeneralSecurityException e) {
            throw new Exception(e);
        } catch (final IOException e) {
            throw new Exception(e);
        }
    }

    GetRequest read(final String path) {
        String url = mUrl + "/" + path;
        return Unirest.get(url).header("Accept", "application/json").header("Authorization",
                mAuthorize);
        //
    }

    HttpRequestWithBody create(final String path) {
        String url = mUrl + "/" + path;
        return Unirest.post(url).header("Accept", "application/json")
                .header("Content-Type", "application/json").header("Authorization", mAuthorize);
    }
}
