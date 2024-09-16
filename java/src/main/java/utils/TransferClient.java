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

	public final Configuration config;
	// Aspera client
	public TransferServiceGrpc.TransferServiceBlockingStub transferService = null;
	// several transfer session may be started but for the example we use only one
	private String transferId;
	private final URI grpcURL;
	private final String daemonExecutable;
	private final String archFolder;
	private Process daemon_process;

	public TransferClient(final Configuration aTools) {
		config = aTools;
		try {
			grpcURL = new URI(config.getParamStr("trsdk", "url"));
			final String platform = config.getParamStr("misc", "platform");
			archFolder = config.getPath("sdk_root", platform);
			daemonExecutable = config.getPath("sdk_root", platform, TRANSFER_SDK_DAEMON);
		} catch (final java.net.URISyntaxException e) {
			throw new Error("problem with SDK URL: " + e.getMessage());
		}
	}

	public String getTransferId() {
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

	public void start_daemon() {
		Process started_process = null;
		// Define the paths
		String sdk_conf_path = new File(config.getLogFolder(), "daemon.conf").toString();
		createConfFile(sdk_conf_path);
		try {
			String[] command = new String[] {daemonExecutable, "-c", sdk_conf_path};
			LOGGER.log(Level.INFO, "Starting daemon: {0} {1} {2}", command);
			started_process = Runtime.getRuntime().exec(command);
			Thread.sleep(5000);
		} catch (final IOException e2) {
			LOGGER.log(Level.SEVERE, "FAILED: cannot start daemon: {0}", e2.getMessage());
			System.exit(1);
		} catch (final InterruptedException e2) {
			throw new Error(e2.getMessage());
		}
		daemon_process = started_process;
	}

	void connect_to_daemon() {
		LOGGER.log(Level.INFO, "L: Connecting to daemon");
		// create channel to socket
		final ManagedChannel channel = ManagedChannelBuilder
				.forAddress(grpcURL.getHost(), grpcURL.getPort()).usePlaintext().build();
		// create a connection to the Transfer SDK daemon
		transferService = TransferServiceGrpc.newBlockingStub(channel);
		LOGGER.log(Level.INFO, "Checking gRPC connection");
		Transfer.InstanceInfoResponse infoResponse =
				transferService.getInfo(Transfer.InstanceInfoRequest.newBuilder().build());
		LOGGER.log(Level.INFO, "OK: Daemon is here, API v = {0}", infoResponse.getApiVersion());
	}

	public void startup() {
		if (transferService == null) {
			start_daemon();
			connect_to_daemon();
		}
	}

	public void shutdown() {
		if (daemon_process != null) {
			LOGGER.log(Level.INFO, "L: Shutting down daemon");
			daemon_process.destroy();
		}
	}

	public void start_transfer_and_wait(final JSONObject transferSpec) {
		startup();
		start_transfer(transferSpec, Transfer.TransferType.FILE_REGULAR);
		wait_transfer();
		shutdown();
	}

	public void start_transfer(final JSONObject transferSpec,
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

	public void wait_transfer() {
		LOGGER.log(Level.FINE, "L: Getting session events");
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
			LOGGER.log(Level.FINE, "L: file info: {0}",
					response.getFileInfo().toString().replaceAll("\\n", ", "));
			LOGGER.log(Level.INFO, "L: status: {0}", status.toString());
			LOGGER.log(Level.FINE, "L: message: {0}", response.getMessage());
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
