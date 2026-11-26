// Simplified access to Aspera Transfer Daemon client
package utils

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	pb "aspera_examples/build/grpc_aspera"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

const (
	ASCP_LOG_FILE = "aspera-scp-transfer.log"
	// default port of transferd if not specified in URL
	TRANSFERD_DEFAULT_PORT = 55002
	// max wait time for the connection to the daemon
	CONNECT_TIMEOUT = 5 * time.Second
	// max wait time for the daemon to write its port file
	STARTUP_TIMEOUT = 10 * time.Second
	// max wait time for the daemon to stop gracefully
	SHUTDOWN_TIMEOUT = 10 * time.Second
	// extension of the port file, written in `runtime_dir` with port 0: `transferd.<port>.optport`
	PORT_FILE_EXTENSION = ".optport"
)

// TransferClient is a client of the Aspera Transfer Daemon (transferd): start the daemon, start transfers and wait for their end.
type TransferClient struct {
	config             *Configuration
	serverAddress      string
	serverPort         int
	transferDaemonProc *exec.Cmd
	// receives the result of Wait() when the daemon exits
	daemonExited    chan error
	channel         *grpc.ClientConn
	transferService pb.TransferServiceClient
	daemonName      string
	// folder of the configuration, output and logs of the daemon: a new one for each start
	daemonFolder string
	daemonLog    string
	// `runtime_dir` of the daemon, where it writes its port file: only with port 0
	runtimeDir string
}

// NewTransferClient creates a transfer client.
//
// Parameters:
//   - config: configuration of the samples
//
// Returns: transfer client
func NewTransferClient(config *Configuration) *TransferClient {
	sdkURL, err := url.Parse(config.ParamStr("trsdk", "url"))
	if err != nil {
		config.Log.Fatalf("Invalid URL: %s", config.ParamStr("trsdk", "url"))
	}
	return &TransferClient{
		config:        config,
		daemonName:    filepath.Base(config.GetPath("sdk_daemon")),
		serverAddress: sdkURL.Hostname(),
		serverPort:    GetPortOrDefault(sdkURL, TRANSFERD_DEFAULT_PORT),
	}
}

// CreateConfigFile creates the configuration file of the daemon.
// See: https://developer.ibm.com/apis/catalog/aspera--aspera-transfer-sdk/Configuration%20File
//
// Parameters:
//   - confFile: path of the configuration file
func (tc *TransferClient) CreateConfigFile(confFile string) error {
	ascpLevel := tc.config.ParamStr("trsdk", "ascp_level")
	var ascpIntLevel int
	switch ascpLevel {
	case "info":
		ascpIntLevel = 0
	case "debug":
		ascpIntLevel = 1
	case "trace":
		ascpIntLevel = 2
	default:
		return fmt.Errorf("Invalid ascp_level: %s", ascpLevel)
	}

	configInfo := map[string]interface{}{
		"address":       tc.serverAddress,
		"port":          tc.serverPort,
		"log_directory": tc.daemonFolder,
		"log_level":     tc.config.ParamStr("trsdk", "level"),
		"fasp_runtime": map[string]interface{}{
			"use_embedded": true,
			"log": map[string]interface{}{
				"dir":   tc.daemonFolder,
				"level": ascpIntLevel,
			},
		},
	}
	if tc.runtimeDir != "" {
		configInfo["runtime_dir"] = tc.runtimeDir
	}

	configData, err := json.Marshal(configInfo)
	if err != nil {
		return err
	}

	return os.WriteFile(confFile, configData, 0644)
}

// StartDaemon starts the daemon, with its configuration, output and logs in a new folder of the log folder.
func (tc *TransferClient) StartDaemon() error {
	// samples run at the same time do not share files
	daemonFolder, err := os.MkdirTemp(tc.config.LogFolder, tc.daemonName+".")
	if err != nil {
		return err
	}
	tc.daemonFolder = daemonFolder
	fileBase := filepath.Join(daemonFolder, tc.daemonName)
	confFile := fileBase + ".conf"
	outFile := fileBase + ".out"
	errFile := fileBase + ".err"
	tc.daemonLog = fileBase + ".log"
	if tc.serverPort == 0 {
		// the daemon writes its port file in this folder: of this daemon only, readable only by the user
		tc.runtimeDir = filepath.Join(daemonFolder, "run")
		if err := os.Mkdir(tc.runtimeDir, 0700); err != nil {
			return err
		}
	}
	cmd := exec.Command(
		tc.config.GetPath("sdk_daemon"),
		"--config", confFile,
	)

	if err := tc.CreateConfigFile(confFile); err != nil {
		return err
	}

	LogDump("Daemon command", cmd.String())
	LogDump("Daemon out", outFile)
	LogDump("Daemon err", errFile)
	LogDump("Daemon log", tc.daemonLog)
	LogDump("Ascp log", filepath.Join(daemonFolder, ASCP_LOG_FILE))
	tc.config.Log.Info("Starting daemon")

	// Redirect daemon output to files
	stdout := tc.openFile(outFile)
	stderr := tc.openFile(errFile)
	cmd.Stdout = stdout
	cmd.Stderr = stderr

	err = cmd.Start()
	// the child process has its own copy of the file descriptors
	stdout.Close()
	stderr.Close()
	if err != nil {
		return fmt.Errorf("Failed to start daemon: %w", err)
	}

	tc.transferDaemonProc = cmd
	tc.daemonExited = make(chan error, 1)
	go func() { tc.daemonExited <- cmd.Wait() }()

	return tc.waitDaemonListening()
}

