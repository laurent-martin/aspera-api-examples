using Grpc.Core;
using Grpc.Net.Client;
using Newtonsoft.Json.Linq;
using System;
using System.Globalization;
using System.IO;
/// <summary>
/// Client of the Aspera Transfer Daemon (transferd): start the daemon, start transfers and wait for their end.
/// </summary>
public class TransferClient
{
    private const string ASCP_LOG_FILE = "aspera-scp-transfer.log";
    // default port of transferd if not specified in URL
    private const int TRANSFERD_DEFAULT_PORT = 55002;
    // max wait time for the daemon to write its port file
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
    // extension of the port file, written in `runtime_dir` with port 0: `transferd.<port>.optport`
    private const string PORT_FILE_EXTENSION = ".optport";
    private Configuration _config;
    private string _serverAddress;
    private int _serverPort;
    private System.Diagnostics.Process? _daemonProcess = null;
    private List<StreamWriter> _daemonStreams = new List<StreamWriter>();
    private Transferd.Api.TransferService.TransferServiceClient? _daemonService = null;
    private string _daemonName;
    // folder of the configuration, output and logs of the daemon: a new one for each start
    private string _daemonFolder = "";
    private string _daemonLog = "";
    // `runtime_dir` of the daemon, where it writes its port file: only with port 0
    private string? _runtimeDir = null;


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
    }

    /// <summary>
    /// Create the configuration file of the daemon.
    /// See: https://developer.ibm.com/apis/catalog/aspera--aspera-transfer-sdk/Configuration%20File
    /// </summary>
    /// <param name="confFile">path of the configuration file</param>
    public void CreateConfigFile(string confFile)
    {
        var configInfo = JObject.FromObject(new
        {
            address = _serverAddress,
            port = _serverPort,
            log_directory = _daemonFolder,
            log_level = _config.GetParam("trsdk", "level"),
            fasp_runtime = new
            {
                use_embedded = true,
                log = new
                {
                    dir = _daemonFolder,
                    level = AscpLevel(_config.GetParam("trsdk", "ascp_level")),
                },
            },
        });
        if (_runtimeDir != null)
        {
            configInfo["runtime_dir"] = _runtimeDir;
        }
        File.WriteAllText(confFile, Newtonsoft.Json.JsonConvert.SerializeObject(configInfo));
    }

    /// <summary>
    /// Start the daemon, with its configuration, output and logs in a new folder of the log folder.
    /// </summary>
    public void StartDaemon()
    {
        var daemonPath = _config.GetPath("sdk_daemon");
        // samples run at the same time do not share files
        _daemonFolder = Path.Combine(_config.LogFolder(), _daemonName + "." + Guid.NewGuid());
        CreatePrivateFolder(_daemonFolder);
        var fileBase = Path.Combine(_daemonFolder, _daemonName);
        var confFile = fileBase + ".conf";
        var outFile = fileBase + ".out";
        var errFile = fileBase + ".err";
        _daemonLog = fileBase + ".log";
        if (_serverPort == 0)
        {
            // the daemon writes its port file in this folder: of this daemon only, readable only by the user
            _runtimeDir = Path.Combine(_daemonFolder, "run");
            CreatePrivateFolder(_runtimeDir);
        }
        var exec_args = $"--config {confFile}";
        Log.Dump("Daemon command", $"{daemonPath} {exec_args}");
        Log.Dump("Daemon out", outFile);
        Log.Dump("Daemon err", errFile);
        Log.Dump("Daemon log", _daemonLog);
        Log.Dump("Ascp log", Path.Combine(_daemonFolder, ASCP_LOG_FILE));
        CreateConfigFile(confFile);
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
        WaitDaemonListening();
    }

    /// <summary>
    /// Wait for the daemon to listen, and get the port if dynamically allocated (port 0).
    /// With port 0, the daemon writes its port in a file of its <c>runtime_dir</c> once it listens.
    /// This requires transferd 1.1.7 or later.
    /// </summary>
    private void WaitDaemonListening()
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
            if (_runtimeDir == null)
            {
                return;
            }
            int? port = ReadPortFile(_runtimeDir);
            if (port.HasValue)
            {
                _serverPort = port.Value;
                return;
            }
            if (DateTime.UtcNow > deadline)
            {
                throw new Exception($"Port file not found in {_runtimeDir}: transferd 1.1.7 or later is required");
            }
            Thread.Sleep(200);
        }
    }

    /// <summary>
    /// Read the port of the daemon in its port file <c>transferd.&lt;port&gt;.optport</c>, in its <c>runtime_dir</c>.
    /// The daemon creates the file, then writes the port: an empty file is not ready yet.
    /// </summary>
    /// <param name="runtimeDir"><c>runtime_dir</c> of the daemon</param>
    /// <returns>port, or null if not written (yet)</returns>
    private static int? ReadPortFile(string runtimeDir)
    {
        var portFiles = Directory.GetFiles(runtimeDir, "*" + PORT_FILE_EXTENSION);
        if (portFiles.Length == 0)
        {
            return null;
        }
        if (portFiles.Length > 1)
        {
            throw new Exception($"Several port files in {runtimeDir}");
        }
        string content;
        // the file is written by the daemon
        using (var reader = new StreamReader(new FileStream(portFiles[0], FileMode.Open, FileAccess.Read, FileShare.ReadWrite)))
        {
            content = reader.ReadToEnd();
        }
        if (content.Length == 0)
        {
            return null;
        }
        if (!content.All(char.IsAsciiDigit))
        {
            throw new Exception($"No port in file {portFiles[0]}");
        }
        return int.Parse(content, CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// Create a folder readable only by the user, where the OS supports it.
    /// </summary>
    /// <param name="folder">path of the folder</param>
    private static void CreatePrivateFolder(string folder)
    {
        if (OperatingSystem.IsWindows())
        {
            Directory.CreateDirectory(folder);
        }
        else
        {
            Directory.CreateDirectory(folder, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        }
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
    /// Then delete its <c>runtime_dir</c>: a killed daemon does not delete its port file.
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
        if (_runtimeDir != null)
        {
            if (Directory.Exists(_runtimeDir))
            {
                Directory.Delete(_runtimeDir, true);
            }
            _runtimeDir = null;
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
    /// Throw an exception if the transfer status is failed, canceled or unknown.
    /// </summary>
    /// <param name="status">transfer status</param>
    /// <param name="descriptions">error descriptions: the first non-empty one is used</param>
    private static void ThrowOnError(Transferd.Api.TransferStatus status, params string?[] descriptions)
    {
        var description = descriptions.Select(text => text?.Trim()).FirstOrDefault(text => !string.IsNullOrEmpty(text)) ?? "unknown error";
        if (status == Transferd.Api.TransferStatus.Failed || status == Transferd.Api.TransferStatus.Canceled)
        {
            throw new Exception($"Transfer failed: {description}");
        }
        if (status == Transferd.Api.TransferStatus.UnknownStatus)
        {
            throw new Exception($"Transfer status unknown: {description}");
        }
    }

    /// <summary>
    /// Start the daemon if needed, start a transfer, and wait for its end.
    /// </summary>
    /// <param name="aSpecObj">transfer spec</param>
    public void StartTransferAndWait(JObject aSpecObj)
    {
        Startup();
        var tsJson = Newtonsoft.Json.JsonConvert.SerializeObject(aSpecObj);
        Log.Dump("Transfer spec", tsJson);
        var transferRequest = new Transferd.Api.TransferRequest
        {
            TransferType = Transferd.Api.TransferType.FileRegular,
            Config = new Transferd.Api.TransferConfig(),
            TransferSpec = tsJson,
        };
        // start the transfer: the daemon sends an event on each change, until the end of the transfer
        // disposing the call stops monitoring, if the stream is still open
        using var call = DaemonService().StartTransferWithMonitor(transferRequest);
        foreach (var transferEvent in call.ResponseStream.ReadAllAsync().ToBlockingEnumerable())
        {
            var status = transferEvent.Status;
            LogStatus(status, transferEvent.TransferInfo?.AverageRateKbps ?? 0);
            // `error` is empty on session errors: the cause is in session or transfer information
            ThrowOnError(status, transferEvent.Error?.Description, transferEvent.SessionInfo?.ErrorDesc, transferEvent.TransferInfo?.ErrorDescription);
            if (status == Transferd.Api.TransferStatus.Completed)
            {
                return;
            }
        }
        throw new Exception("Transfer monitoring ended before transfer completion");
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
