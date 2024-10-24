using Newtonsoft.Json.Linq;

class Server : SampleInterface
{
    public void start(string[] args)
    {
        var config = new Configuration(args);
        var transfer_client = new TransferClient(config);
        try
        {
            var fasp_url = new Uri(config.GetParam("server", "url"));
            var t_spec = new JObject{
                {"title", "server upload V1"},
                {"remote_host", fasp_url.Host},
                {"ssh_port", fasp_url.Port},
                {"remote_user", config.GetParam("server","username")},
                {"remote_password", config.GetParam("server","password")},
                {"direction", "send"},
                {"destination_root", config.GetParam("server","folder_upload")},
                {"paths", new JArray()},
            };
            // add file list in transfer spec
            config.AddSources(t_spec, "paths");
            transfer_client.StartTransferAndWait(t_spec);
        }
        finally
        {
            transfer_client.Shutdown();
        }
    }
}
