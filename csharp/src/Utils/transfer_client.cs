using Grpc.Net.Client;
using Newtonsoft.Json.Linq;
public class TransferClient
{
    private const string TRANSFER_SDK_DAEMON = "asperatransferd";
    private Configuration _config;
    private System.Diagnostics.Process mTransferDaemonProcess = null;
    private Transfersdk.TransferService.TransferServiceClient mSdkClient = null;
    private bool mShutdownAfterTransfer = true;
    private List<StreamWriter> mStreams = new List<StreamWriter>();


    public TransferClient(Configuration config)
    {
        _config = config;
    }

    private int AscpLevel(string level)
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
                var binFolder = _config.GetPath("sdk_runtime");
                var configData = new
                {
                    address = grpcUrl.Host,
                    port = grpcUrl.Port,
                    log_directory = Path.GetTempPath(),
                    log_level = _config.GetParam("trsdk", "level"),
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
                            level = AscpLevel(_config.GetParam("trsdk", "ascp_level")),
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
            StartDaemon(_config.GetParam("trsdk", "url"));
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
}
