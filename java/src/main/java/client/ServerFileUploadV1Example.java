package client;

import org.json.JSONObject;
import org.json.JSONArray;
import java.net.URI;
import java.util.Map;

// Receive one file from demo server using ssh credentials and transferspec v2
public class ServerFileUploadV1Example {
	public static void main(String... args) throws java.net.URISyntaxException {
		// get simplified testing environment
		final TestEnvironment test_environment = new TestEnvironment();
		// get test server address and credentials
		final Map<String, Object> server_conf =
				(Map<String, Object>) test_environment.config.get("server");
		final URI fasp_url = new URI(server_conf.get("url").toString());
		// transfer spec version 1 (JSON)
		final JSONObject transferSpecV1 = new JSONObject()//
				.put("title", "server upload V1")//
				.put("remote_host", fasp_url.getHost())//
				.put("ssh_port", fasp_url.getPort())//
				.put("remote_user", server_conf.get("user").toString())//
				.put("remote_password", server_conf.get("pass").toString())//
				.put("direction", "send")//
				.put("destination_root", "/Upload")//
				.put("paths", new JSONArray()//
						.put(new JSONObject()//
								.put("source", "faux:///10m?10m")));

		// execute transfer
		test_environment.start_transfer_and_wait(transferSpecV1.toString());
	}
}
