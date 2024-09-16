package utils;

import ibm.aspera.transferservice.Transfer;
import ibm.aspera.transferservice.TransferServiceGrpc;
import io.grpc.ManagedChannelBuilder;
import io.grpc.ManagedChannel;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.io.FileWriter;
import java.io.File;
import java.net.URI;
import java.util.Iterator;
import java.util.logging.Logger;
import java.util.logging.Level;

/** Read configuration file and provide interface for transfer */
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

	/** @return current session transfer id */
	public String getTransferId() {
		if (transferId == null)
			throw new Error("transfer session was not started");
		return transferId;
	}

	/** Create configuration file for the Aspera Transfer SDK */
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

	/** Helper method for simple examples */
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

	/** Start one transfer session */
	public void session_start(final JSONObject transferSpec,
			final Transfer.TransferType aTransferType) {
		LOGGER.log(Level.INFO, "L: ts: {0}", transferSpec.toString());
		// send start transfer request to transfer sdk daemon
		final Transfer.StartTransferResponse transferResponse = transferService.startTransfer(//
				Transfer.TransferRequest.newBuilder() //
						.setTransferType(aTransferType)
						.setConfig(Transfer.TransferConfig.newBuilder().build())
						.setTransferSpec(transferSpec.toString()).build());
		transferId = transferResponse.getTransferId();
		LOGGER.log(Level.FINE, "transfer session started with id {0} / {1}",
				new Object[] {transferId, transferResponse.getStatus().getNumber()});
	}

	private void session_start_streaming(final JSONObject transferSpec) {
		// bug in sdk 1.1.3, does not set ssh default key in stream mode
		transferSpec.put("ssh_private_key",
				"-----BEGIN RSA PRIVATE KEY-----\nMIIJKAIBAAKCAgEA4FbWABq7/xksqaNSJWrhTIwwmsDKEUALyzu9U3OSsJawBUV5JXE0WdkF7Igx7LIdCk1Y5jUsuxV3HDJSQlzAE8l3kd7I2NiXXJNzVhPPShSGkqf/gOgBWL+qyaqavGsWx5gbkAOxkWzkoVrdebWdGsVgj9LEa9NvdWw6/blm4JBUtJY6+d/N/QDmfXm1nDVqQGrwfRVOUTD8JmJtoYb4SjO0tKmqt9IDdx5qxEXDX9zHpyl0rk6eoSjtNA/KIVkuUiT7I7rejv2leHeui91Q+j5jfiXcVq88zVl+7Mr0Hf1u6aX8Nmf0rvMYdp1AtPRuzjd4+q5Sl+EZN42IDjNItcvFcAj52Nvg3UVsqsDhWZb+bZmVSGJAvFHYUbt4XSJp57g7xwy/PIPwmhM7jhmC6DFbUR/NoGqEGOJ+48iZOIp3OHfYvCZJ5eibTj33OaXh0Zh450rqb7h2gLOGmadMGonfxeFMiNJgnyCnvv1W8cjmZ/ZuG9/FwjKE8nxJo0u7OfUYcXyuyRHcyQtZaVg/d22fyeo8zMwyXyaTeHAyEmPad4S30dTNbbpReOLHL+ep9/Fw8s5LY+namtT/4SToDloZ7EXvE2osHRAOhBKh8FBKdrEpyzZ5OY30HrZ4t3r82ouC8ufAymPhN9ZeTOtPggtnTHBxCbxf+QKiZqD4zs0CAwEAAQKCAgB4Xb8GYVG7BmvTPODHWLg3VQSDE6uXY9CwI4ZqbxkmjEM3INZmQ33+MxYdmdmHkO1J6MQpCCDO5C57P3ipSJB6TV9NMcZ7qoJT1n1MkuZmberiZycMp+6JCpV9DH9nVuHrB27Kb2DnkRB+jn1EXzBC++HaaRCgddpYm1Bvb/mFxYrdNbnA9dbUx5Xjftj1TieLFpWf1z2lDG5NvgPqZbt0PJfZUytY42KemABa/L9eANxSkUiceWxdNdNHWq1uBSZ4RoVE32+oMumEYFqTipR3H+BL/85f6DfsSfdy31XpfV/0Fu3i1xYOhDn88lSUgo2tMVBE2CFSgiEAkHyOee+pMaHl2MB72p1A+1tCrrm1v6hJohw2pcN4WVZQwZ0olhO4Z5zMhqyRNU5YLKaBnZaXHDSOYrqPakd4fjM7ns3uS2dMfaE1RsO9VNH/lXPSUsMGbLFnNmwqR8rT8xFysMxeDbZmyLHZzkIBhJxICjkRWoWT1dqThwDbwlka0G1y+l763aceSMStUA1q05OSENXb/+y7rashUbJoniO6COBbpZFw6shYG9mvSegqcoKX8rIa17ax0VoUqrnfRQ798P41t8zHGqKVarGnuIn+Yy+Ms6iA8mXcDHXjIib4fPXFOIFaBhmHIqQkp+L4wruFUeXqaCTbNjXFC6B9IBFPAm8EQQKCAQEA+at/x0cb61e/tula74vO4jJl76SmJI4L5msrlXegy385Zr36+NhNT1HsfO45Hm0xJJRiik3S6b63G/bB8CH1ssBn2V0V4KHZpAmhPKe1kWw9TcP9PAUHekeYmLUKeljIjqG0jC5Rr33mun5c9H3eQqxEBuaxZzGVYZRFMUdC89PMZ3GbjRQn+R2sZZeUVdYBvLGBUCX3ZTGsl02rlFE/416ubB4RjABJWTCbFY6c5Gx9UQBQA4z4qw2n80jKq5RZBW9qMJ/1B/JKAr+THV/Wy5vDu2RL7W9dN5EUl6zudrUefKRjzSt7YjWaOo6XA05vmu9H5wM5E9F63VibEJWdPQKCAQEA5gbtCo+8ohL8qNRqOUfSd11o4/GiB7D4W8TKH/1qFYWpgscwjt/Sg7W5aRYBpEAPVy9bgPCYvGmoeGwtRobRjNpZ6bpZS/2BG0lxt7ttZ5HPrDMToWOhGlzrqIkbUFcIjQk5HJ4e6AhLxXS8x+RBNjHD7RglpxNmxDjpY3+h4BkwB43zqZ417JXxNnlBrkIypc7uDYr4ZoCarQ+8H8tEvwOa0gPxisF8Nn+aeZzhSCufpDjMfl+VpcyqM8GBihBAG/hZxM4NPmBzeyRqxaUdGUYClDkbPGowuzgpJHrp14nBqwAZFnBM34cxydJCIW/4ykU4TML+YFawwTsYdDgw0QKCAQA5Coql/8QML78YThY9lmaM3VDWwHpI7b8gRKnveyZcd9Ooeo0lX13CWog6Pr8ECZRptBETYhZm2vDAzc6fS1L0JOtVCORfrvqndJ/G2NYtxFn5M2be2JNNx5/Ae9RKAZDIrX8va8Gz44LcZtRb84ndF7hvDzPGzNhBM/ve91X/mQshMx6Dy/AaBUKG72uvdLZu4usVYac1EnVJGDC0MR/0lYQqJXCC2OnpG6bC9RM5SOQUpoqhVQrXIcaWWbIcI0d3a24Kb/EugJeSKyy0UFolqI++d3q1Y3UbpeTbhmHw8w5lEbXPgTiuRmrXKA6ubbQn5LU7vUvEEF8OxRigYF5NAoIBAHgNTVGhyvVbq3oBwp66mWGq4r90sPgKqNRcVJF1lRQ+ekXC59jpf9k10trBnYG33UnHcZ5N86kCC+ctrkOMwXkdzKdrlodOez9eiXc23tabByP8VFZ6xO4ZaPTA+fxoMBJLqf8Bl2fKTKF1V8GLo21Bc9weKiiUu6HVghln13g6LRMERxNTexlK+GVRy7HC4uQep6dxzErS++cuuyRs1ihLHVZWsI2Whdl7p4epFPqxqdPvwOqDwHqT4pC4gX8pFAyFBXTthYP0mtC+JOuaTSGPpHDvjQNu+Jf9q5taewj+4JD6sB1B5x0SVi3bCqCg69vFXKjTbCejlwSCbzTYzsECggEBAMCNNiKauEhST912LERrIUHFeyfmlN3Jgp0P/HVrS7o6aIGxx1lL9UZBy/m6vTj0fhaaHAsAdnpXtFF3lc/++szeySYxJqbtM4uNKZvZidl26sl9T3ifjihipkfXslJvUTIPRvpVfvAwassEMAuEZwmq1PZdueDD4A7YO5xMMFMw68i0P/ihcLzN2x4g5lLYReVM+G4uuMgHIFqPFe/thZ5r0frQ+cmH5yeqXBESChN8iiMfh7qZs0pLcOqKUk/evYQiDgg5TgGyMeQtr5xOcM7GRp22D3cgfGrhvYEWw8UY2A0a4A5ZQ1y1WF05fePGKdSRMudbSG0Zg9c4rq7uH28=\n-----END RSA PRIVATE KEY-----");
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

	/**
	 * Fill the transfer spec with the file paths provided on command line
	 */
	public void fillFilePaths(final JSONObject transferSpec) {
		final var paths = new JSONArray();
		for (final var fileToSend : config.getFileList())
			paths.put(new JSONObject().put("source", fileToSend));
		transferSpec.put("paths", paths);
	}
}
