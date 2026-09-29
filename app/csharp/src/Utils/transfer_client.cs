using Grpc.Net.Client;
using Newtonsoft.Json.Linq;
using System;
using System.Globalization;
using System.IO;
using System.Text.RegularExpressions;
/// <summary>
/// Client of the Aspera Transfer Daemon (transferd): start the daemon, start transfers and wait for their end.
/// </summary>
public class TransferClient
{
    private const string ASCP_LOG_FILE = "aspera-scp-transfer.log";
    // default port of transferd if not specified in URL
    private const int TRANSFERD_DEFAULT_PORT = 55002;
    // max wait time for the daemon to log its listening port
    private static readonly TimeSpan STARTUP_TIMEOUT = TimeSpan.FromSeconds(10);
    // max wait time for the connection to the daemon
    private static readonly TimeSpan CONNECT_TIMEOUT = TimeSpan.FromSeconds(5);
    // max wait time for the daemon to stop gracefully
    private static readonly TimeSpan SHUTDOWN_TIMEOUT = TimeSpan.FromSeconds(10);
    private const int SIGINT = 2;
    /// <summary>
    /// Send a signal to a process: .NET has no API to send SIGINT.
    /// </summary>
    /// <param name="pid">process id</param>
    /// <param name="sig">signal number</param>
    /// <returns>0 on success</returns>
    [System.Runtime.InteropServices.DllImport("libc", SetLastError = true)]
    private static extern int kill(int pid, int sig);
    // API port in daemon log (text or JSON log format), e.g. `API Server: Listening on 127.0.0.1:55002 ...`
    private static readonly Regex LISTENING_PORT_REGEX = new Regex(@"API Server: Listening on [^\s""]+:(\d+)");
    private Configuration _config;
    private string _serverAddress;
    private int _serverPort;
    private System.Diagnostics.Process? _daemonProcess = null;
    private List<StreamWriter> _daemonStreams = new List<StreamWriter>();
    private Transferd.Api.TransferService.TransferServiceClient? _daemonService = null;
    private string _daemonName;
    private string _daemonLog;


    /// <summary>
    /// Create a transfer client.
    /// </summary>
    /// <param name="config">configuration of the samples</param>
    public TransferClient(Configuration config)
    {
        _config = config;
        var confUrl = new Uri(_config.GetParam("trsdk", "url"));
        _serverAddress = confUrl.Host;
        _serverPort = confUrl.Port == -1 ? TRANSFERD_DEFAULT_PORT : confUrl.Port;
        _daemonName = Path.GetFileName(_config.GetPath("sdk_daemon"));
        _daemonLog = Path.Combine(_config.LogFolder(), _daemonName + ".log");
    }

    /// <summary>
    /// Create the configuration file of the daemon.
    /// See: https://developer.ibm.com/apis/catalog/aspera--aspera-transfer-sdk/Configuration%20File
    /// </summary>
    /// <param name="confFile">path of the configuration file</param>
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
    /// Start the daemon, with output and logs in the log folder.
    /// </summary>
    public void StartDaemon()
    {
        var daemonPath = _config.GetPath("sdk_daemon");
        var fileBase = Path.Combine(_config.LogFolder(), _daemonName);
        var confFile = fileBase + ".conf";
        var outFile = fileBase + ".out";
        var errFile = fileBase + ".err";
        var exec_args = $"--config {confFile}";
        Log.Dump("Daemon command", $"{daemonPath} {exec_args}");
        Log.Dump("Daemon out", outFile);
        Log.Dump("Daemon err", errFile);
        Log.Dump("Daemon log", _daemonLog);
        Log.Dump("Ascp log", Path.Combine(_config.LogFolder(), ASCP_LOG_FILE));
        CreateConfigFile(confFile);
        // the log file may contain lines of previous executions: only read new lines
        long logOffset = File.Exists(_daemonLog) ? new FileInfo(_daemonLog).Length : 0;
        Log.log.Info("Starting daemon");
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
        _daemonProcess.BeginOutputReadLine();
        _daemonProcess.BeginErrorReadLine();
        WaitDaemonListening(logOffset);
    }

