using Grpc.Net.Client;
using Newtonsoft.Json.Linq;
using System;
using System.IO;
using System.Text.RegularExpressions;
/// <summary>
/// Provides the following services:
/// <list type="bullet">
/// <item>
/// <description>daemon conf file generation, startup and shutdown of transferd</description>
/// </item>
/// <item>
/// <description>transfer of files and monitoring</description>
/// </item>
/// </list>
/// </summary>
public class TransferClient
{
    private const string ASCP_LOG_FILE = "aspera-scp-transfer.log";
    private Configuration _config;
    private string _serverAddress;
    private int _serverPort;
    private System.Diagnostics.Process _daemonProcess = null;
    private List<StreamWriter> _daemonStreams = new List<StreamWriter>();
    private Transferd.Api.TransferService.TransferServiceClient _daemonService = null;
    private string _daemonName;
    private string _daemonLog;


    public TransferClient(Configuration config)
    {
        _config = config;
        var confUrl = new Uri(_config.GetParam("trsdk", "url"));
        _serverAddress = confUrl.Host;
        _serverPort = confUrl.Port;
        _daemonName = Path.GetFileName(_config.GetPath("sdk_daemon"));
        _daemonLog = Path.Combine(_config.LogFolder(), _daemonName + ".log");
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

    /// <summary>
    /// Start transfer manager daemon if not already running and return gRPC client
    /// </summary>
    /// <exception cref="Exception"></exception>
    public void StartDaemon()
    {
        Log.log.Info("ERROR: Failed to connect\nStarting daemon...");
        var daemonPath = _config.GetPath("sdk_daemon");
        var fileBase = Path.Combine(_config.LogFolder(), _daemonName);
        var confFile = fileBase + ".conf";
        var outFile = fileBase + ".out";
        var errFile = fileBase + ".err";
        var exec_args = $"--config {confFile}";
        var command = $"{daemonPath} {exec_args}";
        Log.log.Debug($"daemon out: {outFile}");
        Log.log.Debug($"daemon err: {errFile}");
        Log.log.Debug($"daemon log: {_daemonLog}");
        Log.log.Debug($"ascp log: {Path.Combine(_config.LogFolder(), ASCP_LOG_FILE)}");
        Log.log.Debug($"command: {command}");
        CreateConfigFile(confFile);
        Log.log.Info("Starting daemon...");
        _daemonProcess = new System.Diagnostics.Process
        {
            StartInfo = new System.Diagnostics.ProcessStartInfo
            {
                FileName = daemonPath,
                Arguments = exec_args,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            }
        };
        _daemonProcess.OutputDataReceived += captureStream(outFile);
        _daemonProcess.ErrorDataReceived += captureStream(errFile);
        _daemonProcess.Start();
        // wait for daemon to be ready
        Thread.Sleep(2000);
        if (_daemonProcess.HasExited)
        {
            Log.log.Error($"Daemon not started.");
            Log.log.Error($"Exited with code: {_daemonProcess.ExitCode}");
            Log.log.Error($"Check daemon log: {_daemonLog}");
            _daemonProcess.WaitForExit();
            _daemonProcess = null;
            //logging.error(utils.configuration.last_file_line(self._daemon_log));
            throw new Exception("daemon startup failed");
        }
        _daemonProcess.BeginOutputReadLine();
        _daemonProcess.BeginErrorReadLine();

        if (_serverPort == 0)
        {
            string lastLine = File.ReadLines(_daemonLog).Last();
            JObject logInfo = JObject.Parse(lastLine);
            Match portMatch = Regex.Match(logInfo["msg"]?.ToString() ?? "", @":(\d+)");

            if (!portMatch.Success)
            {
                throw new Exception("Could not read listening port from log file");
            }

            _serverPort = int.Parse(portMatch.Groups[1].Value);
            Log.log.Debug($"Allocated server port: {_serverPort}");
        }
    }
    public void ConnectToDaemon()
    {
        AppContext.SetSwitch("System.Net.Http.SocketsHttpHandler.Http2UnencryptedSupport", true);
        var grpcUrl = new Uri($"http://{_serverAddress}:{_serverPort}");
        Log.log.Info($"Connecting to {_daemonName} on {grpcUrl} ...");
        _daemonService = new Transferd.Api.TransferService.TransferServiceClient(GrpcChannel.ForAddress(grpcUrl));
        _daemonService.GetAPIVersion(new Transferd.Api.APIVersionRequest());
        Log.log.Info("Connected !");
    }
    public void Startup()
    {
        if (_daemonService == null)
        {
            StartDaemon();
            ConnectToDaemon();
        }
    }
    /// <summary>
    /// Shutdown transfer manager daemon, if needed
    /// </summary>
    public void Shutdown()
    {
        _daemonService = null;
        // Shutdown transfer manager daemon, if needed
        if (_daemonProcess != null)
        {
            Log.log.Info("Stopping Transfer daemon...");
            _daemonProcess.Kill();
            _daemonProcess.WaitForExit();
            _daemonProcess = null;
            Log.log.Info("Transfer daemon has been terminated.");
            foreach (var stream in _daemonStreams)
            {
                stream.Close();
            }
        }
    }

    /// <summary>
    /// Start the specified transfer
    /// </summary>
    /// <param name="aSpecObj">transfer specification (JSON Object)</param>
    /// <returns>transfer id</returns>
    public string StartTransfer(JObject aSpecObj)
    {
        Log.log.Info(aSpecObj);
        // Start a transfer and return transfer id
        var transferRequest = new Transferd.Api.TransferRequest
        {
            TransferType = Transferd.Api.TransferType.FileRegular,
            Config = new Transferd.Api.TransferConfig { LogLevel = 2 },
            TransferSpec = Newtonsoft.Json.JsonConvert.SerializeObject(aSpecObj),
        };

        var transferResponse = _daemonService.StartTransfer(transferRequest);

        if (transferResponse.Status == Transferd.Api.TransferStatus.Failed)
        {
            Log.log.Info($"ERROR: {transferResponse.Error.Description}");
            Environment.Exit(1);
        }

        return transferResponse.TransferId;
    }

    /// <summary>
    /// wait until the specified transfer is finished (completed or failed)
    /// </summary>
    /// <param name="aTransferId"></param>
    void WaitTransfer(string aTransferId)
    {
        while (true)
        {
            // check the current state of the transfer
            var queryTransferResponse = _daemonService.QueryTransfer(new Transferd.Api.TransferInfoRequest() { TransferId = aTransferId });
            Console.Out.WriteLine("transfer info " + queryTransferResponse);

            // check transfer status in response, and exit if it's done
            Transferd.Api.TransferStatus status = queryTransferResponse.Status;
            if (status == Transferd.Api.TransferStatus.Failed || status == Transferd.Api.TransferStatus.Completed)
            {
                Console.Out.WriteLine("finished " + status);
                break;
            }
            // wait a second before checking again
            System.Threading.Thread.Sleep(1000);
        }
    }


    /// <summary>
    /// One-call simplified procedure to start daemon, transfer, and wait for it to finish
    /// </summary>
    /// <param name="aSpecObj">transfer specification (JSON Object)</param>
    public void StartTransferAndWait(JObject aSpecObj)
    {
        Startup();
        WaitTransfer(StartTransfer(aSpecObj));
    }
    /// <summary>
    /// Capture stdout or stderr for the started process (transferd)
    /// </summary>
    /// <param name="logFile"></param>
    /// <returns></returns>
    public System.Diagnostics.DataReceivedEventHandler captureStream(string logFile)
    {
        var logStream = new StreamWriter(new FileStream(logFile, FileMode.Append, FileAccess.Write));
        _daemonStreams.Add(logStream);
        return new System.Diagnostics.DataReceivedEventHandler(
            (sender, e) =>
            {
                if (!String.IsNullOrEmpty(e.Data))
                {
                    logStream.WriteLine(e.Data);
                }
            });
    }
    /// <summary>
    /// translates string log level to numerical
    /// </summary>
    /// <param name="level">text level</param>
    /// <returns>numerical value</returns>
    /// <exception cref="ArgumentException"></exception>
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
