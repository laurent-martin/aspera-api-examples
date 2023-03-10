package client;

import org.json.JSONObject;
import org.json.JSONArray;
import java.util.Map;

// Send one file to COS using transfer spec v2
public class COSFileUploadExample {
	public static void main(String... args) {
		// get simplified testing environment
		final TestEnvironment test_environment = new TestEnvironment();
		// get test COS bucket credentials
		final Map<String, String> icos_conf =
				(Map<String, String>) test_environment.config.get("cos");

		// build transfer spec version 2 (JSON)
		final JSONObject transferSpecV2 = new JSONObject()//
				.put("title", "COS upload")//
				.put("session_initiation", new JSONObject()//
						.put("icos", new JSONObject()//
								.put("api_key", icos_conf.get("key"))//
								.put("bucket", icos_conf.get("bucket"))//
								.put("ibm_service_instance_id", icos_conf.get("crn"))//
								.put("ibm_service_endpoint", icos_conf.get("endpoint"))))//
				.put("direction", "send")//
				.put("assets", new JSONObject()//
						.put("destination_root", "/")//
						.put("paths", new JSONArray()//
								.put(new JSONObject()//
										.put("source", "faux:///10m?10m"))));

		// execute transfer
		test_environment.start_transfer_and_wait(transferSpecV2.toString());
	}
}
