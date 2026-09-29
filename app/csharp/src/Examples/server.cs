using Newtonsoft.Json.Linq;

/// <summary>
/// Sample: upload files with HSTS with SSH credentials.
/// </summary>
class Server : SampleInterface
{
    /// <summary>
    /// Execute the sample.
    /// </summary>
    /// <param name="args">files to transfer</param>
    public void start(string[] args)
    {
        var config = new Configuration(args);
        var transfer_client = new TransferClient(config);
        try
        {
            var fasp_url = new Uri(config.GetParam("server", "url"));
            if (fasp_url.Scheme != "ssh")
            {
                throw new Exception($"Expecting SSH URL: {fasp_url}");
            }
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
            Log.log.Info("Uploading files");
            transfer_client.StartTransferAndWait(t_spec);
        }
        finally
        {
            transfer_client.Shutdown();
        }
    }
}