    /// <summary>
    /// Wait for the daemon to listen, and get the port if dynamically allocated (port 0).
    /// The port is read from the daemon log: requires log level <c>info</c> or more verbose.
    /// </summary>
    /// <param name="logOffset">only read the daemon log after this offset</param>
    private void WaitDaemonListening(long logOffset)
    {
        var daemonProcess = _daemonProcess ?? throw new InvalidOperationException("Daemon not started");
        var deadline = DateTime.UtcNow + STARTUP_TIMEOUT;
        while (true)
        {
            if (daemonProcess.HasExited)
            {
                daemonProcess.WaitForExit();
                _daemonProcess = null;
                throw new Exception($"Daemon exited with code {daemonProcess.ExitCode}, see log: {_daemonLog}");
            }
            // fixed port: readiness is checked on connection
            if (_serverPort != 0)
            {
                return;
            }
            int? port = FindListeningPort(_daemonLog, logOffset);
            if (port.HasValue)
            {
                _serverPort = port.Value;
                return;
            }
            if (DateTime.UtcNow > deadline)
            {
                throw new Exception($"Listening port not found in daemon log: {_daemonLog}");
            }
            Thread.Sleep(200);
        }
    }

    /// <summary>
    /// Find the API listening port in the daemon log, after the given offset.
    /// </summary>
    /// <param name="logFile">path of the daemon log</param>
    /// <param name="offset">only read the daemon log after this offset</param>
    /// <returns>port, or null if not found (yet)</returns>
    private static int? FindListeningPort(string logFile, long offset)
    {
        if (!File.Exists(logFile))
        {
            return null;
        }
        byte[] content;
        // the file is written by the daemon
        using (var file = new FileStream(logFile, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
        using (var memory = new MemoryStream())
        {
            file.CopyTo(memory);
            content = memory.ToArray();
        }
        // log file was truncated
        if (content.Length < offset)
        {
            offset = 0;
        }
        var text = System.Text.Encoding.UTF8.GetString(content, (int)offset, content.Length - (int)offset);
        Match portMatch = LISTENING_PORT_REGEX.Match(text);
        return portMatch.Success ? int.Parse(portMatch.Groups[1].Value) : null;
    }

    /// <summary>
    /// Connect to the daemon.
    /// </summary>
    public void ConnectToDaemon()
    {
        AppContext.SetSwitch("System.Net.Http.SocketsHttpHandler.Http2UnencryptedSupport", true);
        var address = $"{_serverAddress}:{_serverPort}";
        var daemonService = new Transferd.Api.TransferService.TransferServiceClient(GrpcChannel.ForAddress($"http://{address}"));
        // retry until the daemon listens
        var deadline = DateTime.UtcNow + CONNECT_TIMEOUT;
        while (true)
        {
            try
            {
                daemonService.GetAPIVersion(new Transferd.Api.APIVersionRequest());
                break;
            }
            catch (Grpc.Core.RpcException e) when (e.StatusCode == Grpc.Core.StatusCode.Unavailable)
            {
                if (DateTime.UtcNow > deadline)
                {
                    throw new Exception($"Failed to connect to daemon: {address}");
                }
                Thread.Sleep(200);
            }
        }
        _daemonService = daemonService;
        Log.log.Info($"Connected to daemon: {address}");
    }
    /// <summary>
    /// Get the client of the daemon API, once connected.
    /// </summary>
    /// <returns>client of the daemon API</returns>
    private Transferd.Api.TransferService.TransferServiceClient DaemonService()
    {
        return _daemonService ?? throw new InvalidOperationException("Not connected to daemon");
    }
    /// <summary>
    /// Start the daemon and connect to it, if not already done.
    /// </summary>
    public void Startup()
    {
        if (_daemonService == null)
        {
            StartDaemon();
            ConnectToDaemon();
        }
    }
    /// <summary>
    /// Stop the daemon, if it was started: send SIGINT, and kill it if it does not stop in time.
    /// transferd stops cleanly on SIGINT (not on SIGTERM).
    /// Windows has no SIGINT for child processes: the process is terminated.
    /// </summary>
    public void Shutdown()
    {
        _daemonService = null;
        // Shutdown transfer manager daemon, if needed
        if (_daemonProcess != null)
        {
            Log.log.Info("Stopping daemon");
            // transferd stops cleanly on SIGINT (not on SIGTERM); Windows has no SIGINT for child processes
            if (OperatingSystem.IsWindows())
            {
                _daemonProcess.Kill();
            }
            else
            {
                kill(_daemonProcess.Id, SIGINT);
            }
            if (!_daemonProcess.WaitForExit(SHUTDOWN_TIMEOUT))
            {
                Log.log.Warn("Daemon did not stop, killing it");
                _daemonProcess.Kill();
                _daemonProcess.WaitForExit();
            }
            _daemonProcess = null;
            foreach (var stream in _daemonStreams)
            {
                stream.Close();
            }
        }
    }

    /// <summary>
    /// Start a transfer.
    /// </summary>
    /// <param name="aSpecObj">transfer spec</param>
    /// <returns>transfer id</returns>
    public string StartTransfer(JObject aSpecObj)
    {
        var tsJson = Newtonsoft.Json.JsonConvert.SerializeObject(aSpecObj);
        Log.Dump("Transfer spec", tsJson);
        // Start a transfer and return transfer id
        var transferRequest = new Transferd.Api.TransferRequest
        {
            TransferType = Transferd.Api.TransferType.FileRegular,
            Config = new Transferd.Api.TransferConfig { LogLevel = 2 },
            TransferSpec = tsJson,
        };
        var transferResponse = DaemonService().StartTransfer(transferRequest);
        // exception: the caller shuts down the daemon
        ThrowOnError(transferResponse.Status, transferResponse.Error?.Description);
        return transferResponse.TransferId;
    }

    /// <summary>
    /// Wait for the end of a transfer, and log its status.
    /// </summary>
    /// <param name="aTransferId">transfer id</param>
    void WaitTransfer(string aTransferId)
    {
        while (true)
        {
            // check the current state of the transfer
            var queryTransferResponse = DaemonService().QueryTransfer(new Transferd.Api.TransferInfoRequest() { TransferId = aTransferId });
            // check transfer status in response, and exit if it's done
            Transferd.Api.TransferStatus status = queryTransferResponse.Status;
            LogStatus(status, queryTransferResponse.TransferInfo?.AverageRateKbps ?? 0);
            // `error` is empty on session errors: the cause is in transfer information
            ThrowOnError(status, queryTransferResponse.Error?.Description, queryTransferResponse.TransferInfo?.ErrorDescription);
            if (status == Transferd.Api.TransferStatus.Completed)
            {
                break;
            }
            // wait a second before checking again
            System.Threading.Thread.Sleep(1000);
        }
    }


    /// <summary>
    /// Log the transfer status, and the rate when running.
    /// </summary>
    /// <param name="status">transfer status</param>
    /// <param name="averageRateKbps">average rate in kilobits per second</param>
    private static void LogStatus(Transferd.Api.TransferStatus status, long averageRateKbps)
    {
        // same name as in proto file, e.g. RUNNING
        var name = status.ToString().ToUpperInvariant();
        if (status == Transferd.Api.TransferStatus.Running)
        {
            Log.log.Info($"Transfer: {name} {(averageRateKbps / 1000.0).ToString("F1", CultureInfo.InvariantCulture)} Mbps");
        }
        else
        {
            Log.log.Info($"Transfer: {name}");
        }
    }

    /// <summary>
    /// Throw an exception if the transfer status is failed or unknown.
    /// </summary>
    /// <param name="status">transfer status</param>
    /// <param name="descriptions">error descriptions: the first non-empty one is used</param>
    private static void ThrowOnError(Transferd.Api.TransferStatus status, params string?[] descriptions)
    {
        var description = descriptions.Select(text => text?.Trim()).FirstOrDefault(text => !string.IsNullOrEmpty(text)) ?? "unknown error";
        if (status == Transferd.Api.TransferStatus.Failed)
        {
            throw new Exception($"Transfer failed: {description}");
        }
        if (status == Transferd.Api.TransferStatus.UnknownStatus)
        {
            throw new Exception($"Unknown transfer id: {description}");
        }
    }

    /// <summary>
    /// Start the daemon if needed, start a transfer, and wait for its end.
    /// </summary>
    /// <param name="aSpecObj">transfer spec</param>
    public void StartTransferAndWait(JObject aSpecObj)
    {
        Startup();
        WaitTransfer(StartTransfer(aSpecObj));
    }
    /// <summary>
    /// Capture an output of the daemon to a file.
    /// </summary>
    /// <param name="logFile">path of the file</param>
    /// <returns>handler of the output</returns>
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
    /// Convert the log level of ascp from name to number.
    /// </summary>
    /// <param name="level"><c>info</c>, <c>debug</c> or <c>trace</c></param>
    /// <returns>0, 1 or 2</returns>
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
