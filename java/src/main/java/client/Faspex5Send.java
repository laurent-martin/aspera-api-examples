package client;

import java.net.URI;
import java.net.URISyntaxException;
import java.time.Instant;
import java.util.Map;
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

// This sample shows how to generate the bearer token, then use API v5 and finally send the file
// into package
public class Faspex5Send {
	private static final Logger LOGGER = Logger.getLogger(Faspex5Send.class.getName());
	// get simplified testing environment
	final TestEnvironment mTestEnv = new TestEnvironment();
	// config from yaml
	final Map<String, String> mConfig;
	// base url for api v5
	final String mApiBaseUrl;
	// URL for token generation
	final String mTokenUrl;

	Faspex5Send() {
		// get Faspex 5 parameters from config section in yaml
		mConfig = (Map<String, String>) mTestEnv.config.get("faspex5");
		try {
			final URI faspex_url = new URI(mConfig.get("url"));
			mApiBaseUrl = faspex_url + "/api/v5";
			mTokenUrl = faspex_url + "/auth/token";
		} catch (final URISyntaxException e) {
			throw new Error(e);
		}
	}

	// full api url from just path
	String url(final String path) {
		return mApiBaseUrl + "/" + path;
	}

	// generate JWT assertion
	String generateAssertion(final String client_id) {
		final Instant now = Instant.now();
		try {
			return Jwts.builder()//
					.setHeaderParam("typ", "JWT")//
					.setIssuer(client_id) //
					.setAudience(client_id) //
					.setSubject("user:" + mConfig.get("username")) //
					.setExpiration(Date.from(now.plusSeconds(600)))//
					.setNotBefore(Date.from(now.minusSeconds(60)))// remove a few seconds to allow
																	// some time difference with
																	// server
					.setIssuedAt(Date.from(now.minusSeconds(60))) // same
					.claim("jti", UUID.randomUUID().toString())// must be different each time
					.signWith(EncryptionUtils.loadKey(mConfig.get("private_key")),
							SignatureAlgorithm.RS256)
					.compact();
		} catch (final GeneralSecurityException e) {
			throw new Error(e);
		} catch (final IOException e) {
			throw new Error(e);
		}
	}

	// call Faspex 5 auth api and generate bearer token
	String getBearerToken() {
		final String client_id = mConfig.get("client_id");
		final HttpResponse<JsonNode> result =
				Unirest.post(mTokenUrl).header("Accept", "application/json")
						.header("Content-Type", "application/x-www-form-urlencoded")
						.field("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer") //
						.field("client_id", client_id) //
						.field("assertion", generateAssertion(client_id)) //
						.asJson();
		LOGGER.log(Level.FINE, ">> {0}", result.getBody().toPrettyString());
		final String token = result.getBody().getObject().getString("access_token");
		return token;
	}


	// Send Faspex 5 package with fixed parameters
	void sendPackage() {
		final String file_to_send = "faux:///10m?10m";

		// REST: prepare environment
		Unirest.config()//
				.verifySsl(false) // assume dev environment
				.setDefaultHeader("Accept", "application/json");

		// Faspex REST API: generate OAuth authorization
		final String token = getBearerToken();

		// REST: prepare environment for Bearer token based auth
		Unirest.config()//
				.setDefaultHeader("Authorization", "Bearer " + token) //
				.setDefaultHeader("Content-Type", "application/json");


		// Faspex API: Prepare package creation information
		final JSONObject package_create_params = new JSONObject()//
				.put("title", "test title")//
				.put("recipients", new JSONArray()//
						.put(new JSONObject()//
								.put("name", mConfig.get("username")))); // we send to ourselves

		// Faspex REST API: Create package and get creation information
		final JSONObject package_info = new JSONObject(Unirest.post(url("packages"))
				.body(package_create_params.toString()).asJson().getBody().toString());

		// Faspex REST API: Create transfer spec
		LOGGER.log(Level.FINE, "package>> {0}", package_info);
		final String package_id = package_info.getString("id");
		final JSONObject files_to_send = new JSONObject()//
				.put("paths", new JSONArray()//
						.put(new JSONObject()//
								.put("source", file_to_send)));
		LOGGER.log(Level.FINE, "req>> {0}", files_to_send);
		final HttpResponse<JsonNode> transfer_spec_response = Unirest
				.post(url("packages/" + package_id + "/transfer_spec/upload"))
				.body(files_to_send.toString()).queryString("transfer_type", "connect").asJson();
		final JSONObject transfer_spec =
				new JSONObject(transfer_spec_response.getBody().toString());
		transfer_spec.remove("authentication");
		transfer_spec.put("paths", files_to_send.get("paths"));
		LOGGER.log(Level.FINE, "ts>> {0}", transfer_spec);

		// API: Transfer SDK: transfer files into package
		mTestEnv.start_transfer_and_wait(transfer_spec.toString());
	}

	public static void main(String... args) {
		new Faspex5Send().sendPackage();
	}
}
