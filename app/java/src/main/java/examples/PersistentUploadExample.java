package examples;

import com.ibm.software.aspera.transferd.api.Transferd;
import org.json.JSONObject;
import java.net.URI;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.util.Timer;
import java.util.TimerTask;
import java.util.logging.Logger;
import java.util.logging.Level;
import utils.Configuration;
import utils.TransferClient;

public class PersistentUploadExample {
    private static final Logger LOGGER = Logger.getLogger(PersistentUploadExample.class.getName());

    public static class FileUploadTask extends TimerTask {
        private final TransferClient transferClient;
        private final String transferId;
        private final int maxFiles;
        private final boolean useRealFile;
        private int sequenceIndex;

        FileUploadTask(final TransferClient transferClient, final int maxFiles) {
            this.transferClient = transferClient;
            this.transferId = transferClient.getTransferId();
            this.maxFiles = maxFiles;
            // only real files are supported in persistent session
            this.useRealFile = true;
            sequenceIndex = 0;
        }

        // this is the recurring task
        public void run() {
            try {
                ++sequenceIndex;
                if (sequenceIndex > maxFiles) {
                    // ignore tasks after last one, not even log
                    return;
                }
                LOGGER.log(Level.FINE, "T: >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>");
                LOGGER.log(Level.FINE, "T: Task {0} scheduled ... executing now",
                        Integer.toString(sequenceIndex));
                // generate example file to transfer
                final String fileName = String.format("file%03d", sequenceIndex);
                String filePath = null;

                if (useRealFile) {
                    final File file =
                            new File(System.getProperty("java.io.tmpdir") + "/" + fileName);
                    final FileWriter writer = new FileWriter(file);
                    writer.write(String.format("Hello World %d!", sequenceIndex));
                    writer.close();
                    filePath = file.getAbsolutePath();
                } else {
                    filePath = String.format("faux:///file%03d?1k", sequenceIndex);
                }
                // add paths of files to transfer to persistent session
                final Transferd.TransferPathRequest transferPathRequest =
                        Transferd.TransferPathRequest.newBuilder().setTransferId(transferId)
                                .addTransferPath(Transferd.TransferPath.newBuilder()
                                        .setSource(filePath).setDestination(fileName).build())
                                .build();
                LOGGER.log(Level.FINE, "T: adding transfer path");
                // this will add to the transfer queue
                transferClient.transferService.addTransferPaths(transferPathRequest);
                LOGGER.log(Level.FINE, "T: end task");
                if (sequenceIndex == maxFiles) {
                    // end the persistent session
                    LOGGER.log(Level.FINE, "T: Limit reached, locking session. !!!");
                    transferClient.transferService
                            .lockPersistentTransfer(Transferd.LockPersistentTransferRequest
                                    .newBuilder().setTransferId(transferId).build());
                }
            } catch (final IOException e) {
                LOGGER.log(Level.FINE, "T: ERROR: {0}", e.getMessage());
            }
        }
    } // FileUploadTask

    public static void main(String... args)
            throws Exception, IOException, java.net.URISyntaxException {
        final Configuration config = new Configuration(args);
        final TransferClient transferClient = new TransferClient(config);
        try {
            final URI server_ssh_url = new URI(config.getParamStr("server", "url"));
            // transfer spec version 1 (JSON)
            final JSONObject transferSpec = new JSONObject().put("title", "server upload V1")
                    .put("remote_host", server_ssh_url.getHost())
                    .put("ssh_port", server_ssh_url.getPort())
                    .put("remote_user", config.getParamStr("server", "username"))
                    .put("remote_password", config.getParamStr("server", "password"))
                    .put("direction", "send")
                    .put("destination_root", config.getParamStr("server", "folder_upload"));
            transferClient.daemon_startup();
            transferClient.daemon_connect();
            // start persistent transfer session
            transferClient.session_start(transferSpec, Transferd.TransferType.FILE_PERSISTENT);
            final TimerTask timerTask =
                    new FileUploadTask(transferClient, config.getParamInt("server", "persist_max"));
            final Timer timer = new Timer(true);
            // 1.task 2.initial delay(ms) 3.execution period(ms)
            timer.scheduleAtFixedRate(timerTask, 1000, config.getParamInt("server", "persist_ms"));
            transferClient.session_wait_for_completion();
        } finally {
            transferClient.shutdown();
        }
        LOGGER.log(Level.FINE, "L: exiting program");
    }
}