// waitDaemonListening waits for the daemon to listen, and gets the port if dynamically allocated (port 0).
// With port 0, the daemon writes its port in a file of its `runtime_dir` once it listens.
// This requires transferd 1.1.7 or later.
func (tc *TransferClient) waitDaemonListening() error {
	deadline := time.Now().Add(STARTUP_TIMEOUT)
	for {
		if err := tc.checkDaemonRunning(); err != nil {
			return err
		}
		// fixed port: readiness is checked on connection
		if tc.serverPort != 0 {
			return nil
		}
		port, err := readPortFile(tc.runtimeDir)
		if err != nil {
			return err
		}
		if port != 0 {
			tc.serverPort = port
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("Port file not found in %s: transferd 1.1.7 or later is required", tc.runtimeDir)
		}
		time.Sleep(200 * time.Millisecond)
	}
}

// checkDaemonRunning checks that the daemon is running.
//
// Returns: an error if the daemon has exited
func (tc *TransferClient) checkDaemonRunning() error {
	select {
	case <-tc.daemonExited:
		exitCode := tc.transferDaemonProc.ProcessState.ExitCode()
		tc.transferDaemonProc = nil
		return fmt.Errorf("Daemon exited with code %d, see log: %s", exitCode, tc.daemonLog)
	default:
		return nil
	}
}

// readPortFile reads the port of the daemon in its port file `transferd.<port>.optport`, in its `runtime_dir`.
// The daemon creates the file, then writes the port: an empty file is not ready yet.
//
// Parameters:
//   - runtimeDir: `runtime_dir` of the daemon
//
// Returns: port, or 0 if not written (yet)
func readPortFile(runtimeDir string) (int, error) {
	entries, err := os.ReadDir(runtimeDir)
	if err != nil {
		return 0, err
	}
	var portFiles []string
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), PORT_FILE_EXTENSION) {
			portFiles = append(portFiles, filepath.Join(runtimeDir, entry.Name()))
		}
	}
	if len(portFiles) == 0 {
		return 0, nil
	}
	if len(portFiles) > 1 {
		return 0, fmt.Errorf("Several port files in %s", runtimeDir)
	}
	content, err := os.ReadFile(portFiles[0])
	if err != nil {
		return 0, err
	}
	if len(content) == 0 {
		return 0, nil
	}
	if !regexp.MustCompile(`^[0-9]+$`).Match(content) {
		return 0, fmt.Errorf("No port in file %s", portFiles[0])
	}
	return strconv.Atoi(string(content))
}

// ConnectToDaemon connects to the daemon.
func (tc *TransferClient) ConnectToDaemon() error {
	address := fmt.Sprintf("%s:%d", tc.serverAddress, tc.serverPort)
	channel, err := grpc.NewClient(address, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return fmt.Errorf("Failed to connect to daemon: %s", address)
	}

	transferService := pb.NewTransferServiceClient(channel)
	// the channel connects on first call: check that the daemon answers (wait until it listens)
	ctx, cancel := context.WithTimeout(context.Background(), CONNECT_TIMEOUT)
	defer cancel()
	if _, err := transferService.GetInfo(ctx, &pb.InstanceInfoRequest{}, grpc.WaitForReady(true)); err != nil {
		channel.Close()
		if exitErr := tc.checkDaemonRunning(); exitErr != nil {
			return exitErr
		}
		return fmt.Errorf("Failed to connect to daemon: %s", address)
	}

	tc.channel = channel
	tc.transferService = transferService
	tc.config.Log.Infof("Connected to daemon: %s", address)
	return nil
}

// Startup starts the daemon and connects to it, if not already done.
func (tc *TransferClient) Startup() error {
	if tc.transferService == nil {
		if err := tc.StartDaemon(); err != nil {
			return err
		}
		if err := tc.ConnectToDaemon(); err != nil {
			return err
		}
	}
	return nil
}

