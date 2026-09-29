package main

import (
	"aspera_examples/src/utils"
	"fmt"
	"log"
	"net/url"
)

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
	transferClient := utils.NewTransferClient(config)
	defer transferClient.Shutdown()

	serverURL := config.ParamStr("server", "url")
	serverURI, err := url.Parse(serverURL)
	if err != nil || serverURI.Scheme != "ssh" {
		return fmt.Errorf("Expecting SSH URL: %s", serverURL)
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
		return err
	}
	// Start the transfer and wait
	config.Log.Info("Uploading files")
	return transferClient.StartTransferAndWait(transferSpec)
}
