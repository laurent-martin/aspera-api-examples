// Laurent Martin IBM Aspera 2018
// Sample to call Aspera On Cloud (AoC) API using .NET
using Newtonsoft.Json.Linq;

class SampleAoc
{
    public static void start()
    {
        var test_env = new TestEnvironment();
        var aoc_config = test_env.mConfig["aoc"];
        Log.log.Debug("aoc saas");
        Rest aoc_api = new Rest(new Dictionary<string, string>(){
            {"base_url","https://api.ibmaspera.com/api/v1"},
            {"type","oauth2"},
            {"oauth_type","jwt"},
            {"oauth_file_private_key",aoc_config["private_key"]},
            {"oauth_client_id",aoc_config["client_id"]},
            {"oauth_client_secret",aoc_config["client_secret"]},
            {"oauth_jwt_subject",aoc_config["user_email"]},
            {"oauth_jwt_audience","https://api.asperafiles.com/api/v1/oauth2/token"},
            {"oauth_base_url","https://api.ibmaspera.com/api/v1/oauth2/" + aoc_config["org"]},
            {"oauth_path_token","token"},
            {"oauth_scope","user:all"},
            {"aoc_org",aoc_config["org"]},
        });
        // REST call
        var self_data = aoc_api.read("self");
        Log.DumpJObject("self_data",self_data);
        // we use the default workspace of the user
        string default_workspace_id = (string)(self_data["data"]["default_workspace_id"]);
        // this user must be registered, else different code is needed
        string recipient_email = aoc_config["user_email"];
        // find recipient information
        var user_lookup = aoc_api.read("contacts", new JObject{
                    {"current_workspace_id",default_workspace_id},
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
        var the_package = aoc_api.create("packages", new JObject{
            {"workspace_id",default_workspace_id},
            {"name","my package"},
            {"file_names",new JArray{"/file"}},
            {"note","my note"},
            {"recipients",recipient_list},
        })["data"];
        // validate package once files have been put inside. This triggers email emission
        aoc_api.update("packages/" + the_package["id"], new JObject{
            { "sent",true},
            { "transfers_expected",0}
        });
    }
}