// Shutdown stops the daemon, if it was started: sends SIGINT, and kills it if it does not stop in time.
// Then deletes its `runtime_dir`: a killed daemon does not delete its port file.
// transferd stops cleanly on SIGINT (not on SIGTERM).
// Windows has no SIGINT for child processes: the process is terminated.
func (tc *TransferClient) Shutdown() error {
	tc.transferService = nil
	if tc.channel != nil {
		tc.channel.Close()
		tc.channel = nil
	}
	// once the daemon is stopped
	defer func() {
		if tc.runtimeDir != "" {
			os.RemoveAll(tc.runtimeDir)
			tc.runtimeDir = ""
		}
	}()
	if tc.transferDaemonProc == nil {
		return nil
	}
	tc.config.Log.Info("Stopping daemon")
	// transferd stops cleanly on SIGINT (not on SIGTERM); not supported on Windows: kill
	if err := tc.transferDaemonProc.Process.Signal(os.Interrupt); err != nil && !errors.Is(err, os.ErrProcessDone) {
		tc.transferDaemonProc.Process.Kill()
	}
	select {
	case <-tc.daemonExited:
	case <-time.After(SHUTDOWN_TIMEOUT):
		tc.config.Log.Warn("Daemon did not stop, killing it")
		if err := tc.transferDaemonProc.Process.Kill(); err != nil && !errors.Is(err, os.ErrProcessDone) {
			return err
		}
		<-tc.daemonExited
	}
	tc.transferDaemonProc = nil
	return nil
}

// StartTransferAndWait starts the daemon if needed, starts a transfer, and waits for its end.
//
// Parameters:
//   - transferSpec: transfer spec
func (tc *TransferClient) StartTransferAndWait(transferSpec map[string]interface{}) error {
	if err := tc.Startup(); err != nil {
		return err
	}

	tsJSON, err := json.Marshal(transferSpec)
	if err != nil {
		return fmt.Errorf("Failed to marshal transfer spec: %w", err)
	}

	LogDump("Transfer spec", string(tsJSON))

	req := &pb.TransferRequest{
		TransferType: pb.TransferType_FILE_REGULAR,
		Config:       &pb.TransferConfig{},
		TransferSpec: string(tsJSON),
	}

	// on return, stop monitoring, if the stream is still open
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// start the transfer: the daemon sends an event on each change, until the end of the transfer
	events, err := tc.transferService.StartTransferWithMonitor(ctx, req)
	if err != nil {
		return fmt.Errorf("Failed to start transfer: %w", err)
	}

	for {
		event, err := events.Recv()
		if err == io.EOF {
			return errors.New("Transfer monitoring ended before transfer completion")
		}
		if err != nil {
			return fmt.Errorf("Transfer monitoring failed: %w", err)
		}

		tc.logStatus(event.Status, event.GetTransferInfo().GetAverageRateKbps())

		// `error` is empty on session errors: the cause is in session or transfer information
		description := errorDescription(event.GetError().GetDescription(), event.GetSessionInfo().GetErrorDesc(), event.GetTransferInfo().GetErrorDescription())
		if err := tc.throwOnError(event.Status, description); err != nil {
			return err
		}

		if event.Status == pb.TransferStatus_COMPLETED {
			return nil
		}
	}
}

// throwOnError returns an error if the transfer status is failed, canceled or unknown.
//
// Parameters:
//   - status: transfer status
//   - description: error description
func (tc *TransferClient) throwOnError(status pb.TransferStatus, description string) error {
	switch status {
	case pb.TransferStatus_FAILED, pb.TransferStatus_CANCELED:
		return fmt.Errorf("Transfer failed: %s", description)
	case pb.TransferStatus_UNKNOWN_STATUS:
		return fmt.Errorf("Transfer status unknown: %s", description)
	default:
		return nil
	}
}

// logStatus logs the transfer status, and the rate when running.
//
// Parameters:
//   - status: transfer status
//   - averageRateKbps: average rate in kilobits per second
func (tc *TransferClient) logStatus(status pb.TransferStatus, averageRateKbps int64) {
	if status == pb.TransferStatus_RUNNING {
		tc.config.Log.Infof("Transfer: %s %.1f Mbps", status, float64(averageRateKbps)/1000)
	} else {
		tc.config.Log.Infof("Transfer: %s", status)
	}
}

// errorDescription gets the first non-empty error description.
//
// Parameters:
//   - texts: error descriptions
//
// Returns: error description, or `unknown error`
func errorDescription(texts ...string) string {
	for _, text := range texts {
		if text = strings.TrimSpace(text); text != "" {
			return text
		}
	}
	return "unknown error"
}

// openFile creates a file for the output of the daemon.
//
// Parameters:
//   - filename: path of the file
//
// Returns: opened file
func (tc *TransferClient) openFile(filename string) *os.File {
	file, err := os.OpenFile(filename, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		tc.config.Log.Fatalf("Failed to open file: %s: %s", filename, err)
	}
	return file
}
