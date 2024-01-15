using Newtonsoft.Json.Linq;

class SampleServerUpload
{
    public static void start(string[] files)
    {
        Log.log.Debug("server upload");
        var test_env = new TestEnvironment();
        var server_conf = test_env.mConfig["server"];
        var fasp_url = new Uri(server_conf["url"]);
        var t_spec = new JObject{
                {"title", "server upload V1"},
                {"remote_host", fasp_url.Host},
                {"ssh_port", fasp_url.Port},
                {"remote_user", server_conf["user"]},
                {"remote_password", server_conf["pass"]},
                {"direction", "send"},
                {"destination_root", test_env.mConfig["server_paths"]["folder_upload"]}};
        // add file list in transfer spec
        var paths = new JArray();
        foreach (string f in files)
        {
            paths.Add(new JObject { { "source", f } });
        }
        t_spec["paths"] = paths;
        test_env.StartTransferAndWait(t_spec);
    }
}
