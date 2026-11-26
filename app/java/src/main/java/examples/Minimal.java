package examples;

import com.ibm.software.aspera.transferd.api.TransferServiceGrpc;
import com.ibm.software.aspera.transferd.api.Transferd;
import io.grpc.ManagedChannel;
import io.grpc.StatusRuntimeException;
import io.grpc.okhttp.OkHttpChannelBuilder;
import java.io.File;
import java.net.URI;
import java.util.Iterator;
import java.util.concurrent.TimeUnit;
import java.util.logging.Logger;
import org.json.JSONArray;
import org.json.JSONObject;
import utils.Configuration;

/**
 * Sample: upload files to an HSTS with SSH credentials, with the Transfer Daemon API only (gRPC).
 * Read this sample first: the other samples use the helper class TransferClient, which does the same steps.
 * The class Configuration only reads the parameters of the test environment: replace config.getParamStr(...) with your values.
 */
public class Minimal {
    private static final Logger LOGGER = Logger.getLogger(Minimal.class.getName());
    // address of the gRPC API, set in the default configuration file of the SDK: etc/transferd.json
    private static final String DAEMON_HOST = "127.0.0.1";
    private static final int DAEMON_PORT = 55002;

    /**
     * Execute the sample.
     *
     * @param args command line arguments: files to transfer
     * @throws Exception on error
     */
    public static void main(String... args) throws Exception {
        final Configuration config = new Configuration(args);
        final String daemonAddress = DAEMON_HOST + ":" + DAEMON_PORT;

        // 1. Start the Transfer Daemon. Without option, transferd reads etc/transferd.json of the SDK.
        //    In production, the daemon can also run as a service, started separately.
        final File daemonOut = new File(System.getProperty("java.io.tmpdir"), "transferd_minimal.out");
        LOGGER.info("Starting daemon");
        final Process daemon = new ProcessBuilder(config.getPath("sdk_daemon"))
                .redirectErrorStream(true).redirectOutput(daemonOut).start();
        // 2. Connect to the gRPC API of the daemon
        final ManagedChannel channel = OkHttpChannelBuilder.forAddress(DAEMON_HOST, DAEMON_PORT).usePlaintext().build();
        try {
            final TransferServiceGrpc.TransferServiceBlockingStub client = TransferServiceGrpc.newBlockingStub(channel);
            try {
                // a first call waits until the daemon listens
                client.withWaitForReady().withDeadlineAfter(10, TimeUnit.SECONDS)
                        .getInfo(Transferd.InstanceInfoRequest.newBuilder().build());
            } catch (final StatusRuntimeException e) {
                throw new RuntimeException("Failed to connect to daemon: " + daemonAddress + ", see: " + daemonOut);
            }
            LOGGER.info("Connected to daemon: " + daemonAddress);

            // 3. Build the transfer spec: upload (send) with SSH credentials
            final URI serverUrl = new URI(config.getParamStr("server", "url"));
            // files to transfer: arguments of the command line
            final JSONArray paths = new JSONArray();
            for (final String file : args) {
                paths.put(new JSONObject().put("source", file));
            }
            final JSONObject transferSpec = new JSONObject()
                    .put("direction", "send")
                    .put("remote_host", serverUrl.getHost())
                    .put("ssh_port", serverUrl.getPort())
                    .put("remote_user", config.getParamStr("server", "username"))
                    .put("remote_password", config.getParamStr("server", "password"))
                    .put("destination_root", config.getParamStr("server", "folder_upload"))
                    .put("paths", paths);

            // 4. Start the transfer and follow it: the daemon sends an event on each change, until the end of the transfer
            LOGGER.info("Uploading files");
            final Iterator<Transferd.TransferResponse> events = client.startTransferWithMonitor(Transferd.TransferRequest.newBuilder()
                    .setTransferType(Transferd.TransferType.FILE_REGULAR)
                    .setConfig(Transferd.TransferConfig.newBuilder().build())
                    .setTransferSpec(transferSpec.toString())
                    .build());
            while (events.hasNext()) {
                final Transferd.TransferResponse event = events.next();
                LOGGER.info(String.format("Transfer: %s %d bytes", event.getStatus(), event.getTransferInfo().getBytesTransferred()));
                // the cause of an error is in error, or else in transferInfo
                final String description = (event.getError().getDescription().isEmpty()
                        ? event.getTransferInfo().getErrorDescription()
                        : event.getError().getDescription()).strip();
                if (event.getStatus() == Transferd.TransferStatus.FAILED || event.getStatus() == Transferd.TransferStatus.CANCELED) {
                    throw new RuntimeException("Transfer failed: " + description);
                }
                if (event.getStatus() == Transferd.TransferStatus.UNKNOWN_STATUS) {
                    throw new RuntimeException("Transfer status unknown: " + description);
                }
                if (event.getStatus() == Transferd.TransferStatus.COMPLETED) {
                    return;
                }
            }
            // the stream ended before the end of the transfer
            throw new RuntimeException("Transfer monitoring ended before transfer completion");
        } finally {
            // 5. Stop the daemon: transferd stops cleanly on SIGINT (Windows: terminated)
            //    Java has no API to send SIGINT: the command kill is used.
            channel.shutdownNow();
            LOGGER.info("Stopping daemon");
            if (System.getProperty("os.name").startsWith("Windows")) {
                daemon.destroy();
            } else {
                new ProcessBuilder("kill", "-INT", Long.toString(daemon.pid())).start().waitFor();
            }
            daemon.waitFor(10, TimeUnit.SECONDS);
        }
    }
}
