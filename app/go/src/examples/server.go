package main

import (
	"aspera_examples/src/utils"
	"fmt"
	"log"
	"net/url"
)

// errors are returned to main so that deferred calls are executed before exit
func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	config, err := utils.NewConfiguration()
	if err != nil {
		return fmt.Errorf("error loading configuration: %w", err)
	}
	transferClient := utils.NewTransferClient(config)
	defer transferClient.Shutdown()

	serverURL := config.ParamStr("server", "url")
	config.Log.Debugf("Server URL: %s", serverURL)
	serverURI, err := url.Parse(serverURL)
	if err != nil {
		return fmt.Errorf("error parsing server URL: %w", err)
	}
	if serverURI.Scheme != "ssh" {
		return fmt.Errorf("expected SSH scheme, got: %s", serverURI.Scheme)
	}
	transferSpec := map[string]interface{}{
		"title":       "test with transfer spec V2",
		"remote_host": serverURI.Hostname(),
		"session_initiation": map[string]interface{}{
			"ssh": map[string]interface{}{
				"ssh_port":        utils.GetPortOrDefault(serverURI, 33001),
				"remote_user":     config.ParamStr("server", "username"),
				"remote_password": config.ParamStr("server", "password"),
			},
		},
		"direction": "send",
		"assets": map[string]interface{}{
			"destination_root": config.ParamStr("server", "folder_upload"),
			"paths":            []map[string]string{}, // To be filled later
		},
	}
	if err := config.AddSources(transferSpec, "assets.paths"); err != nil {
		return fmt.Errorf("error adding files to transfer spec: %w", err)
	}
	// Start the transfer and wait
	if err := transferClient.StartTransferAndWait(transferSpec); err != nil {
		return fmt.Errorf("error during transfer: %w", err)
	}
	config.Log.Info("Transfer completed successfully")
	return nil
}
