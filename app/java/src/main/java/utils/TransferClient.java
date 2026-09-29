package utils;

import com.ibm.software.aspera.transferd.api.Transferd;
import com.ibm.software.aspera.transferd.api.TransferServiceGrpc;
import io.grpc.okhttp.OkHttpChannelBuilder;
import io.grpc.stub.StreamObserver;
import io.grpc.ManagedChannel;
import io.grpc.StatusRuntimeException;
import com.google.protobuf.ByteString;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;
import java.io.InputStream;
import java.io.FileWriter;
import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.net.URI;
import java.util.Iterator;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.logging.Logger;
import java.util.logging.Level;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Client of the Aspera Transfer Daemon (transferd): start the daemon, start transfers and wait for their end.
 */
public class TransferClient {

    private static final Logger LOGGER = Logger.getLogger(TransferClient.class.getName());
    private static final String ASCP_LOG_FILE = "aspera-scp-transfer.log";
    // default port of transferd if not specified in URL
    private static final int TRANSFERD_DEFAULT_PORT = 55002;
    // max wait time for the daemon to log its listening port
    private static final int STARTUP_TIMEOUT_SEC = 10;
    // max wait time for the connection to the daemon
    private static final int CONNECT_TIMEOUT_SEC = 5;
    // max wait time for the daemon to stop gracefully
    private static final int SHUTDOWN_TIMEOUT_SEC = 10;
    // API port in daemon log (text or JSON log format), e.g. `API Server: Listening on
    // 127.0.0.1:55002 ...`
    private static final Pattern LISTENING_PORT_REGEX =
            Pattern.compile("API Server: Listening on [^\\s\"]+:(\\d+)");
    /** Configuration of the samples. */
    public final Configuration config;
    private final String serverAddress;
    private int serverPort;
    private Process daemonProcess;
    private ManagedChannel channel;
    /** Client of the daemon API (synchronous). */
    public TransferServiceGrpc.TransferServiceBlockingStub transferService;
    private final String daemonName;
    private final String daemonLog;
    // several transfer session may be started but for the example we use only one
    private String transferId;

    /**
     * Create a transfer client.
     *
     * @param aConfig configuration of the samples
     */
    public TransferClient(final Configuration aConfig) {
        config = aConfig;
        daemonProcess = null;
        transferService = null;
        channel = null;
        try {
            final URI grpcURL = new URI(config.getParamStr("trsdk", "url"));
            serverAddress = grpcURL.getHost();
            serverPort = grpcURL.getPort() == -1 ? TRANSFERD_DEFAULT_PORT : grpcURL.getPort();
        } catch (final Exception e) {
            throw new Error("Invalid URL: " + config.getParamStr("trsdk", "url"));
        }
        daemonName = Paths.get(config.getPath("sdk_daemon")).getFileName().toString();
        daemonLog = config.getLogFolder() + File.separator + daemonName + ".log";
        transferId = null;
    }

    /**
     * Get the id of the current transfer.
     *
     * @return transfer id
     */
    public String getTransferId() {
        if (transferId == null) {
            throw new Error("Transfer session was not started");
        }
        return transferId;
    }

    /**
     * Create the configuration file of the daemon.
     * See: https://developer.ibm.com/apis/catalog/aspera--aspera-transfer-sdk/Configuration%20File
     *
     * @param confFile path of the configuration file
     */
    private void createConfFile(final String confFile) {
        // Define the configuration JSON object
        JSONObject sdk_config = new JSONObject() //
                .put("address", serverAddress) //
                .put("port", serverPort) //
                .put("log_directory", config.getLogFolder()) //
                .put("log_level", config.getParamStr("trsdk", "level")) //
                .put("fasp_runtime", new JSONObject() //
                        .put("use_embedded", true) //
                        .put("log", new JSONObject() //
                                .put("dir", config.getLogFolder()) //
                                .put("level",
                                        ascpLevel(config.getParamStr("trsdk", "ascp_level")))));
        // Write the JSON to a file
        try (final FileWriter fileWriter = new FileWriter(confFile)) {
            fileWriter.write(sdk_config.toString());
        } catch (final IOException e) {
            throw new Error("Failed to write file: " + confFile);
        }
    }

    /**
     * Get the first non-empty error description.
     *
     * @param texts error descriptions
     * @return error description, or {@code unknown error}
     */
    private static String errorDescription(final String... texts) {
        for (final String text : texts) {
            if (text != null && !text.isBlank()) {
                return text.strip();
            }
        }
        return "unknown error";
    }

