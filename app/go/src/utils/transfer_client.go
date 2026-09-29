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
	// max wait time for the daemon to log its listening port
	STARTUP_TIMEOUT = 10 * time.Second
	// max wait time for the daemon to stop gracefully
	SHUTDOWN_TIMEOUT = 10 * time.Second
)

// API port in daemon log (text or JSON log format), e.g. `API Server: Listening on 127.0.0.1:55002 ...`
var listeningPortRegex = regexp.MustCompile(`API Server: Listening on [^\s"]+:(\d+)`)

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
	daemonLog       string
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
		daemonLog:     filepath.Join(config.LogFolder, filepath.Base(config.GetPath("sdk_daemon"))+".log"),
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
		"log_directory": tc.config.LogFolder,
		"log_level":     tc.config.ParamStr("trsdk", "level"),
		"fasp_runtime": map[string]interface{}{
			"use_embedded": true,
			"log": map[string]interface{}{
				"dir":   tc.config.LogFolder,
				"level": ascpIntLevel,
			},
		},
	}

	configData, err := json.Marshal(configInfo)
	if err != nil {
		return err
	}

	return os.WriteFile(confFile, configData, 0644)
}

// StartDaemon starts the daemon, with output and logs in the log folder.
func (tc *TransferClient) StartDaemon() error {
	confFile := filepath.Join(tc.config.LogFolder, tc.daemonName+".conf")
	outFile := filepath.Join(tc.config.LogFolder, tc.daemonName+".out")
	errFile := filepath.Join(tc.config.LogFolder, tc.daemonName+".err")
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
	LogDump("Ascp log", filepath.Join(tc.config.LogFolder, ASCP_LOG_FILE))
	tc.config.Log.Info("Starting daemon")

	// the log file may contain lines of previous executions: only read new lines
	logOffset := fileSize(tc.daemonLog)

	// Redirect daemon output to files
	stdout := tc.openFile(outFile)
	stderr := tc.openFile(errFile)
	cmd.Stdout = stdout
	cmd.Stderr = stderr

	err := cmd.Start()
	// the child process has its own copy of the file descriptors
	stdout.Close()
	stderr.Close()
	if err != nil {
		return fmt.Errorf("Failed to start daemon: %w", err)
	}

	tc.transferDaemonProc = cmd
	tc.daemonExited = make(chan error, 1)
	go func() { tc.daemonExited <- cmd.Wait() }()

	return tc.waitDaemonListening(logOffset)
}

// waitDaemonListening waits for the daemon to listen, and gets the port if dynamically allocated (port 0).
// The port is read from the daemon log: requires log level `info` or more verbose.
//
// Parameters:
//   - logOffset: only read the daemon log after this offset
func (tc *TransferClient) waitDaemonListening(logOffset int64) error {
	deadline := time.Now().Add(STARTUP_TIMEOUT)
	for {
		if err := tc.checkDaemonRunning(); err != nil {
			return err
		}
		// fixed port: readiness is checked on connection
		if tc.serverPort != 0 {
			return nil
		}
		port, err := findListeningPort(tc.daemonLog, logOffset)
		if err != nil {
			return err
		}
		if port != 0 {
			tc.serverPort = port
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("Listening port not found in daemon log: %s", tc.daemonLog)
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

// findListeningPort finds the API listening port in the daemon log, after the given offset.
//
// Parameters:
//   - logFile: path of the daemon log
//   - offset: only read the daemon log after this offset
//
// Returns: port, or 0 if not found (yet)
func findListeningPort(logFile string, offset int64) (int, error) {
	content, err := os.ReadFile(logFile)
	if os.IsNotExist(err) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	// log file was truncated
	if int64(len(content)) < offset {
		offset = 0
	}
	match := listeningPortRegex.FindSubmatch(content[offset:])
	if match == nil {
		return 0, nil
	}
	return strconv.Atoi(string(match[1]))
}

// fileSize gets the size of a file.
//
// Parameters:
//   - path: path of the file
//
// Returns: size of the file, or 0 if it does not exist
func fileSize(path string) int64 {
	if info, err := os.Stat(path); err == nil {
		return info.Size()
	}
	return 0
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
// transferd stops cleanly on SIGINT (not on SIGTERM).
// Windows has no SIGINT for child processes: the process is terminated.
func (tc *TransferClient) Shutdown() error {
	tc.transferService = nil
	if tc.channel != nil {
		tc.channel.Close()
		tc.channel = nil
	}
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

// StartTransfer starts a transfer.
//
// Parameters:
//   - transferSpec: transfer spec
//
// Returns: transfer id
func (tc *TransferClient) StartTransfer(transferSpec map[string]interface{}) (string, error) {
	tsJSON, err := json.Marshal(transferSpec)
	if err != nil {
		return "", fmt.Errorf("Failed to marshal transfer spec: %w", err)
	}

	LogDump("Transfer spec", string(tsJSON))

	req := &pb.TransferRequest{
		TransferType: pb.TransferType_FILE_REGULAR,
		Config:       &pb.TransferConfig{},
		TransferSpec: string(tsJSON),
	}

	resp, err := tc.transferService.StartTransfer(context.TODO(), req)
	if err != nil {
		return "", fmt.Errorf("Failed to start transfer: %w", err)
	}

	if err := tc.throwOnError(resp.Status, errorDescription(resp.GetError().GetDescription())); err != nil {
		return "", err
	}

	return resp.TransferId, nil
}

// WaitTransfer waits for the end of a transfer, and logs its status.
//
// Parameters:
//   - transferID: transfer id
func (tc *TransferClient) WaitTransfer(transferID string) error {
	req := &pb.RegistrationRequest{
		Filters: []*pb.RegistrationFilter{
			{TransferId: []string{transferID}},
		},
	}

	stream, err := tc.transferService.MonitorTransfers(context.Background(), req)
	if err != nil {
		return fmt.Errorf("Failed to monitor transfer: %w", err)
	}

	for {
		info, err := stream.Recv()
		if err == io.EOF {
			return errors.New("Transfer monitoring ended before transfer completion")
		}
		if err != nil {
			return fmt.Errorf("Transfer monitoring failed: %w", err)
		}

		tc.logStatus(info.Status, info.GetTransferInfo().GetAverageRateKbps())

		// `error` is empty on session errors: the cause is in session or transfer information
		description := errorDescription(info.GetError().GetDescription(), info.GetSessionInfo().GetErrorDesc(), info.GetTransferInfo().GetErrorDescription())
		if err := tc.throwOnError(info.Status, description); err != nil {
			return err
		}

		if info.Status == pb.TransferStatus_COMPLETED {
			break
		}
	}

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

	transferID, err := tc.StartTransfer(transferSpec)
	if err != nil {
		return err
	}

	return tc.WaitTransfer(transferID)
}

// throwOnError returns an error if the transfer status is failed or unknown.
//
// Parameters:
//   - status: transfer status
//   - description: error description
func (tc *TransferClient) throwOnError(status pb.TransferStatus, description string) error {
	switch status {
	case pb.TransferStatus_FAILED:
		return fmt.Errorf("Transfer failed: %s", description)
	case pb.TransferStatus_UNKNOWN_STATUS:
		return fmt.Errorf("Unknown transfer id: %s", description)
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
