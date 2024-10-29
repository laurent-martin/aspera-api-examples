using Grpc.Net.Client;
using Newtonsoft.Json.Linq;
public class TransferClient
{
    private const string TRANSFER_SDK_DAEMON = "asperatransferd";
    private const string DAEMON_LOG_FILE = "asperatransferd.log";
    private const string ASCP_LOG_FILE = "aspera-scp-transfer.log";
    private Configuration _config;
    private System.Diagnostics.Process mTransferDaemonProcess = null;
    private Transfersdk.TransferService.TransferServiceClient mSdkClient = null;
    private List<StreamWriter> mStreams = new List<StreamWriter>();
    private string _daemonPath;
    private string _serverAddress;
    private int _serverPort;
    private string _daemonLog;


    public TransferClient(Configuration config)
    {
        _config = config;
        _daemonPath = _config.GetPath("sdk_daemon");
        var confUrl = new Uri(_config.GetParam("trsdk", "url"));
        _serverAddress = confUrl.Host;
        _serverPort = confUrl.Port;
        _daemonLog = Path.Combine(_config.LogFolder(), DAEMON_LOG_FILE);
    }

    public void CreateConfigFile(string confFile)
    {
        var configInfo = new
        {
            address = _serverAddress,
            port = _serverPort,
            log_directory = _config.LogFolder(),
            log_level = _config.GetParam("trsdk", "level"),
            fasp_runtime = new
            {
                use_embedded = true,
                log = new
                {
                    dir = _config.LogFolder(),
                    level = AscpLevel(_config.GetParam("trsdk", "ascp_level")),
                },
            },
        };
        File.WriteAllText(confFile, Newtonsoft.Json.JsonConvert.SerializeObject(configInfo));
    }

    // Start transfer manager daemon if not already running and return gRPC client
    public void StartDaemon()
    {

        Log.log.Info("ERROR: Failed to connect\nStarting daemon...");

        var fileBase = Path.Combine(_config.LogFolder(), TRANSFER_SDK_DAEMON);
        var confFile = fileBase + ".conf";
        var outFile = fileBase + ".out";
        var errFile = fileBase + ".err";
        var exec_args = $"--config {confFile}";
        var command = $"{_daemonPath} {exec_args}";
        Log.log.Debug($"daemon out: {outFile}");
        Log.log.Debug($"daemon err: {errFile}");
        Log.log.Debug($"daemon log: {_daemonLog}");
        Log.log.Debug($"ascp log: {Path.Combine(_config.LogFolder(), ASCP_LOG_FILE)}");
        Log.log.Debug($"command: {command}");
        CreateConfigFile(confFile);
        Log.log.Info("Starting daemon...");
        mTransferDaemonProcess = new System.Diagnostics.Process
        {
            StartInfo = new System.Diagnostics.ProcessStartInfo
            {
                FileName = _daemonPath,
                Arguments = exec_args,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            }
        };
        mTransferDaemonProcess.OutputDataReceived += captureStream(outFile);
        mTransferDaemonProcess.ErrorDataReceived += captureStream(errFile);
        mTransferDaemonProcess.Start();
        // wait for daemon to be ready
        Thread.Sleep(2000);
        if (mTransferDaemonProcess.HasExited)
        {
            Log.log.Error($"Daemon not started.");
            Log.log.Error($"Exited with code: {mTransferDaemonProcess.ExitCode}");
            Log.log.Error($"Check daemon log: {_daemonLog}");
            mTransferDaemonProcess.WaitForExit();
            mTransferDaemonProcess = null;
            //logging.error(utils.configuration.last_file_line(self._daemon_log));
            throw new Exception("daemon startup failed");
        }
        mTransferDaemonProcess.BeginOutputReadLine();
        mTransferDaemonProcess.BeginErrorReadLine();
    }
    public void ConnectToDaemon()
    {
        AppContext.SetSwitch("System.Net.Http.SocketsHttpHandler.Http2UnencryptedSupport", true);
        var grpcUrl = new Uri($"http://{_serverAddress}:{_serverPort}");
        Log.log.Info($"Connecting to {TRANSFER_SDK_DAEMON} on {grpcUrl} ...");
        mSdkClient = new Transfersdk.TransferService.TransferServiceClient(GrpcChannel.ForAddress(grpcUrl));
        mSdkClient.GetAPIVersion(new Transfersdk.APIVersionRequest());
        Log.log.Info("Connected !");
    }
    public void Startup()
    {
        if (mSdkClient == null)
        {
            StartDaemon();
            ConnectToDaemon();
        }
    }
    // Shutdown transfer manager daemon, if needed
    public void Shutdown()
    {
        mSdkClient = null;
        // Shutdown transfer manager daemon, if needed
        if (mTransferDaemonProcess != null)
        {
            Log.log.Info("Stopping Transfer daemon...");
            mTransferDaemonProcess.Kill();
            mTransferDaemonProcess.WaitForExit();
            mTransferDaemonProcess = null;
            Log.log.Info("Transfer daemon has been terminated.");
            foreach (var stream in mStreams)
            {
                stream.Close();
            }
        }
    }

    // Start the specified transfer
    // @return transfer id
    // @param aSpecObj transfer specification (JSON Object)
    public string StartTransfer(JObject aSpecObj)
    {
        Log.log.Info(aSpecObj);
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
            Log.log.Info($"ERROR: {transferResponse.Error.Description}");
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


    // One-call simplified procedure to start daemon, transfer, and wait for it to finish
    // @param aSpecObj transfer specification (JSON Object)
    public void StartTransferAndWait(JObject aSpecObj)
    {
        Startup();
        WaitTransfer(StartTransfer(aSpecObj));
    }
    // capture stdout or stderr for the started process (asperatransferd)
    public System.Diagnostics.DataReceivedEventHandler captureStream(string logFile)
    {
        var logStream = new StreamWriter(new FileStream(logFile, FileMode.Append, FileAccess.Write));
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
    private static int AscpLevel(string level)
    {
        if (level == "info")
        {
            return 0;
        }
        else if (level == "debug")
        {
            return 1;
        }
        else if (level == "trace")
        {
            return 2;
        }
        else
        {
            throw new ArgumentException("Invalid ascp_level: " + level);
        }
    }
}
