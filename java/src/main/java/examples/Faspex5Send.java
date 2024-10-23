package examples;

import java.util.Map;
import java.util.Optional;
import java.util.logging.Logger;
import org.json.JSONObject;
import org.json.JSONArray;
import utils.TransferClient;
import utils.Configuration;
import utils.Rest;

// This sample shows how to generate the bearer token, then use API v5 and finally send the file
// into package
public class Faspex5Send {
	static private final Logger LOGGER = Logger.getLogger(Faspex5Send.class.getName());
	static private final String F5_API_PATH_V5 = "/api/v5";
	static private final String F5_API_PATH_TOKEN = "/auth/token";

	public static void main(String... args) {
		try {
			final Configuration config = new Configuration(args);
			final TransferClient transferClient = new TransferClient(config);
			final String faspexBaseUrl = config.getParamStr("faspex5", "url");
			final String apiBaseUrl = faspexBaseUrl + F5_API_PATH_V5;
			final var f5API = new Rest(apiBaseUrl);
			f5API.setVerify(config.getParamBool("faspex5", "verify"));
			f5API.setAuthBearer(Map.ofEntries(//
					Map.entry("token_url", faspexBaseUrl + F5_API_PATH_TOKEN), //
					Map.entry("key_pem_path", config.getParamStr("faspex5", "private_key")), //
					Map.entry("client_id", config.getParamStr("faspex5", "client_id")), //
					Map.entry("client_secret", config.getParamStr("faspex5", "client_secret")), //
					Map.entry("iss", config.getParamStr("faspex5", "client_id")), //
					Map.entry("aud", config.getParamStr("faspex5", "client_id")), //
					Map.entry("sub", "user:" + config.getParamStr("faspex5", "username")) //
			));
			f5API.setDefaultScope(Optional.empty());
			// Faspex REST API: Create package (to myself) and get package information
			final JSONObject package_info = (JSONObject) f5API.create("packages", new JSONObject()//
					.put("title", "test title")//
					.put("recipients", new JSONArray()//
							.put(new JSONObject()//
									.put("name", config.getParamStr("faspex5", "username")))));
			// Faspex REST API: Create transfer spec
			final JSONObject uploadRequest = new JSONObject();
			config.addFilesToTs(uploadRequest);
			final JSONObject transfer_spec = (JSONObject) f5API.create(
					"packages/" + package_info.getString("id") + "/transfer_spec/upload",
					uploadRequest, Map.of("transfer_type", "connect"));
			transfer_spec.remove("authentication");
			config.addFilesToTs(transfer_spec);
			// API: Transfer SDK: transfer files into package
			transferClient.start_transfer_and_wait(transfer_spec);
		} catch (final Exception e) {
			throw new Error(e);
		}
	}
}
