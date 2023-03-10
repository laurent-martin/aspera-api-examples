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


public class PersistentUploadExample {

	public static class FileUploadTask extends TimerTask {

		private int mSequenceIndex;

		private final TestEnvironment mTestEnv;

		private final int mMax;

		private final boolean mUseRealFile;

		FileUploadTask(final TestEnvironment aTestEnv, int aMax) {
			mSequenceIndex = 0;
			mTestEnv = aTestEnv;
			mMax = aMax;
			// only real files are supported in persistent session
			mUseRealFile = true;
		}

		// this is the recurring task
		public void run() {
			try {
				System.out.println("T: >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>");
				System.out.println(
						String.format("T: Task %d scheduled ...executing now", mSequenceIndex));
				// generate example file to transfer
				final String fileName = String.format("file%03d", mSequenceIndex);
				String filePath = null;

				if (mUseRealFile) {
					final File file =
							new File(System.getProperty("java.io.tmpdir") + "/" + fileName);
					final FileWriter writer = new FileWriter(file);
					writer.write(String.format("Hello World %d!", mSequenceIndex));
					writer.close();
					filePath = file.getAbsolutePath();
				} else {
					filePath = String.format("faux:///file%03d?1k", mSequenceIndex);
				}
				++mSequenceIndex;
				// add paths of files to transfer to persistent session
				final Transfer.TransferPathRequest transferPathRequest =
						Transfer.TransferPathRequest.newBuilder().setTransferId(mTestEnv.transferId)
								.addTransferPath(Transfer.TransferPath.newBuilder()
										.setSource(filePath).setDestination(fileName).build())
								.build();
				System.out.println("T: adding transfer path");
				// this will add to the transfer queue
				mTestEnv.client.addTransferPaths(transferPathRequest);
				System.out.println("T: end task");
				if (mSequenceIndex == mMax) {
					// end the persistent session
					System.out.println("T: Limit reached, locking session. !!!");
					mTestEnv.client.lockPersistentTransfer(Transfer.LockPersistentTransferRequest
							.newBuilder().setTransferId(mTestEnv.transferId).build());
				}
			} catch (final IOException e) {
				System.out.println("T: ERROR: " + e.getMessage());
			}
		}
	} // FileUploadTask

	public static void main(String... args)
			throws Exception, IOException, java.net.URISyntaxException {
		if (args.length != 2) {
			throw new Exception("Usage: sample <max files> <delay ms>");
		}
		final int max_files = Integer.parseInt(args[0]);
		final int ms_between_files = Integer.parseInt(args[1]);
		// get simplified testing environment, ensures that transfer daemon is started
		final TestEnvironment test_environment = new TestEnvironment();
		// get test server address and credentials from configuration file
		final Map<String, String> server_conf =
				(Map<String, String>) test_environment.config.get("server");
		final URI server_ssh_url = new URI(server_conf.get("url"));
		// transfer spec version 1 (JSON)
		final JSONObject transferSpec = new JSONObject().put("title", "server upload V1")
				.put("remote_host", server_ssh_url.getHost())
				.put("ssh_port", server_ssh_url.getPort())
				.put("remote_user", server_conf.get("user"))
				.put("remote_password", server_conf.get("pass")).put("direction", "send")
				.put("destination_root", "/Upload");
		// start persistent transfer session
		test_environment.start_transfer(transferSpec.toString(),
				Transfer.TransferType.FILE_PERSISTENT);

		final TimerTask timerTask = new FileUploadTask(test_environment, max_files);
		final Timer timer = new Timer(true);
		timer.scheduleAtFixedRate(timerTask, 1000, ms_between_files); // 1.task 2.delay(ms)
																		// 3.period(ms)
		// This loops in getting statuses
		test_environment.wait_transfer();

		System.out.println("L: exiting program");
	}
}
