package client;

import java.net.URI;
import java.net.URISyntaxException;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;
import java.util.logging.Logger;
import java.util.logging.Level;
import java.io.IOException;
import java.security.GeneralSecurityException;
import org.json.JSONObject;
import org.json.JSONArray;
import kong.unirest.HttpResponse;
import kong.unirest.JsonNode;
import kong.unirest.Unirest;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;
import utils.TransferClient;
import utils.Crypto;
import utils.Configuration;

// This sample shows how to generate the bearer token, then use API v5 and finally send the file
// into package
public class Faspex5Send {
	static private final Logger LOGGER = Logger.getLogger(Faspex5Send.class.getName());
	static private final String MIME_JSON = "application/json";

	// generate JWT assertion
	static String generateAssertion(final String client_id, final String username,
			final String private_key) {
		final Instant now = Instant.now();
		try {
			return Jwts.builder()//
					.setHeaderParam("typ", "JWT")//
					.setIssuer(client_id) //
					.setAudience(client_id) //
					.setSubject("user:" + username) //
					.setExpiration(Date.from(now.plusSeconds(600)))//
					// remove a few seconds to allow some time difference with server
					.setNotBefore(Date.from(now.minusSeconds(60)))
					.setIssuedAt(Date.from(now.minusSeconds(60))) // same
					// must be different each time
					.claim("jti", UUID.randomUUID().toString())
					.signWith(Crypto.loadKey(private_key), SignatureAlgorithm.RS256).compact();
		} catch (final GeneralSecurityException e) {
			throw new Error(e);
		} catch (final IOException e) {
			throw new Error(e);
		}
	}

	// call Faspex 5 auth api and generate bearer token
	static String getBearerToken(final String token_url, final String client_id,
			final String username, final String private_key) {
		final HttpResponse<JsonNode> result = Unirest.post(token_url)//
				.header("Accept", MIME_JSON)
				.header("Content-Type", "application/x-www-form-urlencoded")
				.field("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer") //
				.field("client_id", client_id) //
				.field("assertion", generateAssertion(client_id, username, private_key)) //
				.asJson();
		LOGGER.log(Level.FINE, "token>> {0}", result.getBody().toPrettyString());
		return result.getBody().getObject().getString("access_token");
	}

	public static void main(String... args) {
		try {
			final Configuration config = new Configuration();
			final TransferClient transferClient = new TransferClient(config);
			final URI faspexBaseUrl = new URI(config.getParamStr("faspex5","url"));
			// base url for api v5
			final String apiBaseUrl = faspexBaseUrl + "/api/v5";
			// URL for token generation
			final String tokenUrl = faspexBaseUrl + "/auth/token";
			// dummy file is sent
			final String fileToSend = "faux:///10m?10m";
			// REST: prepare environment
			Unirest.config() //
					.verifySsl(config.getParamBool("faspex5","verify")) //
					.setDefaultHeader("Accept", MIME_JSON);

			// Faspex REST API: generate OAuth authorization
			final String token = getBearerToken(tokenUrl, config.getParamStr("faspex5","client_id"),
					config.getParamStr("faspex5","username"), config.getParamStr("faspex5","private_key"));

			// REST: prepare environment for Bearer token based auth
			Unirest.config()//
					.setDefaultHeader("Authorization", "Bearer " + token) //
					.setDefaultHeader("Content-Type", MIME_JSON);

			// Faspex API: Prepare package creation information
			final JSONObject package_create_params = new JSONObject()//
					.put("title", "test title")//
					.put("recipients", new JSONArray()//
							.put(new JSONObject()//
									.put("name", config.getParamStr("faspex5","username")))); // we send to ourselves
			LOGGER.log(Level.FINE, "req>> {0}", package_create_params);

			// Faspex REST API: Create package and get creation information
			final JSONObject package_info =
					new JSONObject(Unirest.post(apiBaseUrl + "/" + "packages")
							.body(package_create_params.toString()).asJson().getBody().toString());

			// Faspex REST API: Create transfer spec
			LOGGER.log(Level.FINE, "package>> {0}", package_info);
			final String package_id = package_info.getString("id");
			final JSONObject files_to_send = new JSONObject()//
					.put("paths", new JSONArray()//
							.put(new JSONObject()//
									.put("source", fileToSend)));
			LOGGER.log(Level.FINE, "req>> {0}", files_to_send);
			final HttpResponse<JsonNode> transfer_spec_response = Unirest
					.post(apiBaseUrl + "/" + "packages/" + package_id + "/transfer_spec/upload")
					.body(files_to_send.toString()).queryString("transfer_type", "connect")
					.asJson();
			final JSONObject transfer_spec =
					new JSONObject(transfer_spec_response.getBody().toString());
			transfer_spec.remove("authentication");
			transfer_spec.put("paths", files_to_send.get("paths"));
			LOGGER.log(Level.FINE, "ts>> {0}", transfer_spec);

			// API: Transfer SDK: transfer files into package
			transferClient.start_transfer_and_wait(transfer_spec);
		} catch (final URISyntaxException e) {
			throw new Error(e);
		}
	}
}