    /**
     * Convert the log level of ascp from name to number.
     *
     * @param level {@code info}, {@code debug} or {@code trace}
     * @return 0, 1 or 2
     */
    private int ascpLevel(String level) {
        if (level.equals("info")) {
            return 0;
        } else if (level.equals("debug")) {
            return 1;
        } else if (level.equals("trace")) {
            return 2;
        } else {
            throw new IllegalArgumentException("Invalid ascp_level: " + level);
        }
    }

    /**
     * Start the daemon, with output and logs in the log folder, if not already started.
     */
    public void daemon_startup() {
        if (daemonProcess != null && daemonProcess.isAlive()) {
            return;
        }
        // Define the paths
        final String file_base = config.getLogFolder() + File.separator + daemonName;
        String sdk_conf_path = file_base + ".conf";
        final String out_file = file_base + ".out";
        final String err_file = file_base + ".err";
        createConfFile(sdk_conf_path);
        // the log file may contain lines of previous executions: only read new lines
        final long logOffset = new File(daemonLog).length();
        try {
            String[] command =
                    new String[] {config.getPath("sdk_daemon"), "--config", sdk_conf_path};
            Configuration.logDump("Daemon command", String.join(" ", command));
            Configuration.logDump("Daemon out", out_file);
            Configuration.logDump("Daemon err", err_file);
            Configuration.logDump("Daemon log", daemonLog);
            Configuration.logDump("Ascp log", config.getLogFolder() + File.separator + ASCP_LOG_FILE);
            LOGGER.log(Level.INFO, "Starting daemon");
            // redirect output to files, else the daemon may block when the pipe buffer is full
            daemonProcess = new ProcessBuilder(command) //
                    .redirectOutput(new File(out_file)) //
                    .redirectError(new File(err_file)) //
                    .start();
            waitDaemonListening(logOffset);
        } catch (final IOException e) {
            throw new Error("Failed to start daemon: " + e.getMessage());
        } catch (final InterruptedException e) {
            throw new Error(e.getMessage());
        }
    }

    /**
     * Wait for the daemon to listen, and get the port if dynamically allocated (port 0).
     * The port is read from the daemon log: requires log level {@code info} or more verbose.
     *
     * @param logOffset only read the daemon log after this offset
     */
    private void waitDaemonListening(final long logOffset)
            throws IOException, InterruptedException {
        final long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(STARTUP_TIMEOUT_SEC);
        while (true) {
            if (!daemonProcess.isAlive()) {
                final int exitCode = daemonProcess.exitValue();
                daemonProcess = null;
                throw new RuntimeException(
                        "Daemon exited with code " + exitCode + ", see log: " + daemonLog);
            }
            // fixed port: readiness is checked on connection
            if (serverPort != 0) {
                return;
            }
            final Integer port = findListeningPort(daemonLog, logOffset);
            if (port != null) {
                serverPort = port;
                return;
            }
            if (System.nanoTime() > deadline) {
                throw new RuntimeException("Listening port not found in daemon log: " + daemonLog);
            }
            Thread.sleep(200);
        }
    }

    /**
     * Find the API listening port in the daemon log, after the given offset.
     *
     * @param logFile path of the daemon log
     * @param offset only read the daemon log after this offset
     * @return port, or null if not found (yet)
     */
    private static Integer findListeningPort(final String logFile, long offset)
            throws IOException {
        final Path logPath = Paths.get(logFile);
        if (!Files.exists(logPath)) {
            return null;
        }
        final byte[] content = Files.readAllBytes(logPath);
        // log file was truncated
        if (content.length < offset) {
            offset = 0;
        }
        final Matcher matcher = LISTENING_PORT_REGEX.matcher(new String(content, (int) offset,
                content.length - (int) offset, StandardCharsets.UTF_8));
        return matcher.find() ? Integer.valueOf(matcher.group(1)) : null;
    }

    /**
     * Connect to the daemon, if not already connected.
     */
    public void daemon_connect() {
        if (transferService != null) {
            return;
        }
        final String address = serverAddress + ":" + serverPort;
        // comm channel for grpc
        channel = OkHttpChannelBuilder.forAddress(serverAddress, serverPort).usePlaintext().build();
        // Create a connection to the Transfer Daemon
        // Note that this is a synchronous client here
        // async is also possible
        final TransferServiceGrpc.TransferServiceBlockingStub service =
                TransferServiceGrpc.newBlockingStub(channel);
        // make a simple api call to check communication is ok (wait until the daemon listens)
        try {
            service.withWaitForReady().withDeadlineAfter(CONNECT_TIMEOUT_SEC, TimeUnit.SECONDS)
                    .getInfo(Transferd.InstanceInfoRequest.newBuilder().build());
        } catch (final StatusRuntimeException e) {
            throw new RuntimeException("Failed to connect to daemon: " + address);
        }
        transferService = service;
        LOGGER.log(Level.INFO, "Connected to daemon: {0}", address);
    }

