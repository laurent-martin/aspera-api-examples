// Simplified access to Aspera Transfer Daemon client
package utils

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"time"

	pb "aspera_examples/build/grpc_aspera"

	"go.uber.org/zap"
	"google.golang.org/grpc"
)

const (
	ASCP_LOG_FILE = "aspera-scp-transfer.log"
)

type TransferClient struct {
	config             *Configuration
	serverAddress      string
	serverPort         int
	transferDaemonProc *exec.Cmd
	transferService    pb.TransferServiceClient
	daemonName         string
	daemonLog          string
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
		serverPort:    GetPortOrDefault(sdkURL, 33001),
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

	tc.CreateConfigFile(confFile)

	tc.config.Log.Info("Starting daemon...", zap.String("command", cmd.String()))

	// Redirection des logs
	cmd.Stdout = tc.openFile(outFile)
	cmd.Stderr = tc.openFile(errFile)

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start daemon: %w", err)
	}

	tc.transferDaemonProc = cmd
	time.Sleep(2 * time.Second)

	if err := tc.checkDaemonStartup(); err != nil {
		return err
	}

	return nil
}

func (tc *TransferClient) checkDaemonStartup() error {
	if tc.transferDaemonProc.ProcessState != nil && tc.transferDaemonProc.ProcessState.Exited() {
		tc.config.Log.Error("Daemon not started", zap.Error(fmt.Errorf("exit status: %v", tc.transferDaemonProc.ProcessState.ExitCode())))
		return fmt.Errorf("daemon startup failed")
	}

	if tc.serverPort == 0 {
		logLine, err := LastFileLine(tc.daemonLog)
		if err != nil {
			return err
		}
		tc.config.Log.Debugf("Last log line: %s", logLine)
		re := regexp.MustCompile(`:(\d+)`)
		match := re.FindStringSubmatch(logLine)
		if match == nil {
			return fmt.Errorf("could not read listening port from log file")
		}
		port, err := strconv.Atoi(match[1])
		if err != nil {
			return fmt.Errorf("could not parse port number: %w", err)
		}

		tc.serverPort = port
		tc.config.Log.Infof("Allocated server port : %d", tc.serverPort)
	}

	return nil
}

func (tc *TransferClient) ConnectToDaemon() error {
	address := fmt.Sprintf("%s:%d", tc.serverAddress, tc.serverPort)
	tc.config.Log.Info("Connecting to transfer daemon...", zap.String("address", address))

	channel, err := grpc.NewClient(address, grpc.WithInsecure())
	if err != nil {
		return fmt.Errorf("failed to connect: %w", err)
	}

	tc.transferService = pb.NewTransferServiceClient(channel)
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
	if tc.transferDaemonProc != nil {
		tc.config.Log.Info("Shutting down daemon...")
		return tc.transferDaemonProc.Process.Kill()
	}
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

	if err := tc.throwOnError(resp.Status, resp.Error); err != nil {
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

		if err := tc.throwOnError(info.Status, info.Error); err != nil {
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

func (tc *TransferClient) throwOnError(status pb.TransferStatus, error *pb.Error) error {
	switch status {
	case pb.TransferStatus_FAILED:
		tc.config.Log.Errorf("Transfer failed: %s", error.Description)
		return fmt.Errorf("transfer failed: %s", error.Description)
	case pb.TransferStatus_UNKNOWN_STATUS:
		return fmt.Errorf("unknown transfer status: %s", error.Description)
	default:
		return nil
	}
}

// Utilitaire pour ouvrir les fichiers de log
func (tc *TransferClient) openFile(filename string) *os.File {
	file, err := os.OpenFile(filename, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		tc.config.Log.Fatalf("Failed to open log file: %s: %s", filename, err)
	}
	return file
}
