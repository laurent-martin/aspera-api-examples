package client;

import ibm.aspera.transferservice.Transfer;
import org.json.JSONObject;
import java.net.URI;
import java.util.Map;
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
		private final int maxFiles;
		private final boolean useRealFile;
		private int sequenceIndex;

		FileUploadTask(final TransferClient transferClient, final int maxFiles) {
			this.transferClient = transferClient;
			this.maxFiles = maxFiles;
			// only real files are supported in persistent session
			this.useRealFile = true;
			sequenceIndex = 0;
		}

		// this is the recurring task
		public void run() {
			try {
				LOGGER.log(Level.FINE, "T: >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>");
				LOGGER.log(Level.FINE, "T: Task {0} scheduled ...executing now",
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
				++sequenceIndex;
				// add paths of files to transfer to persistent session
				final Transfer.TransferPathRequest transferPathRequest =
						Transfer.TransferPathRequest.newBuilder()
								.setTransferId(transferClient.getTransferId())
								.addTransferPath(Transfer.TransferPath.newBuilder()
										.setSource(filePath).setDestination(fileName).build())
								.build();
				LOGGER.log(Level.FINE, "T: adding transfer path");
				// this will add to the transfer queue
				transferClient.transferService.addTransferPaths(transferPathRequest);
				LOGGER.log(Level.FINE, "T: end task");
				if (sequenceIndex == maxFiles) {
					// end the persistent session
					LOGGER.log(Level.FINE, "T: Limit reached, locking session. !!!");
					transferClient.transferService.lockPersistentTransfer(
							Transfer.LockPersistentTransferRequest.newBuilder()
									.setTransferId(transferClient.getTransferId()).build());
				}
			} catch (final IOException e) {
				LOGGER.log(Level.FINE, "T: ERROR: {0}", e.getMessage());
			}
		}
	} // FileUploadTask

	public static void main(String... args)
			throws Exception, IOException, java.net.URISyntaxException {
		if (args.length > 2) {
			throw new Exception("Usage: PersistentUploadExample [<max files>] [<delay ms>]");
		}
		int max_files = 100;
		if (args.length > 0) {
			max_files = Integer.parseInt(args[0]);
		}
		int ms_between_files = 100;
		if (args.length > 1) {
			ms_between_files = Integer.parseInt(args[1]);
		}
		final Configuration config = new Configuration();
		final TransferClient transferClient = new TransferClient(config);
		final URI server_ssh_url = new URI(config.getParamStr("server", "url"));
		// transfer spec version 1 (JSON)
		final JSONObject transferSpec = new JSONObject().put("title", "server upload V1")
				.put("remote_host", server_ssh_url.getHost())
				.put("ssh_port", server_ssh_url.getPort())
				.put("remote_user", config.getParamStr("server", "user"))
				.put("remote_password", config.getParamStr("server", "pass"))
				.put("direction", "send").put("destination_root", "/Upload");
		transferClient.startup();
		// start persistent transfer session
		transferClient.start_transfer(transferSpec, Transfer.TransferType.FILE_PERSISTENT);
		final TimerTask timerTask = new FileUploadTask(transferClient, max_files);
		final Timer timer = new Timer(true);
		// 1.task 2.delay(ms) 3.period(ms)
		timer.scheduleAtFixedRate(timerTask, 1000, ms_between_files);
		// This loops in getting statuses
		transferClient.wait_transfer();
		transferClient.shutdown();
		LOGGER.log(Level.FINE, "L: exiting program");
	}
}
