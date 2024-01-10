// Laurent Martin IBM Aspera 2018
// Sample to call Aspera On Cloud (AoC) API using .NET
using ObjectDict = System.Collections.Generic.Dictionary<string, object>;
using StringDict = System.Collections.Generic.Dictionary<string, string>;

class SampleAoc
{
    // fill AoC Specific Rest auth information
    static void fillAocRestInfo(string organization, System.Collections.Generic.IDictionary<string, string> api_data)
    {
        string instance_domain = "ibmaspera.com";

        // this is the main API URL
        api_data["base_url"] = "https://api." + instance_domain + "/api/v1";
        api_data["aoc_org"] = organization;

        // specify oauth + JWT
        api_data["type"] = "oauth2";
        api_data["oauth_type"] = "jwt";

        // fill generic oauth info related to AoC API 
        api_data["oauth_base_url"] = api_data["base_url"] + "/oauth2/" + organization;
        api_data["oauth_jwt_audience"] = "https://api.asperafiles.com/api/v1/oauth2/token";
        api_data["oauth_path_authorize"] = "authorize";
        api_data["oauth_path_token"] = "token";
    }
    // Main program , start here
    public static void start()
    {
        StringDict aoc_config = TestEnvironment.readConfig();
        // configuration: organizational user's specific information
        var api_data = new StringDict(){
            {"oauth_file_private_key",aoc_config["private_key"]},
            {"oauth_client_id",aoc_config["client_id"]},
            {"oauth_client_secret",aoc_config["client_secret"]},
            {"oauth_jwt_subject",aoc_config["user_email"]},
        };
        // fill missing info from main info
        fillAocRestInfo(aoc_config["org"], api_data);
        // set API scope
        api_data["oauth_scope"] = "user:all";
        // create REST API object
        Rest aoc_api = new Rest(api_data);
        // Ahhh, first REST call
        var self_data = aoc_api.read("self");
        Log.DebugStruct(self_data);
        // we use the default workspace of the user
        string default_workspace_id = (string)((Newtonsoft.Json.Linq.JContainer)self_data["data"])["default_workspace_id"];
        // this user must be registered, else different code is needed
        string recipient_email = aoc_config["user_email"];
        // find recipient information
        var user_lookup = aoc_api.read("contacts", new ObjectDict(){
                    {"current_workspace_id",default_workspace_id},
                    {"q",recipient_email},
                });
        // hopefully we get only one user result
        var recipient_user_id = ((Newtonsoft.Json.Linq.JArray)user_lookup["data"])[0];
        // build list of recipient (list of hash)
        var recipient_list = new System.Collections.Generic.List<ObjectDict>(){new ObjectDict(){
            {"id",recipient_user_id["source_id"]},
            {"type",recipient_user_id["source_type"]},
        }};
        // create package container
        var the_package = (Newtonsoft.Json.Linq.JObject)aoc_api.create("packages", new ObjectDict(){
            {"workspace_id",default_workspace_id},
            {"name","my package"},
            {"file_names",new System.Collections.Generic.List<string>(){"/file"}},
            {"note","my note"},
            {"recipients",recipient_list},
        })["data"];
        // validate package once files have been put inside. This triggers email emission
        aoc_api.update("packages/" + the_package["id"], new ObjectDict(){
            {"sent",true},
            {"transfers_expected",0}
        });
    }
}
