package examples;

import org.json.JSONObject;
import org.json.JSONArray;
import java.util.logging.Level;
import java.util.logging.Logger;
import utils.Configuration;
import utils.TransferClient;

/**
 * Sample: upload one file to IBM Cloud Object Storage, with a transfer spec V2.
 */
public class COSFileUploadExample {
    private static final Logger LOGGER = Logger.getLogger(COSFileUploadExample.class.getName());

    /**
     * Execute the sample.
     *
     * @param args command line arguments: files to transfer
     */
    public static void main(String... args) {
        final Configuration config = new Configuration(args);
        final TransferClient transferClient = new TransferClient(config);
        try {
            // build transfer spec version 2 (JSON)
            final JSONObject transferSpecV2 = new JSONObject()//
                    .put("title", "COS upload")//
                    .put("session_initiation", new JSONObject()//
                            .put("icos", new JSONObject()//
                                    .put("api_key", config.getParamStr("cos", "key"))//
                                    .put("bucket", config.getParamStr("cos", "bucket"))//
                                    .put("ibm_service_instance_id",
                                            config.getParamStr("cos", "crn"))//
                                    .put("ibm_service_endpoint",
                                            config.getParamStr("cos", "endpoint"))))//
                    .put("direction", "send")//
                    .put("assets", new JSONObject()//
                            .put("destination_root", "/")//
                            .put("paths", new JSONArray()//
                                    .put(new JSONObject()//
                                            .put("source", "faux:///10m?10m"))));
            // execute transfer
            LOGGER.log(Level.INFO, "Uploading file");
            transferClient.start_transfer_and_wait(transferSpecV2);
        } finally {
            transferClient.shutdown();
        }
    }
}
