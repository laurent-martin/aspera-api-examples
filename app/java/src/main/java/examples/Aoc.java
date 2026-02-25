package examples;

import java.util.Map;
import java.util.Optional;
import java.util.logging.Level;
import java.util.logging.Logger;
import org.json.JSONArray;
import org.json.JSONObject;
import utils.TransferClient;
import utils.Configuration;
import utils.Rest;
import java.util.Base64;

public class Aoc {

    private static final Logger LOGGER = Logger.getLogger(Aoc.class.getName());
    private static final String AOC_API_V1_BASE_URL = "https://api.ibmaspera.com/api/v1";
    private static final String AOC_OAUTH_AUDIENCE =
            "https://api.asperafiles.com/api/v1/oauth2/token";

    public static void main(String... args) throws Exception {
        final Configuration config = new Configuration(args);
        final TransferClient transferClient = new TransferClient(config);

        try {
            /*
             * Generic part: create API object
             */
            LOGGER.log(Level.INFO, "Creating AoC API object");
            final var aocAPI = new Rest(AOC_API_V1_BASE_URL);
            aocAPI.setAuthBearer(Map.ofEntries(
                    Map.entry("token_url",
                            AOC_API_V1_BASE_URL + "/oauth2/" + config.getParamStr("aoc", "org")
                                    + "/token"),
                    Map.entry("key_pem_path", config.getParamStr("aoc", "private_key")),
                    Map.entry("client_id", config.getParamStr("aoc", "client_id")),
                    Map.entry("client_secret", config.getParamStr("aoc", "client_secret")),
                    Map.entry("iss", config.getParamStr("aoc", "client_id")),
                    Map.entry("aud", AOC_OAUTH_AUDIENCE),
                    Map.entry("sub", config.getParamStr("aoc", "user_email")),
                    Map.entry("org", config.getParamStr("aoc", "org"))));
            aocAPI.setDefaultScope(Optional.of("user:all"));

            /*
             * Get user info
             */
            LOGGER.log(Level.INFO, "Getting user info");
            final JSONObject userInfo = (JSONObject) aocAPI.read("self");

            /*
             * Get workspace info
             */
            final String workspaceName = config.getParamStr("aoc", "workspace");
            LOGGER.log(Level.INFO, "Looking up workspace: " + workspaceName);
            final JSONArray workspaces =
                    (JSONArray) aocAPI.read("workspaces", Map.of("q", workspaceName));
            if (workspaces.length() != 1) {
                throw new Exception(
                        "Found " + workspaces.length() + " workspaces for name: " + workspaceName);
            }
            final JSONObject workspaceInfo = workspaces.getJSONObject(0);

            /*
             * Get shared inbox (dropbox) info
             */
            final String sharedInboxName = config.getParamStr("aoc", "shared_inbox");
            LOGGER.log(Level.INFO, "Looking up shared inbox: " + sharedInboxName);
            final JSONArray dropboxes =
                    (JSONArray) aocAPI.read("dropboxes", Map.of("current_workspace_id",
                            workspaceInfo.getString("id"), "q", sharedInboxName));
            if (dropboxes.length() != 1) {
                throw new Exception(
                        "Found " + dropboxes.length() + " dropboxes for name: " + sharedInboxName);
            }
            final JSONObject dropboxInfo = dropboxes.getJSONObject(0);

            /*
             * Create package
             */
            LOGGER.log(Level.INFO, "Creating package");
            final JSONObject packageInfo =
                    (JSONObject) aocAPI
                            .create("packages",
                                    new JSONObject()
                                            .put("workspace_id",
                                                    workspaceInfo.getString("id"))
                                            .put("recipients",
                                                    new JSONArray()
                                                            .put(new JSONObject()
                                                                    .put("id",
                                                                            dropboxInfo.getString(
                                                                                    "id"))
                                                                    .put("type", "dropbox")))
                                            .put("name", "sample package Java")
                                            .put("note", "My package note").put("sent", true)
                                            .put("transfers_expected", 1));

            /*
             * Get node info
             */
            LOGGER.log(Level.INFO, "Getting node info");
            final JSONObject nodeInfo =
                    (JSONObject) aocAPI.read("nodes/" + packageInfo.getString("node_id"));

            /*
             * Generate transfer spec
             */
            LOGGER.log(Level.INFO, "Generating transfer spec");
            final String token = aocAPI.getBearerToken(
                    Optional.of("node." + nodeInfo.getString("access_key") + ":user:all"));
            final String cookie = generateCookie("packages", userInfo.getString("name"),
                    userInfo.getString("email"));

            final JSONObject transferSpec =
                    new JSONObject().put("direction", "send").put("token", token)
                            .put("remote_host", nodeInfo.getString("host"))
                            .put("remote_user", "xfer").put("ssh_port", 33001)
                            .put("fasp_port", 33001).put("cookie", cookie).put("create_dir", true)
                            .put("target_rate_kbps", 2000000).put("tags",
                                    new JSONObject().put("aspera", new JSONObject()
                                            .put("app",
                                                    "packages")
                                            .put("files", new JSONObject()
                                                    .put("node_id", nodeInfo.getString("id"))
                                                    .put("package_id", packageInfo.getString("id"))
                                                    .put("package_name",
                                                            packageInfo.getString("name"))
                                                    .put("package_operation", "upload")
                                                    .put("files_transfer_action", "upload_package")
                                                    .put("workspace_name",
                                                            workspaceInfo.getString("name"))
                                                    .put("workspace_id",
                                                            workspaceInfo.getString("id")))
                                            .put("node",
                                                    new JSONObject()
                                                            .put("access_key",
                                                                    nodeInfo.getString(
                                                                            "access_key"))
                                                            .put("file_id",
                                                                    packageInfo.getString(
                                                                            "contents_file_id")))
                                            .put("usage_id",
                                                    "aspera.files.workspace."
                                                            + workspaceInfo.getString("id"))
                                            .put("xfer_retry", 3600)));

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

    private static String generateCookie(String app, String userName, String userId) {
        String encodedApp = Base64.getEncoder().encodeToString(app.getBytes());
        String encodedUserName = Base64.getEncoder().encodeToString(userName.getBytes());
        String encodedUserId = Base64.getEncoder().encodeToString(userId.getBytes());
        return "aspera.aoc:" + encodedApp + ":" + encodedUserName + ":" + encodedUserId;
    }
}
