// Laurent Martin IBM Aspera 2018
// Sample to call Aspera On Cloud (AoC) API using .NET
using ObjectDict = System.Collections.Generic.Dictionary<string, object>;
using StringDict = System.Collections.Generic.Dictionary<string, string>;

class SampleAoc
{
    public static void start()
    {
        StringDict aoc_config = TestEnvironment.readConfig()["aoc"];
        Log.log.Debug("aoc saas");
        // configuration: organizational user's specific information
        var api_data = new StringDict(){
            {"base_url","https://api.ibmaspera.com/api/v1"},
            {"aoc_org",aoc_config["org"]},
            {"type","oauth2"},
            {"oauth_type","jwt"},
            {"oauth_scope","user:all"},
            {"oauth_file_private_key",aoc_config["private_key"]},
            {"oauth_client_id",aoc_config["client_id"]},
            {"oauth_client_secret",aoc_config["client_secret"]},
            {"oauth_jwt_subject",aoc_config["user_email"]},
            {"oauth_base_url","https://api.ibmaspera.com/api/v1/oauth2/" + aoc_config["org"]},
            {"oauth_jwt_audience","https://api.asperafiles.com/api/v1/oauth2/token"},
            {"oauth_path_token","token"},
        };
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
        aoc_api.update("packages/" + the_package["id"], new ObjectDict()
    {
        { "sent",true},
            { "transfers_expected",0}
    });
    }
}
