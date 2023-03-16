package client;

import java.net.URI;
import java.util.Map;
import org.json.JSONObject;
import org.json.JSONArray;
import kong.unirest.HttpResponse;
import kong.unirest.JsonNode;

public class Faspex5Send {

	public static void main(String... args) throws java.net.URISyntaxException, Exception {
		final String file_to_send = "faux:///10m?10m";
		// get simplified testing environment
		final TestEnvironment test_environment = new TestEnvironment();
		// get Faspex 5 config and parameters
		final Map<String, String> server_conf =
				(Map<String, String>) test_environment.config.get("faspex5");
		final URI faspex_url = new URI(server_conf.get("url"));

		// REST API object with OAuth 2 JWT
		final Rest api_v5 = new Rest(faspex_url + "/api/v5");
		api_v5.oauth_jwt(faspex_url + "/auth", "user:" + server_conf.get("username"),
				server_conf.get("client_id"), server_conf.get("private_key"));

		// Create package
		final JSONObject package_create_params = new JSONObject()//
				.put("title", "test title")//
				.put("recipients", new JSONArray()//
						.put(new JSONObject()//
								.put("name", server_conf.get("username"))));
		final HttpResponse<JsonNode> package_response =
				api_v5.create("packages").body(package_create_params.toString()).asJson();
		// Create transfer spec
		JSONObject package_info = new JSONObject(package_response.getBody().toString());
		System.out.println("package>>" + package_info.toString());

		final String package_id = package_info.getString("id");
		final JSONObject files_to_send = new JSONObject()//
				.put("paths", new JSONArray()//
						.put(new JSONObject()//
								.put("source", file_to_send)));
		System.out.println("req>>" + files_to_send.toString());
		final HttpResponse<JsonNode> transfer_spec_response = api_v5
				.create("packages/" + package_id + "/transfer_spec/upload")
				.body(files_to_send.toString()).queryString("transfer_type", "connect").asJson();
		JSONObject transfer_spec = new JSONObject(transfer_spec_response.getBody().toString());
		transfer_spec.remove("authentication");
		transfer_spec.put("paths", files_to_send.get("paths"));
		System.out.println("ts>>" + transfer_spec.toString());

		test_environment.start_transfer_and_wait(transfer_spec.toString());

	}
}
