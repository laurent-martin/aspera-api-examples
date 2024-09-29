//using Transfersdk;
using Grpc.Net.Client;
using Newtonsoft.Json.Linq;
using System;
using System.IO;
using System.Text;

class Log
{
    public static readonly log4net.ILog log = log4net.LogManager.GetLogger(typeof(Log));
    public static void DumpJObject(string name, Object value)
    {
        log.Debug($"{name}={Newtonsoft.Json.JsonConvert.SerializeObject(value, Newtonsoft.Json.Formatting.Indented)}");
    }
}
/// <summary>
/// Interface for sample classes
/// </summary>
interface SampleInterface
{
    void start(string[] files);
}
public class Configuration
{
    private string[] _fileList;
    // general test configuration parameters
    private Dictionary<string, Dictionary<string, string>> _config;
    // general path structure
    private Dictionary<string, string> mPaths;
    private string mErrorHint;
    private string mTopFolder;
    private System.Diagnostics.Process mTransferDaemonProcess = null;
    private Transfersdk.TransferService.TransferServiceClient mSdkClient = null;
    private bool mShutdownAfterTransfer = true;
    private List<StreamWriter> mStreams = new List<StreamWriter>();

    // config file with sub-paths in project's root folder
    private const string PATHS_FILE_REL = "config/paths.yaml";
    private const string TRANSFER_SDK_DAEMON = "asperatransferd";

