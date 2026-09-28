package utils;

import com.ibm.software.aspera.transferd.api.Transferd;
import com.ibm.software.aspera.transferd.api.TransferServiceGrpc;
import io.grpc.okhttp.OkHttpChannelBuilder;
import io.grpc.stub.StreamObserver;
import io.grpc.ManagedChannel;
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
 * Read configuration file and provide interface for transfer
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
    private static final int SHUTDOWN_TIMEOUT_SEC = 5;
    // API port in daemon log (text or JSON log format), e.g. `API Server: Listening on
    // 127.0.0.1:55002 ...`
    private static final Pattern LISTENING_PORT_REGEX =
            Pattern.compile("API Server: Listening on [^\\s\"]+:(\\d+)");
    // configuration parameters from the configuration file
    public final Configuration config;
    private final String serverAddress;
    private int serverPort;
    private Process daemonProcess;
    private ManagedChannel channel;
    // Aspera client API (synchronous)
    public TransferServiceGrpc.TransferServiceBlockingStub transferService;
    private final String daemonName;
    private final String daemonLog;
    // several transfer session may be started but for the example we use only one
    private String transferId;

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
            throw new Error("invalid grpc url: " + e.getMessage());
        }
        daemonName = Paths.get(config.getPath("sdk_daemon")).getFileName().toString();
        daemonLog = config.getLogFolder() + File.separator + daemonName + ".log";
        transferId = null;
    }

    /**
     * @return current session transfer id
     */
    public String getTransferId() {
        if (transferId == null) {
            throw new Error("transfer session was not started");
        }
        return transferId;
    }

    /**
     * Create configuration file for the Aspera Transfer Daemon
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
            e.printStackTrace();
            throw new Error("problem with SDK configuration file: " + e.getMessage());
        }
    }

    /**
     * @return first non-empty error description
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
     * Convert log level for ascp from string to int
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
     * Start the daemon, if not already started
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
            String[] command = new String[] {config.getPath("sdk_daemon"), "-c", sdk_conf_path};
            LOGGER.log(Level.INFO, "daemon out: {0}", out_file);
            LOGGER.log(Level.INFO, "daemon err: {0}", err_file);
            LOGGER.log(Level.INFO, "daemon log: {0}", daemonLog);
            LOGGER.log(Level.INFO, "ascp log: {0}",
                    config.getLogFolder() + File.separator + ASCP_LOG_FILE);
            LOGGER.log(Level.INFO, "command: {0} {1} {2}", command);
            // redirect output to files, else the daemon may block when the pipe buffer is full
            daemonProcess = new ProcessBuilder(command) //
                    .redirectOutput(new File(out_file)) //
                    .redirectError(new File(err_file)) //
                    .start();
            waitDaemonListening(logOffset);
        } catch (final IOException e) {
            LOGGER.log(Level.SEVERE, "cannot start daemon: {0}", e.getMessage());
            throw new Error(e.getMessage());
        } catch (final InterruptedException e) {
            throw new Error(e.getMessage());
        }
    }

    /**
     * Wait for the daemon to listen, and get the port if dynamically allocated (port 0). The port
     * is read from the daemon log: requires log level `info` or more verbose.
     *
     * @param logOffset only read the log after this offset
     */
    private void waitDaemonListening(final long logOffset)
            throws IOException, InterruptedException {
        final long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(STARTUP_TIMEOUT_SEC);
        while (true) {
            if (!daemonProcess.isAlive()) {
                LOGGER.log(Level.SEVERE, "new daemon terminated unexpectedly, exit code: {0}",
                        daemonProcess.exitValue());
                LOGGER.log(Level.SEVERE, "check daemon log: {0}", daemonLog);
                daemonProcess = null;
                throw new RuntimeException("daemon startup failed");
            }
            // fixed port: readiness is checked on connection
            if (serverPort != 0) {
                return;
            }
            final Integer port = findListeningPort(daemonLog, logOffset);
            if (port != null) {
                serverPort = port;
                LOGGER.log(Level.INFO, "Allocated server port: {0}", Integer.toString(serverPort));
                return;
            }
            if (System.nanoTime() > deadline) {
                throw new RuntimeException("Listening port not found in daemon log after "
                        + STARTUP_TIMEOUT_SEC + "s: " + daemonLog);
            }
            Thread.sleep(200);
        }
    }

    /**
     * Find the API listening port in the daemon log, after the given offset.
     *
     * @return the port, or null if not found (yet)
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
     * Connect to the daemon, if not already connected
     */
    public void daemon_connect() {
        if (transferService != null) {
            return;
        }
        LOGGER.log(Level.INFO, "L: Connecting to daemon");
        // comm channel for grpc
        channel = OkHttpChannelBuilder.forAddress(serverAddress, serverPort).usePlaintext().build();
        // Create a connection to the Transfer Daemon
        // Note that this is a synchronous client here
        // async is also possible
        final TransferServiceGrpc.TransferServiceBlockingStub service =
                TransferServiceGrpc.newBlockingStub(channel);
        LOGGER.log(Level.INFO, "Checking gRPC connection");
        // make a simple api call to check communication is ok (wait until the daemon listens)
        Transferd.InstanceInfoResponse infoResponse = service.withWaitForReady()
                .withDeadlineAfter(CONNECT_TIMEOUT_SEC, TimeUnit.SECONDS)
                .getInfo(Transferd.InstanceInfoRequest.newBuilder().build());
        transferService = service;
        LOGGER.log(Level.INFO, "OK: Daemon is here, API v = {0}", infoResponse.getApiVersion());
    }

    public void shutdown() {
        transferService = null;
        if (channel != null) {
            channel.shutdownNow();
            channel = null;
        }
        if (daemonProcess != null) {
            LOGGER.log(Level.INFO, "L: Shutting down daemon");
            stopProcess(daemonProcess);
            daemonProcess = null;
        }
    }

    /**
     * Stop the daemon gracefully, or kill it after a timeout.
     *
     * transferd stops cleanly on SIGINT (not on SIGTERM). Java has no API to send SIGINT: use
     * command `kill`. Windows has no SIGINT for child processes: the process is terminated.
     */
    private static void stopProcess(final Process process) {
        try {
            if (System.getProperty("os.name").startsWith("Windows")) {
                process.destroy();
            } else {
                new ProcessBuilder("kill", "-INT", Long.toString(process.pid())).start().waitFor();
            }
            if (!process.waitFor(SHUTDOWN_TIMEOUT_SEC, TimeUnit.SECONDS)) {
                LOGGER.log(Level.WARNING, "L: daemon did not stop, killing it");
                process.destroyForcibly().waitFor();
            }
            LOGGER.log(Level.INFO, "L: daemon exited with status {0}", process.exitValue());
        } catch (final IOException | InterruptedException e) {
            LOGGER.log(Level.SEVERE, "L: error stopping daemon: {0}", e.getMessage());
            process.destroyForcibly();
        }
    }

    /**
     * Helper method for simple examples
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
     * Start one transfer session
     */
    public void session_start(final JSONObject transferSpec,
            final Transferd.TransferType aTransferType) {
        LOGGER.log(Level.INFO, "L: ts: {0}", transferSpec.toString());
        // send start transfer request to transfer sdk daemon
        final Transferd.StartTransferResponse transferResponse = transferService.startTransfer(//
                Transferd.TransferRequest.newBuilder() //
                        .setTransferType(aTransferType)
                        .setConfig(Transferd.TransferConfig.newBuilder().build())
                        .setTransferSpec(transferSpec.toString()).build());
        final Transferd.TransferStatus status = transferResponse.getStatus();
        if (status == Transferd.TransferStatus.FAILED
                || status == Transferd.TransferStatus.UNKNOWN_STATUS) {
            throw new RuntimeException("transfer start failed: "
                    + errorDescription(transferResponse.getError().getDescription()));
        }
        transferId = transferResponse.getTransferId();
        LOGGER.log(Level.FINE, "transfer session started with id {0} / {1}",
                new Object[] {transferId, status.getNumber()});
    }

    /**
     * Start a transfer session in streaming mode
     *
     * https://www.youtube.com/watch?v=zCXN4wj0uPo&t=3200s
     *
     * @param transferSpec
     */
    private void session_start_streaming(final JSONObject transferSpec) {
        final TransferServiceGrpc.TransferServiceStub client = TransferServiceGrpc.newStub(channel);
        JSONArray paths = (JSONArray) transferSpec.remove("paths");
        final CountDownLatch transferLatch = new CountDownLatch(1);
        var responseObserver = new StreamObserver<Transferd.StartTransferResponse>() {
            @Override
            public void onNext(Transferd.StartTransferResponse response) {
                transferId = response.getTransferId();
                LOGGER.log(Level.FINE, "transfer started with id {0}", transferId);
                // once the transfer starts, write data
                try {
                    writeStreamData(client, paths);
                } catch (InterruptedException e) {
                    LOGGER.log(Level.SEVERE, "failed to write data");
                }
            }

            @Override
            public void onError(final Throwable t) {
                LOGGER.log(Level.SEVERE, "responseObserver: onError: {0}", t.getMessage());
                transferLatch.countDown();
            }

            @Override
            public void onCompleted() {
                LOGGER.log(Level.FINE, "responseObserver: onCompleted");
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
            throw new Error("failed to wait for transfer to complete");
        }
        // Mark the end of requests
        LOGGER.log(Level.FINE, "end of session_start_streaming");
    }

    public void writeStreamData(TransferServiceGrpc.TransferServiceStub pClient, JSONArray paths)
            throws InterruptedException {
        final CountDownLatch chunkLatch = new CountDownLatch(1);
        StreamObserver<Transferd.WriteStreamRequest> writeStreamObserver =
                pClient.writeStream(new StreamObserver<Transferd.WriteStreamResponse>() {
                    @Override
                    public void onNext(final Transferd.WriteStreamResponse value) {
                        LOGGER.log(Level.FINE, "write stream response: {0}", value.toString());
                        chunkLatch.countDown();
                    }

                    @Override
                    public void onError(final Throwable t) {
                        LOGGER.log(Level.SEVERE, "write stream error: {0}", t.getMessage());
                        chunkLatch.countDown();
                    }

                    @Override
                    public void onCompleted() {
                        LOGGER.log(Level.FINE, "write stream completed");
                    }
                });
        final byte[] buffer = new byte[1024]; // 1KB buffer
        for (var path : paths) {
            var file = new File(((JSONObject) path).getString("source"));
            LOGGER.log(Level.FINE, "L: file: {0}", file.toString());
            try (InputStream inputStream = new FileInputStream(file)) {
                int bytesRead;
                // Read the file in chunks of 1KB until the end of the file
                while ((bytesRead = inputStream.read(buffer)) != -1) {
                    LOGGER.log(Level.FINE, "L: read {0} bytes", bytesRead);
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
                throw new Error("Error reading file: " + e.getMessage());
            }
        }
        // end of client stream (all files sent), then wait for the single response
        writeStreamObserver.onCompleted();
        try {
            chunkLatch.await(60, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            throw new Error("failed to wait for transfer to complete");
        }
    }

    public void session_wait_for_completion() {
        LOGGER.log(Level.FINE, "L: Wait for session completion");
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
            LOGGER.log(Level.FINE, "L: transfer event: {0}", response.getTransferEvent());
            if (response.hasFileInfo()) {
                LOGGER.log(Level.FINE, "L: file info: {0}",
                        response.getFileInfo().toString().replaceAll("\\n", ", "));
            }
            LOGGER.log(Level.INFO, "L: status: {0}", status.toString());
            LOGGER.log(Level.FINE, "L: message: {0}", response.getMessage());
            if (response.hasError()) {
                LOGGER.log(Level.FINE, "L: err: {0}", response.getError());
            }
            if (status == Transferd.TransferStatus.FAILED) {
                // `error` is empty on session errors: the cause is in session or transfer information
                final String description = errorDescription(response.getError().getDescription(),
                        response.getSessionInfo().getErrorDesc(),
                        response.getTransferInfo().getErrorDescription());
                LOGGER.log(Level.SEVERE, "L: transfer failed: {0}", description);
                throw new RuntimeException("transfer failed: " + description);
            }
            if (status == Transferd.TransferStatus.COMPLETED) {
                LOGGER.log(Level.INFO, "L: upload finished, received: {0}", status);
                LOGGER.log(Level.FINE, "L: Finished monitoring loop");
                return;
            }
        }
        throw new RuntimeException("transfer monitoring ended before transfer completion");
    }
}
