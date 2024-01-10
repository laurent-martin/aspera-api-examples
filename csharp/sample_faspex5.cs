
class SampleFaspex5
{
    public static void start()
    {
        var f5_config = TestEnvironment.readConfig()["faspex5"];
        Log.log.Debug("faspex 5");
        Rest f5_api = new Rest(new Dictionary<string, string>(){
            {"base_url",f5_config["url"]+ "/api/v5"},
            {"type","oauth2"},
            {"oauth_type","jwt"},
            {"oauth_file_private_key",f5_config["private_key"]},
            {"oauth_client_id",f5_config["client_id"]},
            {"oauth_client_secret",f5_config["client_secret"]},
            {"oauth_jwt_subject","user:"+f5_config["username"]},
            {"oauth_jwt_audience",f5_config["client_id"]},
            {"oauth_base_url",f5_config["url"]+ "/auth"},
            {"oauth_path_token","token"},
        });
        var user_profile = f5_api.read("account/preferences");
        Log.DebugStruct(user_profile);
    }
}
