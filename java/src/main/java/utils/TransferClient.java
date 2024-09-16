package utils;

import ibm.aspera.transferservice.Transfer;
import ibm.aspera.transferservice.TransferServiceGrpc;
import io.grpc.ManagedChannelBuilder;
import io.grpc.ManagedChannel;
import org.json.JSONObject;

import java.io.IOException;
import java.io.FileWriter;
import java.io.File;
import java.net.URI;
import java.util.Iterator;
import java.util.logging.Logger;
import java.util.logging.Level;

// read configuration file and provide interface for transfer
public class TransferClient {
	private static final Logger LOGGER = Logger.getLogger(TransferClient.class.getName());
	private static final String TRANSFER_SDK_DAEMON = "asperatransferd";

	// configuration parameters from the configuration file
	public final Configuration config;
	// process for the daemon
	private Process daemon_process;
	// Aspera client API (synchronous)
	public TransferServiceGrpc.TransferServiceBlockingStub transferService = null;
	// several transfer session may be started but for the example we use only one
	private String transferId;
	private final URI grpcURL;
	private final String daemonExecutable;
	private final String archFolder;

	public TransferClient(final Configuration aConfig) {
		config = aConfig;
		transferId = null;
		try {
			grpcURL = new URI(config.getParamStr("trsdk", "url"));
			final String platform = config.getParamStr("misc", "platform");
			archFolder = config.getPath("sdk_root", platform);
			daemonExecutable = config.getPath("sdk_root", platform, TRANSFER_SDK_DAEMON);
		} catch (final java.net.URISyntaxException e) {
			throw new Error("problem with SDK URL: " + e.getMessage());
		}
	}

	// @return current session transfer id
	public String getTransferId() {
		if (transferId == null)
			throw new Error("transfer session was not started");
		return transferId;
	}

	/// Create configuration file for the Aspera Transfer SDK
	private void createConfFile(final String confFile) {
		// Define the configuration JSON object
		JSONObject sdk_config = new JSONObject() //
				.put("address", grpcURL.getHost()) //
				.put("port", grpcURL.getPort()) //
				.put("log_directory", config.getLogFolder()) //
				.put("log_level", "debug") //
				.put("fasp_runtime", new JSONObject() //
						.put("use_embedded", false) //
						.put("user_defined", new JSONObject() //
								.put("bin", archFolder) //
								.put("etc", config.getPath("trsdk_noarch"))) //
						.put("log", new JSONObject() //
								.put("dir", config.getLogFolder()) //
								.put("level", 0)));
		// Write the JSON to a file
		try (final FileWriter fileWriter = new FileWriter(confFile)) {
			fileWriter.write(sdk_config.toString());
		} catch (final IOException e) {
			e.printStackTrace();
			throw new Error("problem with SDK configuration file: " + e.getMessage());
		}
	}

	public void daemon_startup() {
		Process started_process = null;
		// Define the paths
		String sdk_conf_path = new File(config.getLogFolder(), "daemon.conf").toString();
		createConfFile(sdk_conf_path);
		try {
			String[] command = new String[] {daemonExecutable, "-c", sdk_conf_path};
			LOGGER.log(Level.INFO, "Starting daemon: {0} {1} {2}", command);
			started_process = Runtime.getRuntime().exec(command);
			// wait for the daemon to start
			final boolean hasTerminated =
					started_process.waitFor(2, java.util.concurrent.TimeUnit.SECONDS);
			if (hasTerminated) {
				LOGGER.log(Level.SEVERE, "new daemon terminated unexpectedly");
				throw new Error("new daemon terminated unexpectedly");
			}
		} catch (final IOException e) {
			LOGGER.log(Level.SEVERE, "cannot start daemon: {0}", e.getMessage());
			throw new Error(e.getMessage());
		} catch (final InterruptedException e) {
			throw new Error(e.getMessage());
		}
		daemon_process = started_process;
	}

