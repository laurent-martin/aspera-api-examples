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
			final Map<String, String> authData = Map.of(//
					"token_url", faspexBaseUrl + F5_API_PATH_TOKEN, //
					"key_pem_path", config.getParamStr("faspex5", "private_key"), //
					"client_id", config.getParamStr("faspex5", "client_id"), //
					"client_secret", config.getParamStr("faspex5", "client_secret"), //
					"iss", config.getParamStr("faspex5", "client_id"), //
					"aud", config.getParamStr("faspex5", "client_id"), //
					"sub", "user:" + config.getParamStr("faspex5", "username") //
			);
			f5API.setAuthBearer(authData);
			f5API.setDefaultScope(Optional.empty());

			// Faspex API: Prepare package creation information: we send to ourselves
			// Faspex REST API: Create package and get creation information
			final JSONObject package_info = (JSONObject) f5API.create("packages", new JSONObject()//
					.put("title", "test title")//
					.put("recipients", new JSONArray()//
							.put(new JSONObject()//
									.put("name", config.getParamStr("faspex5", "username")))));

			// Faspex REST API: Create transfer spec
			final JSONObject uploadRequest = new JSONObject();
			transferClient.fillFilePaths(uploadRequest);
			final JSONObject transfer_spec = (JSONObject)f5API.create("packages/" + package_info.getString("id") + "/transfer_spec/upload",uploadRequest,Map.of("transfer_type", "connect"));
			transfer_spec.remove("authentication");
			transferClient.fillFilePaths(transfer_spec);
			// API: Transfer SDK: transfer files into package
			transferClient.start_transfer_and_wait(transfer_spec);
		} catch (final Exception e) {
			throw new Error(e);
		}
	}
}
