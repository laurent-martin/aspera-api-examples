package examples;

import org.json.JSONObject;
import org.json.JSONArray;
import java.net.URI;
import utils.Configuration;
import utils.TransferClient;

// Receive one file from demo server using ssh credentials and transferspec v2
public class ServerFileUploadV1Example {

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
            transferClient.start_transfer_and_wait(transferSpecV1);
        } finally {
            transferClient.shutdown();
        }
    }
}
