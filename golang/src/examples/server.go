package main

import (
	"aspera_examples/src/utils"
	"log"
	"net/url"
)

func main() {
	// Load configuration
	config, err := utils.NewConfiguration()
	if err != nil {
		config.Log.Fatalf("Error loading configuration: %v", err)
	}
	// Create transfer client
	transferClient := utils.NewTransferClient(config)
	// Get server URL
	serverURL := config.ParamStr("server", "url")
	config.Log.Debugf("Server URL: %s", serverURL)
	// Parse the server URL
	serverURI, err := url.Parse(serverURL)
	if err != nil {
		config.Log.Fatalf("Error parsing server URL: %v", err)
	}
	if serverURI.Scheme != "ssh" {
		config.Log.Fatalf("Expected SSH scheme, got: %s", serverURI.Scheme)
	}
	// Create transfer spec (JSON-like structure)
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
	// Add files to transfer spec (for simplicity, assuming no files to add in this example)
	err = config.AddFilesToTS("assets.paths", transferSpec)
	if err != nil {
		config.Log.Fatalf("Error adding files to transfer spec: %v", err)
	}
	// Start the transfer and wait
	err = transferClient.StartTransferAndWait(transferSpec)
	if err != nil {
		config.Log.Fatalf("Error during transfer: %v", err)
	}
	log.Println("Transfer completed successfully")
}
