package client;

import org.json.JSONObject;
import org.json.JSONArray;
import java.util.Map;
import utils.Tools;
import utils.TransferClient;

// Send one file to COS using transfer spec v2
public class COSFileUploadExample {
	public static void main(String... args) {
		final Tools tools = new Tools();
		// get simplified testing environment
		final TransferClient test_environment = new TransferClient(tools);
		// get test COS bucket credentials
		final Map<String, Object> icos_conf =
				(Map<String, Object>) tools.config.get("cos");

		// build transfer spec version 2 (JSON)
		final JSONObject transferSpecV2 = new JSONObject()//
				.put("title", "COS upload")//
				.put("session_initiation", new JSONObject()//
						.put("icos", new JSONObject()//
								.put("api_key", icos_conf.get("key").toString())//
								.put("bucket", icos_conf.get("bucket").toString())//
								.put("ibm_service_instance_id", icos_conf.get("crn").toString())//
								.put("ibm_service_endpoint", icos_conf.get("endpoint").toString())))//
				.put("direction", "send")//
				.put("assets", new JSONObject()//
						.put("destination_root", "/")//
						.put("paths", new JSONArray()//
								.put(new JSONObject()//
										.put("source", "faux:///10m?10m"))));

		// execute transfer
		test_environment.start_transfer_and_wait(transferSpecV2);
	}
}