    /// <summary>
    /// Get absolute path for the named folder from configuration file
    /// </summary>
    /// <param name="name">name of configuration</param>
    /// <returns>absolute path for the named folder from configuration file</returns>
    /// <exception cref="Exception">if file does not exists</exception>
    string GetPath(string name)
    {
        // Get configuration sub-path in project's root folder
        var itemPath = Path.Combine(mTopFolder, mPaths[name]);
        if (!Directory.Exists(itemPath))
        {
            throw new Exception($"ERROR: {itemPath} not found.{mErrorHint}");
        }
        return itemPath;
    }
    public string GetParam(string section, string key)
    {
        if (!_config.ContainsKey(section) || !_config[section].ContainsKey(key))
        {
            throw new Exception($"ERROR: {section}.{key} not found in configuration file.{mErrorHint}");
        }
        return _config[section][key];
    }
    public void AddFilesToTransferSpec(JObject aSpecObj)
    {
        // add file list in transfer spec
        foreach (string f in _fileList)
        {
            ((JArray)aSpecObj["paths"]).Add(new JObject { { "source", f } });
        }
    }
    public Configuration(string[] args)
    {
        _fileList = args;
        // init logger
        log4net.Config.BasicConfigurator.Configure();
        // get project root folder
        mTopFolder = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), ".."));

        // read project's relative paths config file
        using (var reader = new StreamReader(Path.Combine(mTopFolder, PATHS_FILE_REL)))
        {
            mPaths = new YamlDotNet.Serialization.DeserializerBuilder()
                .WithNamingConvention(YamlDotNet.Serialization.NamingConventions.CamelCaseNamingConvention.Instance)
                .Build().Deserialize<Dictionary<string, string>>(reader);
        }

        // Error hint to help user fix the issue
        mErrorHint = $"\nPlease check: SDK installed in {mPaths["sdk_runtime"]}, configuration file: {mPaths["main_config"]}";
        // Read configuration from configuration file
        using (var reader = new StreamReader(Path.Combine(mTopFolder, mPaths["main_config"])))
        {
            _config = new YamlDotNet.Serialization.DeserializerBuilder()
                .WithNamingConvention(YamlDotNet.Serialization.NamingConventions.CamelCaseNamingConvention.Instance)
                .Build().Deserialize<Dictionary<string, Dictionary<string, string>>>(reader);
        }
    }
    // capture stdout or stderr for the started process (asperatransferd)
    public System.Diagnostics.DataReceivedEventHandler captureStream(string tmpFileBase, string type)
    {
        var logFile = $"{tmpFileBase}.{type}";
        Console.WriteLine($"std{type}: {logFile}");
        var logStream = new StreamWriter(new FileStream(logFile, FileMode.Append, FileAccess.Write));
        logStream.WriteLine($"Starting new {type} log");
        mStreams.Add(logStream);
        return new System.Diagnostics.DataReceivedEventHandler(
            (sender, e) =>
            {
                if (!String.IsNullOrEmpty(e.Data))
                {
                    logStream.WriteLine(e.Data);
                }
            });
    }
    // Start transfer manager daemon if not already running and return gRPC client
    public void StartDaemon(string sdkGrpcUrl)
    {
        var confUrl = new Uri(sdkGrpcUrl);
        var grpcUrl = new Uri($"http://{confUrl.Host}:{confUrl.Port}");
        AppContext.SetSwitch("System.Net.Http.SocketsHttpHandler.Http2UnencryptedSupport", true);
        var client = new Transfersdk.TransferService.TransferServiceClient(GrpcChannel.ForAddress(grpcUrl));

        for (int i = 0; i < 2 && mSdkClient == null; i++)
        {
            try
            {
                Console.WriteLine($"Connecting to {TRANSFER_SDK_DAEMON} using gRPC: {grpcUrl.Host} {grpcUrl.Port}...");
                client.GetAPIVersion(new Transfersdk.APIVersionRequest());
                Console.WriteLine("SUCCESS: connected");
                mSdkClient = client;
            }
            catch (Exception)
            {
                Console.WriteLine("ERROR: Failed to connect\nStarting daemon...");
                var binFolder = GetPath("sdk_runtime");
                string ascp_level = _config["trsdk"]["ascp_level"];
                int ascp_int_level = -1;
                if (ascp_level == "info")
                {
                    ascp_int_level = 0;
                }
                else if (ascp_level == "debug")
                {
                    ascp_int_level = 1;
                }
                else if (ascp_level == "trace")
                {
                    ascp_int_level = 2;
                }
                else
                {
                    throw new ArgumentException("Invalid ascp_level: " + ascp_level);
                }
                var configData = new
                {
                    address = grpcUrl.Host,
                    port = grpcUrl.Port,
                    log_directory = Path.GetTempPath(),
                    log_level = _config["trsdk"]["level"],
                    fasp_runtime = new
                    {
                        use_embedded = false,
                        user_defined = new
                        {
                            bin = binFolder,
                            etc = binFolder,
                        },
                        log = new
                        {
                            dir = Path.GetTempPath(),
                            level = ascp_int_level,
                        },
                    },
                };

                var tmpFileBase = Path.Combine(Path.GetTempPath(), "daemon");
                var confFile = tmpFileBase + ".conf";
                File.WriteAllText(confFile, Newtonsoft.Json.JsonConvert.SerializeObject(configData));
                var exec_full_path = Path.Combine(binFolder, TRANSFER_SDK_DAEMON);
                var exec_args = $"--config {confFile}";
                var command = $"{exec_full_path} {exec_args}";
                Thread.Sleep(1000);
                Console.WriteLine($"Starting: {command}");
                mTransferDaemonProcess = new System.Diagnostics.Process
                {
                    StartInfo = new System.Diagnostics.ProcessStartInfo
                    {
                        FileName = exec_full_path,
                        Arguments = exec_args,
                        RedirectStandardInput = true,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                        UseShellExecute = false,
                        CreateNoWindow = true,
                    }
                };
                mTransferDaemonProcess.OutputDataReceived += captureStream(tmpFileBase, "out");
                mTransferDaemonProcess.ErrorDataReceived += captureStream(tmpFileBase, "err");
                mTransferDaemonProcess.Start();

                // wait for daemon to be ready
                Thread.Sleep(5000);
            }
        }

        if (mSdkClient == null)
        {
            Console.WriteLine("ERROR: daemon not started or cannot be started.\nCheck the logs: daemon.err and daemon.out (see paths above).");
            Environment.Exit(1);
        }
        if (mTransferDaemonProcess != null)
        {
            mTransferDaemonProcess.BeginOutputReadLine();
            mTransferDaemonProcess.BeginErrorReadLine();
        }
    }

    public static string LastFileLine(string filename)
    {
        // Open the file in binary mode and seek to the end
        using (var file = new FileStream(filename, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
        {
            if (file.Length == 0)
                throw new InvalidOperationException("File is empty");

            file.Seek(-1, SeekOrigin.End);
            StringBuilder lastLine = new StringBuilder();
            int byteRead;

            // Read bytes in reverse until we encounter a newline or reach the start of the file
            while (file.Position > 0 && (byteRead = file.ReadByte()) != '\n')
            {
                file.Seek(-2, SeekOrigin.Current);
                lastLine.Insert(0, (char)byteRead);
            }

            // Read the last line in case we are already at the start of the file
            if (file.Position == 0)
            {
                file.Seek(0, SeekOrigin.Begin);
                lastLine.Insert(0, (char)file.ReadByte());
            }

            return lastLine.ToString();
        }
    }
    // Start the specified transfer
    // @return transfer id
    // @param aSpecObj transfer specification (JSON Object)
    public string StartTransfer(JObject aSpecObj)
    {
        // Start a transfer and return transfer id
        var transferRequest = new Transfersdk.TransferRequest
        {
            TransferType = Transfersdk.TransferType.FileRegular,
            Config = new Transfersdk.TransferConfig { LogLevel = 2 },
            TransferSpec = Newtonsoft.Json.JsonConvert.SerializeObject(aSpecObj),
        };

        var transferResponse = mSdkClient.StartTransfer(transferRequest);

        if (transferResponse.Status == Transfersdk.TransferStatus.Failed)
        {
            Console.WriteLine($"ERROR: {transferResponse.Error.Description}");
            Environment.Exit(1);
        }

        return transferResponse.TransferId;
    }

    // wait until the specified transfer is finished (completed or failed)
    void WaitTransfer(string aTransferId)
    {
        while (true)
        {
            // check the current state of the transfer
            var queryTransferResponse = mSdkClient.QueryTransfer(new Transfersdk.TransferInfoRequest() { TransferId = aTransferId });
            Console.Out.WriteLine("transfer info " + queryTransferResponse);

            // check transfer status in response, and exit if it's done
            Transfersdk.TransferStatus status = queryTransferResponse.Status;
            if (status == Transfersdk.TransferStatus.Failed || status == Transfersdk.TransferStatus.Completed)
            {
                Console.Out.WriteLine("finished " + status);
                break;
            }
            // wait a second before checking again
            System.Threading.Thread.Sleep(1000);
        }
    }

    // Shutdown transfer manager daemon, if needed
    public void Shutdown()
    {
        // Shutdown transfer manager daemon, if needed
        if (mTransferDaemonProcess != null)
        {
            Console.WriteLine("Stopping Transfer daemon...");
            mTransferDaemonProcess.Kill();
            mTransferDaemonProcess.WaitForExit();
            mTransferDaemonProcess = null;
            Console.WriteLine("Transfer daemon has been terminated.");
            foreach (var stream in mStreams)
            {
                stream.Close();
            }
        }
        else
        {
            Console.WriteLine("Transfer daemon not started by this process or already terminated.");
        }
    }

    // One-call simplified procedure to start daemon, transfer, and wait for it to finish
    // @param aSpecObj transfer specification (JSON Object)
    public void StartTransferAndWait(JObject aSpecObj)
    {
        // One-call simplified procedure to start daemon, transfer, and wait for it to finish
        if (mSdkClient == null)
        {
            StartDaemon(_config["trsdk"]["url"]);
        }

        //aSpecObj.HttpFallback = false; // TODO: remove when transfer SDK bug fixed
        Console.WriteLine(aSpecObj); // Logging transfer specification
        try
        {
            var aTransferId = StartTransfer(aSpecObj);
            WaitTransfer(aTransferId);
        }
        finally
        {
            if (mShutdownAfterTransfer)
            {
                Shutdown();
            }
        }
    }
}
