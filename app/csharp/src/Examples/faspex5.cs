using Newtonsoft.Json.Linq;
using StringDict = System.Collections.Generic.Dictionary<string, string>;

class Faspex5 : SampleInterface
{
    // base path for v5 api
    const string F5_API_PATH_V5 = "/api/v5";
    // path for oauth2 token generation
    const string F5_API_PATH_TOKEN = "/auth/token";

    const string package_name = "sample package C#";
    int transfer_sessions = 1;

    public void start(string[] args)
    {
        var config = new Configuration(args);
        var transfer_client = new TransferClient(config);
        try
        {
            var f5_api = new Rest($"{config.GetParam("faspex5", "url")}{F5_API_PATH_V5}");
            f5_api.setAuthBearer(new StringDict{
                {"token_url",$"{config.GetParam("faspex5", "url")}{F5_API_PATH_TOKEN}"},
                {"key_pem_path",config.GetParam("faspex5","private_key")},
                {"client_id",config.GetParam("faspex5","client_id")},
                {"client_secret",config.GetParam("faspex5","client_secret")},
                {"iss",config.GetParam("faspex5","client_id")},
                {"aud",config.GetParam("faspex5","client_id")},
                {"sub","user:"+config.GetParam("faspex5","username")},
            });
            f5_api.setDefaultScope("user:all");

            var user_profile = f5_api.read("account/preferences");
            Log.log.Debug($"user_profile: {user_profile}");
            Log.DumpJObject("user_profile", user_profile);
            // Faspex 5 package creation information
            var package_creation = new JObject{
                {"title",package_name},
                {"recipients",new JArray{new JObject{{"name",config.GetParam("faspex5","username")}}}}, // send to myself (for test)
            };
            // create a new package with Faspex 5 API (this allocates a reception folder on package storage)
            var package_info = f5_api.create("packages", package_creation);
            Log.DumpJObject("package_info", package_info);
            // build payload to specify files to send
            var files_to_send = new JObject { { "paths", new JArray() } };
            // add file list in transfer spec
            config.AddSources(files_to_send, "paths");
            var t_spec = f5_api.create($"packages/{package_info["id"]}/transfer_spec/upload?transfer_type=connect", files_to_send);
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
            transfer_client.StartTransferAndWait((JObject)t_spec);
        }
        finally
        {
            transfer_client.Shutdown();
        }
    }
}