    /**
     * Stop the daemon, if it was started: send SIGINT, and kill it if it does not stop in time.
     */
    public void shutdown() {
        transferService = null;
        if (channel != null) {
            channel.shutdownNow();
            channel = null;
        }
        if (daemonProcess != null) {
            LOGGER.log(Level.INFO, "Stopping daemon");
            stopProcess(daemonProcess);
            daemonProcess = null;
        }
    }

    /**
     * Stop the daemon: send SIGINT, and kill it if it does not stop in time.
     * transferd stops cleanly on SIGINT (not on SIGTERM).
     * Java has no API to send SIGINT: the command {@code kill} is used.
     * Windows has no SIGINT for child processes: the process is terminated.
     *
     * @param process daemon process
     */
    private static void stopProcess(final Process process) {
        try {
            if (System.getProperty("os.name").startsWith("Windows")) {
                process.destroy();
            } else {
                new ProcessBuilder("kill", "-INT", Long.toString(process.pid())).start().waitFor();
            }
            if (!process.waitFor(SHUTDOWN_TIMEOUT_SEC, TimeUnit.SECONDS)) {
                LOGGER.log(Level.WARNING, "Daemon did not stop, killing it");
                process.destroyForcibly().waitFor();
            }
        } catch (final IOException | InterruptedException e) {
            LOGGER.log(Level.SEVERE, "Failed to stop daemon: {0}", e.getMessage());
            process.destroyForcibly();
        }
    }

    /**
     * Start the daemon if needed, start a transfer, and wait for its end.
     *
     * @param transferSpec transfer spec
     */
    public void start_transfer_and_wait(final JSONObject transferSpec) {
        daemon_startup();
        daemon_connect();
        if (config.getParamBool("misc", "transfer_regular")) {
            session_start(transferSpec, Transferd.TransferType.FILE_REGULAR);
        } else {
            session_start_streaming(transferSpec);
        }
        session_wait_for_completion();
    }

    /**
     * Start a transfer.
     *
     * @param transferSpec transfer spec
     * @param aTransferType type of transfer
     */
    public void session_start(final JSONObject transferSpec,
            final Transferd.TransferType aTransferType) {
        Configuration.logDump("Transfer spec", transferSpec);
        // send start transfer request to transfer sdk daemon
        final Transferd.StartTransferResponse transferResponse = transferService.startTransfer(//
                Transferd.TransferRequest.newBuilder() //
                        .setTransferType(aTransferType)
                        .setConfig(Transferd.TransferConfig.newBuilder().build())
                        .setTransferSpec(transferSpec.toString()).build());
        throwOnError(transferResponse.getStatus(),
                errorDescription(transferResponse.getError().getDescription()));
        transferId = transferResponse.getTransferId();
    }

    /**
     * Throw an exception if the transfer status is failed or unknown.
     *
     * @param status transfer status
     * @param description error description
     */
    private static void throwOnError(final Transferd.TransferStatus status,
            final String description) {
        if (status == Transferd.TransferStatus.FAILED) {
            throw new RuntimeException("Transfer failed: " + description);
        }
        if (status == Transferd.TransferStatus.UNKNOWN_STATUS) {
            throw new RuntimeException("Unknown transfer id: " + description);
        }
    }

    /**
     * Log the transfer status, and the rate when running.
     *
     * @param status transfer status
     * @param averageRateKbps average rate in kilobits per second
     */
    private static void logStatus(final Transferd.TransferStatus status,
            final long averageRateKbps) {
        if (status == Transferd.TransferStatus.RUNNING) {
            LOGGER.log(Level.INFO, String.format("Transfer: %s %.1f Mbps", status,
                    averageRateKbps / 1000.0));
        } else {
            LOGGER.log(Level.INFO, "Transfer: " + status);
        }
    }

