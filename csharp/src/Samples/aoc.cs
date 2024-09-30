// Laurent Martin IBM Aspera 2018
// Sample to call Aspera On Cloud (AoC) API using .NET
using Newtonsoft.Json.Linq;

class Aoc : SampleInterface
{
    int transfer_sessions = 1;

    public void start(string[] args)
    {
        var config = new Configuration(args);
        var transfer_client = new TransferClient(config);
        Log.log.Debug("aoc saas");
        Rest aoc_api = new Rest(new Dictionary<string, string>(){
            {"base_url","https://api.ibmaspera.com/api/v1"},
            {"type","oauth2"},
            {"oauth_type","jwt"},
            {"oauth_file_private_key",config.GetParam("aoc","private_key")},
            {"oauth_client_id",config.GetParam("aoc","client_id")},
            {"oauth_client_secret",config.GetParam("aoc","client_secret")},
            {"oauth_jwt_subject",config.GetParam("aoc","user_email")},
            {"oauth_jwt_audience","https://api.asperafiles.com/api/v1/oauth2/token"},
            {"oauth_base_url",$"https://api.ibmaspera.com/api/v1/oauth2/{config.GetParam("aoc","org")}"},
            {"oauth_path_token","token"},
            {"oauth_scope","user:all"},
            {"aoc_org",config.GetParam("aoc","org")},
        });
        // REST call
        var self_data = aoc_api.read("self");
        Log.DumpJObject("self_data", self_data);
        // we use the default workspace of the user
        string default_workspace_id = (string)(self_data["data"]["default_workspace_id"]);
        var workspace_info = aoc_api.read($"workspaces/{default_workspace_id}")["data"];
        // this user must be registered, else different code is needed
        string recipient_email = config.GetParam("aoc","user_email");
        // find recipient information
        var user_lookup = aoc_api.read("contacts", new JObject{
                    {"current_workspace_id",workspace_info["id"]},
                    {"q",recipient_email},
                });
        // hopefully we get only one user result
        var recipient_user_id = ((JArray)user_lookup["data"])[0];
        // build list of recipient (list of hash)
        var recipient_list = new JArray{new JObject{
            {"id",recipient_user_id["source_id"]},
            {"type",recipient_user_id["source_type"]},
        }};
        // create package container
        var package_info = aoc_api.create("packages", new JObject{
            {"workspace_id",workspace_info["id"]},
            {"name","my package"},
            {"file_names",new JArray{"/file"}},
            {"note","my note"},
            {"recipients",recipient_list},
        })["data"];
        var node_info = aoc_api.read($"nodes/{package_info["node_id"]}")["data"];
        // validate package once files have been put inside. This triggers email emission
        aoc_api.update($"packages/{package_info["id"]}", new JObject{
            { "sent",true},
            { "transfers_expected",0}
        });
        // Note: generate a bearer token for the node on which package was created
        // (all tags are not mandatory, but some are, like 'node')
        var t_spec = new JObject{
            {"direction", "send"},
            {"paths", new JArray()},
            {"token", aoc_api.get_bearer($"node.{node_info["access_key"]}:user:all" )},
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
                    {"xfer_id", System.Guid.NewGuid().ToString()},
                    {"xfer_retry", 3600}}}}},
            {"remote_user", "xfer"},
            {"ssh_port", 33001},
            {"fasp_port", 33001},
            {"remote_host", node_info["host"]},
            // 'cookie': 'aspera.aoc:cGFja2FnZXM=:TGF1cmVudCBNYXJ0aW4=:bGF1cmVudC5tYXJ0aW4uYXNwZXJhQGZyLmlibS5jb20=',
            {"create_dir", true},
            {"target_rate_kbps", 2000000},
        };
        if (transfer_sessions != 1)
        {
            t_spec["multi_session"] = transfer_sessions;
            t_spec["multi_session_threshold"] = 500000;
        }
        // add file list in transfer spec
        config.AddFilesToTransferSpec(t_spec);
        // Finally send files to package folder on server
        transfer_client.StartTransferAndWait(t_spec);
    }
}
