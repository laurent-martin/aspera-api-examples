// Simplified access to Aspera Transfer Daemon client
package utils

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	pb "aspera_examples/build/grpc_aspera"

	"go.uber.org/zap"
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
	SHUTDOWN_TIMEOUT = 5 * time.Second
)

// API port in daemon log (text or JSON log format), e.g. `API Server: Listening on 127.0.0.1:55002 ...`
var listeningPortRegex = regexp.MustCompile(`API Server: Listening on [^\s"]+:(\d+)`)

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

func NewTransferClient(config *Configuration) *TransferClient {
	sdkURL, err := url.Parse(config.ParamStr("trsdk", "url"))
	if err != nil {
		config.Log.Fatalf("Error parsing server URL: %v", err)
	}
	return &TransferClient{
		config:        config,
		daemonName:    filepath.Base(config.GetPath("sdk_daemon")),
		daemonLog:     filepath.Join(config.LogFolder, filepath.Base(config.GetPath("sdk_daemon"))+".log"),
		serverAddress: sdkURL.Hostname(),
		serverPort:    GetPortOrDefault(sdkURL, TRANSFERD_DEFAULT_PORT),
	}
}

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
		return fmt.Errorf("invalid ascp_level: %s", ascpLevel)
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

	tc.config.Log.Debugf("config: %s", string(configData))
	return os.WriteFile(confFile, configData, 0644)
}

func (tc *TransferClient) StartDaemon() error {
	confFile := filepath.Join(tc.config.LogFolder, tc.daemonName+".conf")
	outFile := filepath.Join(tc.config.LogFolder, tc.daemonName+".out")
	errFile := filepath.Join(tc.config.LogFolder, tc.daemonName+".err")
	cmd := exec.Command(
		tc.config.GetPath("sdk_daemon"),
		"--config", confFile,
	)

	if err := tc.CreateConfigFile(confFile); err != nil {
		return fmt.Errorf("failed to create daemon configuration file: %w", err)
	}

	tc.config.Log.Info("Starting daemon...", zap.String("command", cmd.String()))

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
		return fmt.Errorf("failed to start daemon: %w", err)
	}

	tc.transferDaemonProc = cmd
	tc.daemonExited = make(chan error, 1)
	go func() { tc.daemonExited <- cmd.Wait() }()

	return tc.waitDaemonListening(logOffset)
}

// Wait for the daemon to listen, and get the port if dynamically allocated (port 0).
// The port is read from the daemon log: requires log level `info` or more verbose.
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
			tc.config.Log.Infof("Allocated server port : %d", tc.serverPort)
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("listening port not found in daemon log after %v: %s", STARTUP_TIMEOUT, tc.daemonLog)
		}
		time.Sleep(200 * time.Millisecond)
	}
}

// Return an error if the daemon process has exited
func (tc *TransferClient) checkDaemonRunning() error {
	select {
	case err := <-tc.daemonExited:
		tc.transferDaemonProc = nil
		tc.config.Log.Errorf("Check daemon log: %s", tc.daemonLog)
		return fmt.Errorf("daemon exited: %v", err)
	default:
		return nil
	}
}

// Find the API listening port in the daemon log, after the given offset.
// Returns 0 if not found (yet).
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

// Size of file, or 0 if it does not exist
func fileSize(path string) int64 {
	if info, err := os.Stat(path); err == nil {
		return info.Size()
	}
	return 0
}

func (tc *TransferClient) ConnectToDaemon() error {
	address := fmt.Sprintf("%s:%d", tc.serverAddress, tc.serverPort)
	tc.config.Log.Info("Connecting to transfer daemon...", zap.String("address", address))

	channel, err := grpc.NewClient(address, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return fmt.Errorf("failed to connect: %w", err)
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
		return fmt.Errorf("failed to connect: %w", err)
	}

	tc.channel = channel
	tc.transferService = transferService
	tc.config.Log.Info("Connected!")
	return nil
}

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

func (tc *TransferClient) Shutdown() error {
	tc.transferService = nil
	if tc.channel != nil {
		tc.channel.Close()
		tc.channel = nil
	}
	if tc.transferDaemonProc == nil {
		return nil
	}
	tc.config.Log.Info("Shutting down daemon...")
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

func (tc *TransferClient) StartTransfer(transferSpec map[string]interface{}) (string, error) {
	tsJSON, err := json.Marshal(transferSpec)
	if err != nil {
		return "", fmt.Errorf("failed to marshal transfer spec: %w", err)
	}

	tc.config.Log.Debugf("Transfer spec: %s", string(tsJSON))

	req := &pb.TransferRequest{
		TransferType: pb.TransferType_FILE_REGULAR,
		Config:       &pb.TransferConfig{},
		TransferSpec: string(tsJSON),
	}

	resp, err := tc.transferService.StartTransfer(context.TODO(), req)
	if err != nil {
		return "", fmt.Errorf("failed to start transfer: %w", err)
	}

	if err := tc.throwOnError(resp.Status, errorDescription(resp.GetError().GetDescription())); err != nil {
		return "", err
	}

	return resp.TransferId, nil
}

func (tc *TransferClient) WaitTransfer(transferID string) error {
	req := &pb.RegistrationRequest{
		Filters: []*pb.RegistrationFilter{
			{TransferId: []string{transferID}},
		},
	}

	stream, err := tc.transferService.MonitorTransfers(context.Background(), req)
	if err != nil {
		return fmt.Errorf("failed to monitor transfer: %w", err)
	}

	for {
		info, err := stream.Recv()
		if err != nil {
			return fmt.Errorf("failed to receive transfer info: %w", err)
		}

		tc.config.Log.Info("Transfer status", zap.String("status", pb.TransferStatus_name[int32(info.Status)]))

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

func (tc *TransferClient) throwOnError(status pb.TransferStatus, description string) error {
	switch status {
	case pb.TransferStatus_FAILED:
		tc.config.Log.Errorf("Transfer failed: %s", description)
		return fmt.Errorf("transfer failed: %s", description)
	case pb.TransferStatus_UNKNOWN_STATUS:
		return fmt.Errorf("unknown transfer status: %s", description)
	default:
		return nil
	}
}

// First non-empty error description
func errorDescription(texts ...string) string {
	for _, text := range texts {
		if text = strings.TrimSpace(text); text != "" {
			return text
		}
	}
	return "unknown error"
}

// Open a log file for the daemon output
func (tc *TransferClient) openFile(filename string) *os.File {
	file, err := os.OpenFile(filename, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		tc.config.Log.Fatalf("Failed to open log file: %s: %s", filename, err)
	}
	return file
}
