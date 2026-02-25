package examples;

import org.json.JSONObject;
import org.json.JSONArray;
import java.net.URI;
import utils.TransferClient;
import utils.Configuration;

// Receive one file from demo server using ssh credentials and transferspec v2
public class ServerFileDownloadV2Example {

    public static void main(String... args) {
        final Configuration config = new Configuration(args);
        final TransferClient transferClient = new TransferClient(config);
        try {
            final URI faspURL = new URI(config.getParamStr("server", "url"));
            // transfer spec version 2 (JSON)
            final JSONObject transferSpecV2 = new JSONObject()//
                    .put("title", "server upload ts v2")//
                    .put("remote_host", faspURL.getHost())//
                    .put("session_initiation", new JSONObject()//
                            .put("ssh", new JSONObject()//
                                    .put("ssh_port", faspURL.getPort())//
                                    .put("remote_user", config.getParamStr("server", "username"))//
                                    .put("remote_password",
                                            config.getParamStr("server", "password"))))//
                    .put("direction", "recv")//
                    .put("assets", new JSONObject()//
                            .put("destination_root", System.getProperty("java.io.tmpdir"))//
                            .put("paths", new JSONArray()//
                                    .put(new JSONObject()//
                                            .put("source",
                                                    config.getParamStr("server", "file_download"))//
                                            .put("destination", "downloaded_file"))));
            // execute transfer
            transferClient.start_transfer_and_wait(transferSpecV2);
        } catch (Exception e) {
            throw new Error(e);
        } finally {
            transferClient.shutdown();
        }
    }
}
