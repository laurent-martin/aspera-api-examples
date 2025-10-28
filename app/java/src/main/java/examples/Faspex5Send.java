package examples;

import java.util.Map;
import java.util.Optional;
import java.util.logging.Level;
import java.util.logging.Logger;
import org.json.JSONObject;
import org.json.JSONArray;
import utils.TransferClient;
import utils.Configuration;
import utils.Rest;

// This sample shows how to generate the bearer token, then use API v5 and finally send the file
// into package
public class Faspex5Send {

    private static final Logger LOGGER = Logger.getLogger(Faspex5Send.class.getName());
    private static final String F5_API_PATH_V5 = "/api/v5";
    private static final String F5_API_PATH_TOKEN = "/auth/token";

    public static void main(String... args) throws Exception {
        final Configuration config = new Configuration(args);
        final TransferClient transferClient = new TransferClient(config);
        try {
            /*
             * Generic part: create API object
             */
            LOGGER.log(Level.INFO, "Creating API object");
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
            /*
             * First example: send a package from local files/folders
             */
            // Faspex REST API: Create package (to myself) and get package information
            LOGGER.log(Level.INFO, "Creating Package container");
            final JSONObject package_info = (JSONObject) f5API.create("packages", new JSONObject()//
                    .put("title", "test title")//
                    .put("recipients", new JSONArray()//
                            .put(new JSONObject()//
                                    .put("name", config.getParamStr("faspex5", "username")))));
            // Faspex REST API: Create transfer spec
            LOGGER.log(Level.INFO, "Creating transfer specification");
            final JSONObject uploadRequest = new JSONObject();
            config.addSources(uploadRequest, "paths", null);
            final JSONObject transfer_spec = (JSONObject) f5API.create(
                    "packages/" + package_info.getString("id") + "/transfer_spec/upload",
                    uploadRequest, Map.of("transfer_type", "connect"));
            transfer_spec.remove("authentication");
            config.addSources(transfer_spec, "paths", null);
            // API: Transfer SDK: transfer files into package
            LOGGER.log(Level.INFO, "Starting transfer");
            transferClient.start_transfer_and_wait(transfer_spec);
            /*
             * Second example: send a package from files/folders already on HSTS Server
             */
            // Faspex REST API: Create package for remote transfer
            LOGGER.log(Level.INFO, "Creating Package container for remote transfer");
            final JSONObject remotePackageInfo = (JSONObject) f5API.create("packages",
                    new JSONObject().put("title", "Java remote files").put("recipients",
                            new JSONArray().put(new JSONObject().put("name",
                                    config.getParamStr("faspex5", "username")))));

            // Lookup shared folder ID by name
            LOGGER.log(Level.INFO, "Looking up shared folder ID");
            final JSONArray sharedFolders =
                    ((JSONObject) f5API.read("shared_folders")).getJSONArray("shared_folders");
            final String sharedFolderName = config.getParamStr("faspex5", "shared_folder_name");
            String folderId = null;
            for (int i = 0; i < sharedFolders.length(); i++) {
                final JSONObject folder = sharedFolders.getJSONObject(i);
                if (sharedFolderName.equals(folder.getString("name"))) {
                    folderId = folder.getString("id");
                    break;
                }
            }
            if (folderId == null) {
                throw new Exception("No shared folder found with name: " + sharedFolderName);
            }
            // Trigger remote transfer
            LOGGER.log(Level.INFO, "Starting remote transfer from shared folder: " + folderId);
            final JSONObject remoteUploadRequest =
                    new JSONObject().put("shared_folder_id", folderId).put("paths", new JSONArray()
                            .put(config.getParamStr("faspex5", "shared_folder_file")));
            final JSONObject transferInfo = (JSONObject) f5API.create(
                    "packages/" + remotePackageInfo.getString("id") + "/remote_transfer",
                    remoteUploadRequest);
            LOGGER.log(Level.INFO, "Remote transfer initiated: " + transferInfo.toString());
            // Poll for remote transfer completion
            while (true) {
                final JSONObject uploadDetails = (JSONObject) f5API
                        .read("packages/" + remotePackageInfo.getString("id") + "/upload_details");
                final String status = uploadDetails.getString("upload_status");
                LOGGER.log(Level.INFO, "Remote transfer status: " + status);
                if ("completed".equals(status)) {
                    break;
                } else if ("failed".equals(status)) {
                    throw new Exception("Remote transfer failed");
                }
                Thread.sleep(1000);
            }
        } finally {
            transferClient.shutdown();
        }
    }
}
