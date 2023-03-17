package client;

import java.net.URI;
import java.net.URISyntaxException;
import java.time.Instant;
import java.util.Map;
import java.util.Date;
import java.util.UUID;
import java.io.IOException;
import java.security.GeneralSecurityException;
import org.json.JSONObject;
import org.json.JSONArray;
import kong.unirest.HttpResponse;
import kong.unirest.JsonNode;
import kong.unirest.Unirest;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;

public class Faspex5Send {
	// get simplified testing environment
	final TestEnvironment mTestEnv = new TestEnvironment();
	final String mApiBaseUrl;
	final String mTokenUrl;
	final Map<String, String> mConfig;

	Faspex5Send() {
		// get Faspex 5 config and parameters
		mConfig = (Map<String, String>) mTestEnv.config.get("faspex5");
		try {
			final URI faspex_url = new URI(mConfig.get("url"));
			mApiBaseUrl = faspex_url + "/api/v5";
			mTokenUrl = faspex_url + "/auth/token";
		} catch (final URISyntaxException e) {
			throw new Error(e);
		}
	}

	String url(final String path) {
		return mApiBaseUrl + "/" + path;
	}

	String generateAssertion(final String client_id) {
		final Instant now = Instant.now();
		try {
			return Jwts.builder()//
					.setHeaderParam("typ", "JWT")//
					.setIssuer(client_id) //
					.setAudience(client_id) //
					.setSubject("user:" + mConfig.get("username")) //
					.setExpiration(Date.from(now.plusSeconds(600)))//
					.setNotBefore(Date.from(now.minusSeconds(60)))//
					.setIssuedAt(Date.from(now.minusSeconds(60)))
					.claim("jti", UUID.randomUUID().toString())//
					.signWith(EncryptionUtils.loadKey(mConfig.get("private_key")),
							SignatureAlgorithm.RS256)
					.compact();
		} catch (final GeneralSecurityException e) {
			throw new Error(e);
		} catch (final IOException e) {
			throw new Error(e);
		}
	}

	String getBearerToken() {
		// System.out.println(jws);
		final String client_id = mConfig.get("client_id");
		final HttpResponse<JsonNode> result =
				Unirest.post(mTokenUrl).header("Accept", "application/json")
						.header("Content-Type", "application/x-www-form-urlencoded")
						.field("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer") //
						.field("client_id", client_id) //
						.field("assertion", generateAssertion(client_id)) //
						.asJson();
		System.out.println(">>" + result.getBody().toPrettyString());
		final String token = result.getBody().getObject().getString("access_token");
		return token;
		// System.out.println(">>" + token);
	}


	void sendPackage() {
		final String file_to_send = "faux:///10m?10m";

		// API: REST: generate OAuth authorization
		Unirest.config() //
				.setDefaultHeader("Authorization", "Bearer " + getBearerToken()) //
				.setDefaultHeader("Accept", "application/json") //
				.setDefaultHeader("Content-Type", "application/json");

		// API: REST: Create package
		final JSONObject package_create_params = new JSONObject()//
				.put("title", "test title")//
				.put("recipients", new JSONArray()//
						.put(new JSONObject()//
								.put("name", mConfig.get("username"))));
		final HttpResponse<JsonNode> package_response =
				Unirest.post(url("packages")).body(package_create_params.toString()).asJson();

		// API: REST: Create transfer spec
		JSONObject package_info = new JSONObject(package_response.getBody().toString());
		System.out.println("package>>" + package_info.toString());
		final String package_id = package_info.getString("id");
		final JSONObject files_to_send = new JSONObject()//
				.put("paths", new JSONArray()//
						.put(new JSONObject()//
								.put("source", file_to_send)));
		System.out.println("req>>" + files_to_send.toString());
		final HttpResponse<JsonNode> transfer_spec_response = Unirest
				.post(url("packages/" + package_id + "/transfer_spec/upload"))
				.body(files_to_send.toString()).queryString("transfer_type", "connect").asJson();
		JSONObject transfer_spec = new JSONObject(transfer_spec_response.getBody().toString());
		transfer_spec.remove("authentication");
		transfer_spec.put("paths", files_to_send.get("paths"));
		System.out.println("ts>>" + transfer_spec.toString());

		// API: Transfer SDK: transfer files into package
		mTestEnv.start_transfer_and_wait(transfer_spec.toString());

	}

	public static void main(String... args) throws java.net.URISyntaxException, Exception {
		new Faspex5Send().sendPackage();
	}
}