	public void daemon_connect() {
		if (transferService != null)
			throw new Error("already connected to daemon");
		LOGGER.log(Level.INFO, "L: Connecting to daemon");
		// create channel to socket
		final ManagedChannel channel = ManagedChannelBuilder
				.forAddress(grpcURL.getHost(), grpcURL.getPort()).usePlaintext().build();
		// create a connection to the Transfer SDK daemon
		// Note that this is a synchronous client here
		// async is also possible
		transferService = TransferServiceGrpc.newBlockingStub(channel);
		LOGGER.log(Level.INFO, "Checking gRPC connection");
		// make a simple api call to check communication is ok
		Transfer.InstanceInfoResponse infoResponse =
				transferService.getInfo(Transfer.InstanceInfoRequest.newBuilder().build());
		LOGGER.log(Level.INFO, "OK: Daemon is here, API v = {0}", infoResponse.getApiVersion());
	}



	public void daemon_shutdown() {
		if (daemon_process != null) {
			LOGGER.log(Level.INFO, "L: Shutting down daemon");
			daemon_process.destroy();
			try {
				final int exitStatus = daemon_process.waitFor();
				LOGGER.log(Level.INFO, "L: daemon exited with status {0}", exitStatus);
			} catch (final InterruptedException e) {
				LOGGER.log(Level.SEVERE, "L: error waiting for daemon to shutdown: {0}",
						e.getMessage());
			}
			daemon_process = null;
		}
	}


	// helped method for simple examples
	public void start_transfer_and_wait(final JSONObject transferSpec) {
		daemon_startup();
		daemon_connect();
		if (config.getParamBool("misc", "transfer_regular"))
			session_start(transferSpec, Transfer.TransferType.FILE_REGULAR);
		else
			session_start_streaming(transferSpec);
		session_wait_for_completion();
		daemon_shutdown();
	}

	// start one transfer session
	public void session_start(final JSONObject transferSpec,
			final Transfer.TransferType aTransferType) {
		LOGGER.log(Level.INFO, "L: ts: {0}", transferSpec.toString());
		// send start transfer request to transfer sdk daemon
		final Transfer.StartTransferResponse transferResponse = transferService
				.startTransfer(Transfer.TransferRequest.newBuilder().setTransferType(aTransferType)
						.setConfig(Transfer.TransferConfig.newBuilder().build())
						.setTransferSpec(transferSpec.toString()).build());
		transferId = transferResponse.getTransferId();
		LOGGER.log(Level.FINE, "transfer session started with id {0} / {1}",
				new Object[] {transferId, transferResponse.getStatus().getNumber()});
	}

	private void session_start_streaming(final JSONObject transferSpec) {
		session_start(transferSpec, Transfer.TransferType.STREAM_TO_FILE_UPLOAD);
		// throw new Error("not implemented");
	}

	public void session_wait_for_completion() {
		LOGGER.log(Level.FINE, "L: Wait for session completion");
		final Iterator<Transfer.TransferResponse> monitorTransferResponse =
				transferService.monitorTransfers(Transfer.RegistrationRequest.newBuilder()
						.addFilters(Transfer.RegistrationFilter.newBuilder()
								.setOperator(Transfer.RegistrationFilterOperator.OR)
								.addTransferId(transferId).build())
						.build());
		// monitor transfer until it finishes
		while (monitorTransferResponse.hasNext()) {
			final Transfer.TransferResponse response = monitorTransferResponse.next();
			final Transfer.TransferStatus status = response.getStatus();
			LOGGER.log(Level.FINE, "L: transfer event: {0}", response.getTransferEvent());
			if (response.hasFileInfo())
				LOGGER.log(Level.FINE, "L: file info: {0}",
						response.getFileInfo().toString().replaceAll("\\n", ", "));
			LOGGER.log(Level.INFO, "L: status: {0}", status.toString());
			LOGGER.log(Level.FINE, "L: message: {0}", response.getMessage());
			if (response.hasError())
				LOGGER.log(Level.FINE, "L: err: {0}", response.getError());
			if (status == Transfer.TransferStatus.FAILED
					|| status == Transfer.TransferStatus.COMPLETED) {
				// || response.getTransferEvent() == Transfer.TransferEvent.FILE_STOP) {
				LOGGER.log(Level.INFO, "L: upload finished, received: {0}", status);
				break;
			}
		}
		LOGGER.log(Level.FINE, "L: Finished monitoring loop");
	}
}
