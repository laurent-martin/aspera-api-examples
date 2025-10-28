package examples;

import java.util.Map;
import java.util.logging.Level;
import java.util.logging.Logger;
import org.json.JSONObject;
import utils.TransferClient;
import utils.Configuration;
import utils.Rest;

public class Node {

    private static final Logger LOGGER = Logger.getLogger(Node.class.getName());

    public static void main(String... args) throws Exception {
        final Configuration config = new Configuration(args);
        final TransferClient transferClient = new TransferClient(config);

        try {
            /*
             * Create Node API object
             */
            LOGGER.log(Level.INFO, "Creating Node API object");
            final String nodeBaseUrl = config.getParamStr("node", "url");
            final var nodeAPI = new Rest(nodeBaseUrl);
            nodeAPI.setVerify(config.getParamBool("node", "verify"));
            nodeAPI.setAuthBasic(config.getParamStr("node", "username"),
                    config.getParamStr("node", "password"));

            /*
             * Generate transfer spec using upload_setup
             */
            LOGGER.log(Level.INFO, "Generating transfer spec");
            final JSONObject uploadSetupRequest = new JSONObject().put("transfer_requests",
                    new org.json.JSONArray().put(new JSONObject().put("transfer_request",
                            new JSONObject().put("paths",
                                    new org.json.JSONArray().put(new JSONObject().put("destination",
                                            config.getParamStr("node", "folder_upload")))))));

            final JSONObject response =
                    (JSONObject) nodeAPI.create("files/upload_setup", uploadSetupRequest);
            final JSONObject transferSpec = response.getJSONArray("transfer_specs").getJSONObject(0)
                    .getJSONObject("transfer_spec");

            /*
             * Add local file paths to transfer spec
             */
            config.addSources(transferSpec, "paths", null);

            /*
             * Start transfer
             */
            LOGGER.log(Level.INFO, "Starting transfer");
            transferClient.start_transfer_and_wait(transferSpec);

        } finally {
            transferClient.shutdown();
        }
    }
}
