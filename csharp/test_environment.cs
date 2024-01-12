//using Transfersdk;
using Grpc.Net.Client;
using Newtonsoft.Json.Linq;

class Log
{
    public static readonly log4net.ILog log = log4net.LogManager.GetLogger(typeof(Log));
    public static void DumpJObject(string name, JObject value)
    {
        log.Debug($"{name}={Newtonsoft.Json.JsonConvert.SerializeObject(value, Newtonsoft.Json.Formatting.Indented)}");
    }
}

public class TestEnvironment
{
    public Dictionary<string, Dictionary<string, string>> mConfig;
    Dictionary<string, string> mPaths;
    string errorHint;
    string topFolder;
    System.Diagnostics.Process transferDaemonProcess = null;
    Transfersdk.TransferService.TransferServiceClient sdkClient = null;
    bool shutdownAfterTransfer = true;

    // config file with sub-paths in project's root folder
    const string pathsFile = "config/paths.yaml";
    const string sdkDaemonExecutable = "asperatransferd";

    string GetPath(string name)
    {
        // Get configuration sub-path in project's root folder
        var itemPath = Path.Combine(topFolder, mPaths[name]);
        if (!Directory.Exists(itemPath))
        {
            throw new Exception($"ERROR: {itemPath} not found.{errorHint}");
        }
        return itemPath;
    }
    public TestEnvironment()
    {
        // init logger
        log4net.Config.BasicConfigurator.Configure();
        // get project root folder
        topFolder = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), ".."));

        // read project's relative paths config file
        using (var reader = new StreamReader(Path.Combine(topFolder, pathsFile)))
        {
            mPaths = new YamlDotNet.Serialization.DeserializerBuilder()
                .WithNamingConvention(YamlDotNet.Serialization.NamingConventions.CamelCaseNamingConvention.Instance)
                .Build().Deserialize<Dictionary<string, string>>(reader);
        }

        // Error hint to help user fix the issue
        errorHint = $"\nPlease check: SDK installed in {mPaths["sdk_root"]}, configuration file: {mPaths["main_config"]}";
        // Read configuration from configuration file
        using (var reader = new StreamReader(Path.Combine(topFolder, mPaths["main_config"])))
        {
            mConfig = new YamlDotNet.Serialization.DeserializerBuilder()
                .WithNamingConvention(YamlDotNet.Serialization.NamingConventions.CamelCaseNamingConvention.Instance)
                .Build().Deserialize<Dictionary<string, Dictionary<string, string>>>(reader);
        }
        // Set logger for debugging
        //Grpc.Core.GrpcEnvironment.SetLogger(Log.log);


    }
    async Task StartDaemon(string sdkGrpcUrl)
    {
        // Start transfer manager daemon if not already running and return gRPC client
        //GrpcEnvironment.SetEnvironment(new ChannelOption[] { new ChannelOption("GRPC_ENABLE_FORK_SUPPORT", "false") });
        var grpcUrl = new Uri(sdkGrpcUrl);
        var channel = GrpcChannel.ForAddress(grpcUrl);
        var client = new Transfersdk.TransferService.TransferServiceClient(channel);

        for (int i = 0; i < 2; i++)
        {
            try
            {
                Console.WriteLine($"Connecting to {sdkDaemonExecutable} using gRPC: {grpcUrl.Host} {grpcUrl.Port}...");
                //await client.Channel.ReadyAsync(DateTime.UtcNow.AddSeconds(3));
                Console.WriteLine("SUCCESS: connected");
                sdkClient = client;
            }
            catch (Exception)
            {
                Console.WriteLine("ERROR: Failed to connect\nStarting daemon...");

                var binFolder = mPaths["sdk_root"];
                var configData = new
                {
                    address = grpcUrl.Host,
                    port = grpcUrl.Port,
                    log_directory = Path.GetTempPath(),
                    log_level = "debug",
                    fasp_runtime = new
                    {
                        use_embedded = false,
                        user_defined = new
                        {
                            bin = binFolder,
                            etc = GetPath("TrsdkNoarch"),
                        },
                        log = new
                        {
                            dir = Path.GetTempPath(),
                            level = 0,
                        },
                    },
                };

                var tmpFileBase = Path.Combine(Path.GetTempPath(), "daemon");
                var confFile = tmpFileBase + ".conf";
                await File.WriteAllTextAsync(confFile, Newtonsoft.Json.JsonConvert.SerializeObject(configData));

                var command = $"{Path.Combine(binFolder, sdkDaemonExecutable)} --config {confFile}";
                var outFile = tmpFileBase + ".out";
                var errFile = tmpFileBase + ".err";

                await Task.Delay(1000);
                Console.WriteLine($"Starting: {command}");
                Console.WriteLine($"stderr: {errFile}");
                Console.WriteLine($"stdout: {outFile}");

                var psi = new System.Diagnostics.ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    RedirectStandardInput = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    Arguments = $"/c {command}",
                };

                transferDaemonProcess = new System.Diagnostics.Process
                {
                    StartInfo = psi,
                };

                transferDaemonProcess.Start();
                await Task.Delay(5000);
            }

            if (sdkClient != null)
            {
                break;
            }
        }

        if (sdkClient == null)
        {
            Console.WriteLine("ERROR: daemon not started or cannot be started.\nCheck the logs: daemon.err and daemon.out (see paths above).");
            Environment.Exit(1);
        }
    }

    async Task<string> StartTransfer(string transferSpec)
    {
        // Start a transfer and return transfer id
        var transferRequest = new Transfersdk.TransferRequest
        {
            TransferType = Transfersdk.TransferType.FileRegular,
            Config = new Transfersdk.TransferConfig(),
            TransferSpec = transferSpec,
        };

        var transferResponse = await sdkClient.StartTransferAsync(transferRequest);

        if (transferResponse.Status == Transfersdk.TransferStatus.Failed)
        {
            Console.WriteLine($"ERROR: {transferResponse.Error.Description}");
            Environment.Exit(1);
        }

        return transferResponse.TransferId;
    }

    async Task WaitTransfer(string transferId)
    {
    }

    void Shutdown()
    {
        // Shutdown transfer manager daemon, if needed
        if (transferDaemonProcess != null)
        {
            transferDaemonProcess.Kill();
            transferDaemonProcess.WaitForExit();
            transferDaemonProcess = null;
            Console.WriteLine("Transfer daemon has been terminated");
        }
        else
        {
            Console.WriteLine("Transfer daemon not started by this process, or already terminated");
        }
    }

    public async Task StartTransferAndWait(JObject tSpec)
    {
        // One-call simplified procedure to start daemon, transfer, and wait for it to finish
        if (sdkClient == null)
        {
            //sdkClient = await StartDaemon(mConfig.get('misc').get('trsdk_url'));
        }

        //tSpec.HttpFallback = false; // TODO: remove when transfer SDK bug fixed
        Console.WriteLine(tSpec); // Logging transfer specification
        try
        {
            var transferId = await StartTransfer(Newtonsoft.Json.JsonConvert.SerializeObject(tSpec));
            await WaitTransfer(transferId);
        }
        finally
        {
            if (shutdownAfterTransfer)
            {
                Shutdown();
            }
        }
    }
}
