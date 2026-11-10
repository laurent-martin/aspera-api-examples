// Upload files to an HSTS with SSH credentials, with the Transfer Daemon API only (gRPC).
// Read this sample first: the other samples use the helper class TransferClient, which does the same steps.
// The class Configuration only reads the parameters of the test environment: replace config.ParamStr(...) with your values.
package main

import (
	"aspera_examples/src/utils"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	// stub code generated from transferd.proto
	pb "aspera_examples/build/grpc_aspera"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// DaemonAddress is the address of the gRPC API, set in the default configuration file of the SDK: etc/transferd.json
const DaemonAddress = "127.0.0.1:55002"

// main runs the sample, and exits on error.
func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

// run runs the sample.
// Errors are returned to main, so that deferred calls are executed before exit.
func run() error {
	config, err := utils.NewConfiguration()
	if err != nil {
		return err
	}

	// 1. Start the Transfer Daemon. Without option, transferd reads etc/transferd.json of the SDK.
	//    In production, the daemon can also run as a service, started separately.
	daemonOut := filepath.Join(os.TempDir(), "transferd_minimal.out")
	out, err := os.Create(daemonOut)
	if err != nil {
		return err
	}
	defer out.Close()
	config.Log.Info("Starting daemon")
	daemon := exec.Command(config.GetPath("sdk_daemon"))
	daemon.Stdout = out
	daemon.Stderr = out
	if err := daemon.Start(); err != nil {
		return err
	}
	defer func() {
		// 6. Stop the daemon: transferd stops cleanly on SIGINT (Windows: killed)
		config.Log.Info("Stopping daemon")
		if daemon.Process.Signal(os.Interrupt) != nil {
			daemon.Process.Kill()
		}
		daemon.Wait()
	}()

	// 2. Connect to the gRPC API of the daemon
	channel, err := grpc.NewClient(DaemonAddress, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return err
	}
	defer channel.Close()
	client := pb.NewTransferServiceClient(channel)
	// a first call waits until the daemon listens
	connectCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := client.GetInfo(connectCtx, &pb.InstanceInfoRequest{}, grpc.WaitForReady(true)); err != nil {
		return fmt.Errorf("Failed to connect to daemon: %s, see: %s", DaemonAddress, daemonOut)
	}
	config.Log.Infof("Connected to daemon: %s", DaemonAddress)

	// 3. Build the transfer spec: upload (send) with SSH credentials
	serverURL, err := url.Parse(config.ParamStr("server", "url"))
	if err != nil {
		return err
	}
	sshPort, _ := strconv.Atoi(serverURL.Port())
	// files to transfer: arguments of the command line
	paths := []map[string]string{}
	for _, file := range os.Args[1:] {
		paths = append(paths, map[string]string{"source": file})
	}
	transferSpec, err := json.Marshal(map[string]any{
		"direction":        "send",
		"remote_host":      serverURL.Hostname(),
		"ssh_port":         sshPort,
		"remote_user":      config.ParamStr("server", "username"),
		"remote_password":  config.ParamStr("server", "password"),
		"destination_root": config.ParamStr("server", "folder_upload"),
		"paths":            paths,
	})
	if err != nil {
		return err
	}

	// 4. Start the transfer: the daemon returns a transfer id
	config.Log.Info("Uploading files")
	response, err := client.StartTransfer(context.Background(), &pb.TransferRequest{
		TransferType: pb.TransferType_FILE_REGULAR,
		Config:       &pb.TransferConfig{},
		TransferSpec: string(transferSpec),
	})
	if err != nil {
		return err
	}
	if response.Status == pb.TransferStatus_FAILED {
		return fmt.Errorf("Transfer failed: %s", response.GetError().GetDescription())
	}

	// 5. Follow the transfer: the daemon sends an event on each change, until the end
	events, err := client.MonitorTransfers(context.Background(), &pb.RegistrationRequest{
		Filters: []*pb.RegistrationFilter{{TransferId: []string{response.TransferId}}},
	})
	if err != nil {
		return err
	}
	for {
		event, err := events.Recv()
		if err != nil {
			return err
		}
		config.Log.Infof("Transfer: %s %d bytes", event.Status, event.GetTransferInfo().GetBytesTransferred())
		switch event.Status {
		case pb.TransferStatus_FAILED, pb.TransferStatus_CANCELED:
			// the cause is in error, or else in transferInfo
			description := event.GetError().GetDescription()
			if description == "" {
				description = event.GetTransferInfo().GetErrorDescription()
			}
			return fmt.Errorf("Transfer failed: %s", strings.TrimSpace(description))
		case pb.TransferStatus_COMPLETED:
			return nil
		}
	}
}
