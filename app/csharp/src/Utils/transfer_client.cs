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
    // default port of transferd if not specified in URL
    private const int TRANSFERD_DEFAULT_PORT = 55002;
    // max wait time for the daemon to log its listening port
    private static readonly TimeSpan STARTUP_TIMEOUT = TimeSpan.FromSeconds(10);
    // max wait time for the connection to the daemon
    private static readonly TimeSpan CONNECT_TIMEOUT = TimeSpan.FromSeconds(5);
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


    public TransferClient(Configuration config)
    {
        _config = config;
        var confUrl = new Uri(_config.GetParam("trsdk", "url"));
        _serverAddress = confUrl.Host;
        _serverPort = confUrl.Port == -1 ? TRANSFERD_DEFAULT_PORT : confUrl.Port;
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
        // the log file may contain lines of previous executions: only read new lines
        long logOffset = File.Exists(_daemonLog) ? new FileInfo(_daemonLog).Length : 0;
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
        _daemonProcess.BeginOutputReadLine();
        _daemonProcess.BeginErrorReadLine();
        WaitDaemonListening(logOffset);
    }

    /// <summary>
    /// Wait for the daemon to listen, and get the port if dynamically allocated (port 0).
    /// The port is read from the daemon log: requires log level `info` or more verbose.
    /// </summary>
    /// <param name="logOffset">only read the log after this offset</param>
    private void WaitDaemonListening(long logOffset)
    {
        var daemonProcess = _daemonProcess ?? throw new InvalidOperationException("daemon not started");
        var deadline = DateTime.UtcNow + STARTUP_TIMEOUT;
        while (true)
        {
            if (daemonProcess.HasExited)
            {
                Log.log.Error($"Daemon not started.");
                Log.log.Error($"Exited with code: {daemonProcess.ExitCode}");
                Log.log.Error($"Check daemon log: {_daemonLog}");
                daemonProcess.WaitForExit();
                _daemonProcess = null;
                throw new Exception("daemon startup failed");
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
                Log.log.Info($"Allocated server port: {_serverPort}");
                return;
            }
            if (DateTime.UtcNow > deadline)
            {
                throw new Exception($"Listening port not found in daemon log after {STARTUP_TIMEOUT.TotalSeconds}s: {_daemonLog}");
            }
            Thread.Sleep(200);
        }
    }

    /// <summary>
    /// Find the API listening port in the daemon log, after the given offset.
    /// </summary>
    /// <returns>the port, or null if not found (yet)</returns>
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

    public void ConnectToDaemon()
    {
        AppContext.SetSwitch("System.Net.Http.SocketsHttpHandler.Http2UnencryptedSupport", true);
        var grpcUrl = new Uri($"http://{_serverAddress}:{_serverPort}");
        Log.log.Info($"Connecting to {_daemonName} on {grpcUrl} ...");
        var daemonService = new Transferd.Api.TransferService.TransferServiceClient(GrpcChannel.ForAddress(grpcUrl));
        // retry until the daemon listens
        var deadline = DateTime.UtcNow + CONNECT_TIMEOUT;
        while (true)
        {
            try
            {
                daemonService.GetAPIVersion(new Transferd.Api.APIVersionRequest());
                break;
            }
            catch (Grpc.Core.RpcException e) when (e.StatusCode == Grpc.Core.StatusCode.Unavailable && DateTime.UtcNow < deadline)
            {
                Thread.Sleep(200);
            }
        }
        _daemonService = daemonService;
        Log.log.Info("Connected !");
    }
    /// <summary>
    /// Client of the daemon API, once connected
    /// </summary>
    private Transferd.Api.TransferService.TransferServiceClient DaemonService()
    {
        return _daemonService ?? throw new InvalidOperationException("not connected to daemon");
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

        var transferResponse = DaemonService().StartTransfer(transferRequest);

        if (transferResponse.Status == Transferd.Api.TransferStatus.Failed
            || transferResponse.Status == Transferd.Api.TransferStatus.UnknownStatus)
        {
            // exception: the caller shuts down the daemon
            throw new Exception($"transfer start failed: {transferResponse.Error?.Description}");
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
            var queryTransferResponse = DaemonService().QueryTransfer(new Transferd.Api.TransferInfoRequest() { TransferId = aTransferId });
            Console.Out.WriteLine("transfer info " + queryTransferResponse);

            // check transfer status in response, and exit if it's done
            Transferd.Api.TransferStatus status = queryTransferResponse.Status;
            if (status == Transferd.Api.TransferStatus.Failed)
            {
                throw new Exception($"transfer failed: {queryTransferResponse.Error?.Description}");
            }
            if (status == Transferd.Api.TransferStatus.Completed)
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