    /**
     * Start a transfer in streaming mode: the content of files is sent through the API.
     * See: https://www.youtube.com/watch?v=zCXN4wj0uPo&t=3200s
     *
     * @param transferSpec transfer spec
     */
    private void session_start_streaming(final JSONObject transferSpec) {
        final TransferServiceGrpc.TransferServiceStub client = TransferServiceGrpc.newStub(channel);
        JSONArray paths = (JSONArray) transferSpec.remove("paths");
        final CountDownLatch transferLatch = new CountDownLatch(1);
        var responseObserver = new StreamObserver<Transferd.StartTransferResponse>() {
            @Override
            public void onNext(Transferd.StartTransferResponse response) {
                transferId = response.getTransferId();
                // once the transfer starts, write data
                try {
                    writeStreamData(client, paths);
                } catch (InterruptedException e) {
                    LOGGER.log(Level.SEVERE, "Failed to write data");
                }
            }

            @Override
            public void onError(final Throwable t) {
                LOGGER.log(Level.SEVERE, "Transfer stream failed: {0}", t.getMessage());
                transferLatch.countDown();
            }

            @Override
            public void onCompleted() {
                transferLatch.countDown();
            }
        };
        client.startTransfer(Transferd.TransferRequest.newBuilder()
                .setTransferType(Transferd.TransferType.STREAM_TO_FILE_UPLOAD)
                .setConfig(Transferd.TransferConfig.newBuilder().build())
                .setTransferSpec(transferSpec.toString()).build(), responseObserver);
        try {
            transferLatch.await(60, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            throw new Error("Failed to wait for transfer to complete");
        }
    }

    /**
     * Send the content of files to the daemon.
     *
     * @param pClient asynchronous client of the daemon API
     * @param paths files to send, as in transfer spec
     * @throws InterruptedException if the wait is interrupted
     */
    public void writeStreamData(TransferServiceGrpc.TransferServiceStub pClient, JSONArray paths)
            throws InterruptedException {
        final CountDownLatch chunkLatch = new CountDownLatch(1);
        StreamObserver<Transferd.WriteStreamRequest> writeStreamObserver =
                pClient.writeStream(new StreamObserver<Transferd.WriteStreamResponse>() {
                    @Override
                    public void onNext(final Transferd.WriteStreamResponse value) {
                        chunkLatch.countDown();
                    }

                    @Override
                    public void onError(final Throwable t) {
                        LOGGER.log(Level.SEVERE, "Write stream failed: {0}", t.getMessage());
                        chunkLatch.countDown();
                    }

                    @Override
                    public void onCompleted() {}
                });
        final byte[] buffer = new byte[1024]; // 1KB buffer
        for (var path : paths) {
            var file = new File(((JSONObject) path).getString("source"));
            LOGGER.log(Level.FINE, "Streaming file: {0}", file.toString());
            try (InputStream inputStream = new FileInputStream(file)) {
                int bytesRead;
                // Read the file in chunks of 1KB until the end of the file
                while ((bytesRead = inputStream.read(buffer)) != -1) {
                    ByteString chunk = ByteString.copyFrom(buffer, 0, bytesRead);
                    // Send the chunk to the daemon
                    Transferd.WriteStreamRequest writeStreamRequest =
                            Transferd.WriteStreamRequest.newBuilder().setTransferId(transferId)
                                    .setPath(file.getName()).setSize(file.length())
                                    .setChunk(
                                            Transferd.Chunk.newBuilder().setContents(chunk).build())
                                    .build();
                    writeStreamObserver.onNext(writeStreamRequest);
                }
            } catch (IOException e) {
                throw new Error("Failed to read file: " + file);
            }
        }
        // end of client stream (all files sent), then wait for the single response
        writeStreamObserver.onCompleted();
        try {
            chunkLatch.await(60, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            throw new Error("Failed to wait for transfer to complete");
        }
    }

    /**
     * Wait for the end of the current transfer, and log its status.
     */
    public void session_wait_for_completion() {
        final Iterator<Transferd.TransferResponse> monitorTransferResponse =
                transferService.monitorTransfers(Transferd.RegistrationRequest.newBuilder()
                        .addFilters(Transferd.RegistrationFilter.newBuilder()
                                .setOperator(Transferd.RegistrationFilterOperator.OR)
                                .addTransferId(transferId).build())
                        .build());
        // monitor transfer until it finishes
        while (monitorTransferResponse.hasNext()) {
            final Transferd.TransferResponse response = monitorTransferResponse.next();
            final Transferd.TransferStatus status = response.getStatus();
            logStatus(status, response.getTransferInfo().getAverageRateKbps());
            // `error` is empty on session errors: the cause is in session or transfer information
            throwOnError(status,
                    errorDescription(response.getError().getDescription(),
                            response.getSessionInfo().getErrorDesc(),
                            response.getTransferInfo().getErrorDescription()));
            if (status == Transferd.TransferStatus.COMPLETED) {
                return;
            }
        }
        throw new RuntimeException("Transfer monitoring ended before transfer completion");
    }
}
