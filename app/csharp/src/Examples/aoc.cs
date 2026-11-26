// Laurent Martin IBM Aspera 2018
// Aspera on Cloud
// Send a package to shared inbox (name in config file) in given workspace (name in config file)
using Newtonsoft.Json.Linq;
using StringDict = System.Collections.Generic.Dictionary<string, string>;

/// <summary>
/// Sample: upload files with Aspera on Cloud.
/// </summary>
class Aoc : SampleInterface
{
    // AoC API base URL: https://developer.ibm.com/apis/catalog?search=%22aspera%20on%20cloud%20api%22
    const string AOC_API_V1_BASE_URL = "https://api.ibmaspera.com/api/v1";
    const string AOC_OAUTH_AUDIENCE = "https://api.asperafiles.com/api/v1/oauth2/token";
    // name of package to send
    const string package_name = "sample package C#";
    // number of parallel transfer sessions (typically, 1)
    int transfer_sessions = 1;

    /// <summary>
    /// Generate the transfer cookie of AoC, that identifies the application and the user.
    /// </summary>
    /// <param name="app">AoC application, e.g. <c>packages</c></param>
    /// <param name="user_name">name of the user</param>
    /// <param name="user_id">identifier of the user: email</param>
    /// <returns>cookie</returns>
    static string generate_cookie(string app, string user_name, string user_id)
    {
        string encoded_app = System.Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(app));
        string encoded_user_name = System.Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(user_name));
        string encoded_user_id = System.Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(user_id));
        return $"aspera.aoc:{encoded_app}:{encoded_user_name}:{encoded_user_id}";
    }

    /// <summary>
    /// Execute the sample.
    /// </summary>
    /// <param name="args">files to transfer</param>
    public void start(string[] args)
    {
        var config = new Configuration(args);
        var transfer_client = new TransferClient(config);
        try
        {
            var aoc_api = new Rest(AOC_API_V1_BASE_URL);
            aoc_api.setAuthBearer(new StringDict{
                {"token_url",$"{AOC_API_V1_BASE_URL}/oauth2/{config.GetParam("aoc","org")}/token"},
                {"key_pem_path",config.GetParam("aoc","private_key")},
                {"client_id",config.GetParam("aoc","client_id")},
                {"client_secret",config.GetParam("aoc","client_secret")},
                {"iss",config.GetParam("aoc","client_id")},
                {"aud",AOC_OAUTH_AUDIENCE},
                {"sub",config.GetParam("aoc","user_email")},
                {"org",config.GetParam("aoc","org")},
            });
            aoc_api.setDefaultScope("user:all");

            // get my user information (get my name, etc...)
            Log.log.Info("Getting user information");
            var user_info = aoc_api.read("self");

            // get workspace information
            string workspace_name = config.GetParam("aoc", "workspace");
            Log.log.Info($"Getting workspace: {workspace_name}");
            var response_data = (JArray)aoc_api.read("workspaces", new JObject{
                {"q",workspace_name},
            });
            if (response_data.Count != 1)
            {
                throw new Exception($"Found {response_data.Count} workspaces for {workspace_name}");
            }
            var workspace_info = response_data[0];

            // Get dropbox information (shared inbox name in config file)
            string shared_inbox_name = config.GetParam("aoc", "shared_inbox");
            Log.log.Info($"Getting shared inbox: {shared_inbox_name}");
            response_data = (JArray)aoc_api.read("dropboxes", new JObject{
                {"current_workspace_id",workspace_info["id"]},
                {"q",shared_inbox_name},
            });
            if (response_data.Count != 1)
            {
                throw new Exception($"Found {response_data.Count} shared inboxes for {shared_inbox_name}");
            }
            var dropbox_info = response_data[0];

            // Create a new package (this allocates a reception folder on package storage)
            // `sent` and `transfers_expected` could also be added on a later call with PUT packages/{package_info["id"]}
            Log.log.Info("Creating package");
            var package_info = aoc_api.create("packages", new JObject{
                {"workspace_id",workspace_info["id"]},
                {"recipients",new JArray{new JObject{
                    {"id",dropbox_info["id"]},
                    {"type","dropbox"},
                }}},
                {"name",package_name},
                {"note","My package note"},
                {"sent",true},
                {"transfers_expected",transfer_sessions},
            });

            // get node information for the node on which package must be created
            Log.log.Info("Getting node information");
            var node_info = aoc_api.read($"nodes/{package_info["node_id"]}");

            // Note: generate a bearer token for the node on which package was created
            // tags of the transfer spec:
            // - `node`: mandatory, HSTS authorizes the bearer token for this access key and folder
            // - `app`, `files`: mandatory, AoC links the transfer to the package
            // - `usage_id`, `xfer_retry`: optional
            var t_spec = new JObject{
                {"direction", "send"},
                {"token", aoc_api.get_bearer_token($"node.{node_info["access_key"]}:user:all")},
                {"tags", new JObject{
                    {"aspera", new JObject{
                        {"app", "packages"},
                        {"files", new JObject{
                            {"node_id", node_info["id"]},
                            {"package_id", package_info["id"]},
                            {"package_name", package_info["name"]},
                            {"package_operation", "upload"},
                            {"files_transfer_action", "upload_package"},
                            {"workspace_name", workspace_info["name"]},
                            {"workspace_id", workspace_info["id"]}}},
                        {"node", new JObject{
                            {"access_key", node_info["access_key"]},
                            {"file_id", package_info["contents_file_id"]}}},
                        {"usage_id", $"aspera.files.workspace.{workspace_info["id"]}"},
                        {"xfer_retry", 3600}}}}},
                {"remote_host", node_info["host"]},
                {"remote_user", "xfer"},
                {"ssh_port", 33001},
                {"fasp_port", 33001},
                {"cookie", generate_cookie("packages", (string?)user_info["name"] ?? "", (string?)user_info["email"] ?? "")},
                {"create_dir", true},
                {"target_rate_kbps", 100000},
                {"paths", new JArray()},
            };

            if (transfer_sessions != 1)
            {
                t_spec["multi_session"] = transfer_sessions;
                t_spec["multi_session_threshold"] = 500000;
            }

            // add file list in transfer spec
            config.AddSources(t_spec, "paths");

            // Finally send files to package folder on server
            Log.log.Info("Uploading files");
            transfer_client.StartTransferAndWait(t_spec);
        }
        finally
        {
            transfer_client.Shutdown();
        }
    }
}
