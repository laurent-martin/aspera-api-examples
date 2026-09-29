package examples;

import org.json.JSONObject;
import org.json.JSONArray;
import java.net.URI;
import java.util.logging.Level;
import java.util.logging.Logger;
import utils.Configuration;
import utils.TransferClient;

/**
 * Sample: upload one file to HSTS with SSH credentials, with a transfer spec V1.
 */
public class ServerFileUploadV1Example {
    private static final Logger LOGGER =
            Logger.getLogger(ServerFileUploadV1Example.class.getName());

    /**
     * Execute the sample.
     *
     * @param args command line arguments: files to transfer
     * @throws Exception on error
     */
    public static void main(String... args) throws Exception {
        final Configuration config = new Configuration(args);
        final TransferClient transferClient = new TransferClient(config);
        try {
            final URI fasp_url = new URI(config.getParamStr("server", "url"));
            // transfer spec version 1 (JSON)
            final JSONObject transferSpecV1 = new JSONObject()//
                    .put("title", "server upload V1")//
                    .put("remote_host", fasp_url.getHost())//
                    .put("ssh_port", fasp_url.getPort())//
                    .put("remote_user", config.getParamStr("server", "username"))//
                    .put("remote_password", config.getParamStr("server", "password"))//
                    .put("direction", "send")//
                    .put("destination_root", config.getParamStr("server", "folder_upload"))//
                    .put("paths", new JSONArray()//
                            .put(new JSONObject()//
                                    .put("source", "faux:///10m?10m")));
            // execute transfer
            LOGGER.log(Level.INFO, "Uploading file");
            transferClient.start_transfer_and_wait(transferSpecV1);
        } finally {
            transferClient.shutdown();
        }
    }
}
