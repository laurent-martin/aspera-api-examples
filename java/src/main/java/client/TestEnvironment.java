package client;

import ibm.aspera.transferservice.Transfer;
import ibm.aspera.transferservice.TransferServiceGrpc;
import io.grpc.ManagedChannelBuilder;
import io.grpc.ManagedChannel;
import org.yaml.snakeyaml.Yaml;

import java.io.IOException;
import java.net.URI;
import java.util.Map;
import java.util.Iterator;
import java.util.logging.Logger;
import java.util.logging.Level;
import java.nio.file.FileSystems;
import java.nio.file.Path;

// read configuration file and provide interface for transfer
public class TestEnvironment {
	private static final Logger LOGGER = Logger.getLogger(TestEnvironment.class.getName());
	static final String SDK_URL = "trsdk_url";
	static final String PATHS_FILES = "config/paths.yaml";
	static final String TRANSFERD_EXECUTABLE = "asperatransferd";

	// config filer loaded from yaml
	public Map<String, Map<String, String>> config;
	// Aspera client
	public TransferServiceGrpc.TransferServiceBlockingStub client;
	// several transfer session may be started but for the example we use only one
	public String transferId;
	final String daemon_executable;
	final String sdk_conf_path;

	public TestEnvironment() {
		try {
			final String dir_top = System.getProperty("dir_top");
			if (dir_top == null)
				throw new Error("mandatory property not set: dir_top");
			final String paths_config_file =
					FileSystems.getDefault().getPath(dir_top, PATHS_FILES).toString();
			final Map<String, String> paths =
					new Yaml().load(new java.io.FileReader(paths_config_file));
			final String config_filepath =
					FileSystems.getDefault().getPath(dir_top, paths.get("mainconfig")).toString();
			config = new Yaml().load(new java.io.FileReader(config_filepath));
			daemon_executable =
					FileSystems.getDefault()
							.getPath(dir_top, paths.get("sdk_root"),
									config.get("misc").get("system_type"), TRANSFERD_EXECUTABLE)
							.toString();
			sdk_conf_path =
					FileSystems.getDefault().getPath(dir_top, paths.get("sdk_conf")).toString();
		} catch (final java.io.FileNotFoundException e) {
			throw new Error(e.getMessage());
		}
		try {
			final URI grpc_url = new URI(config.get("misc").get(SDK_URL));
			// create channel to socket
			final ManagedChannel channel = ManagedChannelBuilder
					.forAddress(grpc_url.getHost(), grpc_url.getPort()).usePlaintext().build();
			// create a connection to the transfer sdk daemon
			client = TransferServiceGrpc.newBlockingStub(channel);
		} catch (final java.net.URISyntaxException e) {
			throw new Error(SDK_URL + ": " + e.getMessage());
		}
		boolean isStarted = false;
		int remaining_try = 2;
		while (!isStarted && remaining_try > 0) {
			try {
				LOGGER.log(Level.FINE, "Checking gRPC connection");
				client.getAPIVersion(Transfer.APIVersionRequest.newBuilder().build());
				LOGGER.log(Level.FINE, "OK: Daemon is here.");
				isStarted = true;
			} catch (final io.grpc.StatusRuntimeException e) {
				LOGGER.log(Level.FINE, "KO: Daemon is not here.");
				try {
					LOGGER.log(Level.FINE, "Starting daemon: {0} -c {1}",
							new Object[] {daemon_executable, sdk_conf_path});
					Runtime.getRuntime()
							.exec(new String[] {daemon_executable, "-c", sdk_conf_path});
					Thread.sleep(5000);
				} catch (final IOException e2) {
					LOGGER.log(Level.FINE, "FAILED: cannot start daemon: {0}", e2.getMessage());
					System.exit(1);
				} catch (final InterruptedException e2) {
					throw new Error(e2.getMessage());
				}
			}
			--remaining_try;
		}
		if (!isStarted) {
			LOGGER.log(Level.FINE,
					"FAILED: API daemon did not start.Please start it manually by executing \"make startdaemon\" in a separate terminal from the top folder.");
			System.exit(1);
		}
	}

	public void start_transfer(final String transferSpec,
			final Transfer.TransferType aTransferType) {
		// send start transfer request to transfer sdk daemon
		final Transfer.StartTransferResponse transferResponse = client
				.startTransfer(Transfer.TransferRequest.newBuilder().setTransferType(aTransferType)
						.setConfig(Transfer.TransferConfig.newBuilder().build())
						.setTransferSpec(transferSpec).build());
		transferId = transferResponse.getTransferId();
		LOGGER.log(Level.FINE, "transfer session started with id {0} / {1}",
				new Object[] {transferId, transferResponse.getStatus().getNumber()});
	}

	public void wait_transfer() {
		LOGGER.log(Level.FINE, "L: Getting session events");
		final Iterator<Transfer.TransferResponse> monitorTransferResponse =
				client.monitorTransfers(Transfer.RegistrationRequest.newBuilder()
						.addFilters(Transfer.RegistrationFilter.newBuilder()
								.setOperator(Transfer.RegistrationFilterOperator.OR)
								.addTransferId(transferId).build())
						.build());

		// monitor transfer until it finishes
		while (monitorTransferResponse.hasNext()) {
			final Transfer.TransferResponse response = monitorTransferResponse.next();
			// status is enum
			final Transfer.TransferStatus status = response.getStatus();
			LOGGER.log(Level.FINE, "L: transfer event: {0}", response.getTransferEvent());
			LOGGER.log(Level.FINE, "L: file info: {0}",
					response.getFileInfo().toString().replaceAll("\\n", ", "));
			LOGGER.log(Level.FINE, "L: status: {0}", status.toString());
			LOGGER.log(Level.FINE, "L: message: {0}", response.getMessage());
			LOGGER.log(Level.FINE, "L: err: {0}", response.getError());

			if (status == Transfer.TransferStatus.FAILED
					|| status == Transfer.TransferStatus.COMPLETED) {
				// || response.getTransferEvent() == Transfer.TransferEvent.FILE_STOP) {
				LOGGER.log(Level.FINE, "L: upload finished, received: {0}", status);
				break;
			}
		}
		LOGGER.log(Level.FINE, "L: Finished monitoring loop");
	}

	public void start_transfer_and_wait(final String transferSpec) {
		start_transfer(transferSpec, Transfer.TransferType.FILE_REGULAR);
		wait_transfer();
	}
}
