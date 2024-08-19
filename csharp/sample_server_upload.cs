using Newtonsoft.Json.Linq;

class SampleServerUpload : SampleInterface
{
    public void start(string[] files)
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
            {"destination_root", server_conf["folder_upload"]},
            {"paths", new JArray()},
        };
        // add file list in transfer spec
        foreach (string f in files)
        {
            ((JArray)t_spec["paths"]).Add(new JObject { { "source", f } });
        }
        test_env.StartTransferAndWait(t_spec);
    }
}
