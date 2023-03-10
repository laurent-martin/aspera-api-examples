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

// read configuration file and provide interface for transfer
public class TestEnvironment {
	static final String SDK_URL = "trsdk_url";
	// config filer loaded from yaml
	public Map<String, Map<String, String>> config;
	// Aspera client
	public TransferServiceGrpc.TransferServiceBlockingStub client;
	// several transfer session may be started but for the example we use only one
	public String transferId;

	public String getProp(final String name) {
		final String prop_val = System.getProperty(name);
		if (prop_val == null)
			throw new Error("mandatory property not set: " + name);
		return prop_val;
	}

	public TestEnvironment() {
		try {
			final String config_filepath = getProp("config_yaml");
			config = new Yaml().load(new java.io.FileReader(config_filepath));
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
				System.out.println("Checking gRPC connection");
				client.getAPIVersion(Transfer.APIVersionRequest.newBuilder().build());
				System.out.println("OK: Daemon is here.");
				isStarted = true;
			} catch (final io.grpc.StatusRuntimeException e) {
				System.out.println("KO: Daemon is not here.");
				try {
					final String daemon_filepath = getProp("daemon");
					final String sdk_conf_path = getProp("config_daemon");
					System.out.println(
							"Starting daemon: " + daemon_filepath + " -c " + sdk_conf_path);
					Runtime.getRuntime().exec(new String[] {daemon_filepath, "-c", sdk_conf_path});
					Thread.sleep(5000);
				} catch (final IOException e2) {
					System.out.println("FAILED: cannot start daemon: " + e2.getMessage());
					System.exit(1);
				} catch (final InterruptedException e2) {
					throw new Error(e2.getMessage());
				}
			}
			--remaining_try;
		}
		if (!isStarted) {
			System.out.println(
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
		System.out.println(String.format("transfer session started with id %s / %d", transferId,
				transferResponse.getStatus().getNumber()));
	}

	public void wait_transfer() {
		System.out.println("L: Getting session events");
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
			System.out.println("L: transfer event: " + response.getTransferEvent());
			System.out.println("L: file info: " + response.getFileInfo());
			System.out.println("L: status: " + status.toString());
			System.out.println("L: message: " + response.getMessage());
			System.out.println("L: err: " + response.getError());

			if (status == Transfer.TransferStatus.FAILED
					|| status == Transfer.TransferStatus.COMPLETED) {
				// || response.getTransferEvent() == Transfer.TransferEvent.FILE_STOP) {
				System.out.println("L: upload finished, received: " + status.toString());
				break;
			}
		}
		System.out.println("L: Finished monitoring loop");
	}

	public void start_transfer_and_wait(final String transferSpec) {
		start_transfer(transferSpec, Transfer.TransferType.FILE_REGULAR);
		wait_transfer();
	}
}
