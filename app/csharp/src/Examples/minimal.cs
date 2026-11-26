using Grpc.Core;
using Grpc.Net.Client;
using Newtonsoft.Json.Linq;

/// <summary>
/// Sample: upload files to an HSTS with SSH credentials, with the Transfer Daemon API only (gRPC).
/// Read this sample first: the other samples use the helper class TransferClient, which does the same steps.
/// The class Configuration only reads the parameters of the test environment: replace config.GetParam(...) with your values.
/// </summary>
class Minimal : SampleInterface
{
    // address of the gRPC API, set in the default configuration file of the SDK: etc/transferd.json
    private const string DAEMON_ADDRESS = "127.0.0.1:55002";
    private const int SIGINT = 2;

    /// <summary>
    /// Send a signal to a process: .NET has no API to send SIGINT.
    /// </summary>
    /// <param name="pid">process id</param>
    /// <param name="sig">signal number</param>
    /// <returns>0 on success</returns>
    [System.Runtime.InteropServices.DllImport("libc", SetLastError = true)]
    private static extern int kill(int pid, int sig);

    /// <summary>
    /// Execute the sample.
    /// </summary>
    /// <param name="args">files to transfer</param>
    public void start(string[] args)
    {
        var config = new Configuration(args);

        // 1. Start the Transfer Daemon. Without option, transferd reads etc/transferd.json of the SDK.
        //    In production, the daemon can also run as a service, started separately.
        var daemonOut = Path.Combine(Path.GetTempPath(), "transferd_minimal.out");
        using var output = TextWriter.Synchronized(new StreamWriter(daemonOut));
        Log.log.Info("Starting daemon");
        var daemon = new System.Diagnostics.Process
        {
            StartInfo = new System.Diagnostics.ProcessStartInfo
            {
                FileName = config.GetPath("sdk_daemon"),
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
            }
        };
        // .NET cannot redirect the output of a process to a file: copy it line by line
        daemon.OutputDataReceived += (_, line) => output.WriteLine(line.Data);
        daemon.ErrorDataReceived += (_, line) => output.WriteLine(line.Data);
        daemon.Start();
        daemon.BeginOutputReadLine();
        daemon.BeginErrorReadLine();
        try
        {
            // 2. Connect to the gRPC API of the daemon
            using var channel = GrpcChannel.ForAddress($"http://{DAEMON_ADDRESS}");
            try
            {
                channel.ConnectAsync(new CancellationTokenSource(TimeSpan.FromSeconds(10)).Token).Wait();
            }
            catch (Exception)
            {
                throw new Exception($"Failed to connect to daemon: {DAEMON_ADDRESS}, see: {daemonOut}");
            }
            var client = new Transferd.Api.TransferService.TransferServiceClient(channel);
            Log.log.Info($"Connected to daemon: {DAEMON_ADDRESS}");

            // 3. Build the transfer spec: upload (send) with SSH credentials
            var serverUrl = new Uri(config.GetParam("server", "url"));
            var transferSpec = new JObject {
                {"direction", "send"},
                {"remote_host", serverUrl.Host},
                {"ssh_port", serverUrl.Port},
                {"remote_user", config.GetParam("server", "username")},
                {"remote_password", config.GetParam("server", "password")},
                {"destination_root", config.GetParam("server", "folder_upload")},
                // files to transfer: arguments of the command line
                {"paths", new JArray(args.Select(file => new JObject { { "source", file } }))},
            };

            // 4. Start the transfer and follow it: the daemon sends an event on each change, until the end of the transfer
            Log.log.Info("Uploading files");
            using var call = client.StartTransferWithMonitor(new Transferd.Api.TransferRequest
            {
                TransferType = Transferd.Api.TransferType.FileRegular,
                Config = new Transferd.Api.TransferConfig(),
                TransferSpec = transferSpec.ToString(Newtonsoft.Json.Formatting.None),
            });
            foreach (var transferEvent in call.ResponseStream.ReadAllAsync().ToBlockingEnumerable())
            {
                // same name as in proto file, e.g. RUNNING
                var status = transferEvent.Status;
                Log.log.Info($"Transfer: {status.ToString().ToUpperInvariant()} {transferEvent.TransferInfo?.BytesTransferred ?? 0} bytes");
                // the cause of an error is in error, or else in transferInfo
                var description = transferEvent.Error?.Description;
                if (string.IsNullOrEmpty(description))
                {
                    description = transferEvent.TransferInfo?.ErrorDescription ?? "";
                }
                description = description.Trim();
                if (status == Transferd.Api.TransferStatus.Failed || status == Transferd.Api.TransferStatus.Canceled)
                {
                    throw new Exception($"Transfer failed: {description}");
                }
                if (status == Transferd.Api.TransferStatus.UnknownStatus)
                {
                    throw new Exception($"Transfer status unknown: {description}");
                }
                if (status == Transferd.Api.TransferStatus.Completed)
                {
                    return;
                }
            }
            // the stream ended before the end of the transfer
            throw new Exception("Transfer monitoring ended before transfer completion");
        }
        finally
        {
            // 5. Stop the daemon: transferd stops cleanly on SIGINT (Windows: killed)
            Log.log.Info("Stopping daemon");
            if (OperatingSystem.IsWindows())
            {
                daemon.Kill();
            }
            else
            {
                kill(daemon.Id, SIGINT);
            }
            daemon.WaitForExit();
        }
    }
}
