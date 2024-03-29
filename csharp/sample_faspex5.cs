using Newtonsoft.Json.Linq;

class SampleFaspex5: SampleInterface
{
    public void start(string[] files)
    {
        var test_env = new TestEnvironment();
        var config = test_env.mConfig["faspex5"];
        int transfer_sessions = 1;
        Log.log.Debug("faspex 5");
        Rest f5_api = new Rest(new Dictionary<string, string>(){
            {"base_url",config["url"]+ "/api/v5"},
            {"type","oauth2"},
            {"oauth_type","jwt"},
            {"oauth_file_private_key",config["private_key"]},
            {"oauth_client_id",config["client_id"]},
            {"oauth_client_secret",config["client_secret"]},
            {"oauth_jwt_subject","user:"+config["username"]},
            {"oauth_jwt_audience",config["client_id"]},
            {"oauth_base_url",config["url"]+ "/auth"},
            {"oauth_path_token","token"},
        });
        var user_profile = f5_api.read("account/preferences");
        Log.log.Debug($"user_profile: {user_profile}");
        Log.DumpJObject("user_profile", user_profile);
        // Faspex 5 package creation information
        var package_creation = new JObject{
            {"title","test title"},
            {"recipients",new JArray{new JObject{{"name",config["username"]}}}}, // send to myself (for test)
        };
        // create a new package with Faspex 5 API (this allocates a reception folder on package storage)
        var package_info = f5_api.create("packages", package_creation)["data"];
        Log.DumpJObject("package_info", package_info);
        // build payload to specify files to send
        var files_to_send = new JObject { { "paths", new JArray() } };
        // add file list in transfer spec
        foreach (string f in files)
        {
            ((JArray)files_to_send["paths"]).Add(new JObject { { "source", f } });
        }
        var t_spec = f5_api.create($"packages/{package_info["id"]}/transfer_spec/upload?transfer_type=connect", files_to_send)["data"];
        Log.DumpJObject("t_spec", t_spec);
        // optional: multi session
        if (transfer_sessions != 1)
        {
            t_spec["multi_session"] = transfer_sessions;
            t_spec["multi_session_threshold"] = 500000;
        }
        // add file list in transfer spec
        t_spec["paths"] = files_to_send["paths"];
        // Finally send files to package folder on server
        test_env.StartTransferAndWait((JObject)t_spec);
    }
}
