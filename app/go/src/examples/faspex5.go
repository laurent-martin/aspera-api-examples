package main

import (
	"aspera_examples/src/utils"
	"fmt"
	"log"
)

const (
	F5APIPathV5      = "/api/v5"
	F5APIPathToken   = "/auth/token"
	packageName      = "Sample package"
	transferSessions = 1
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

	// Generate a bearer token for each script invocation
	f5API := utils.NewRest(fmt.Sprintf("%s%s", config.ParamStr("faspex5", "url"), F5APIPathV5))
	f5API.SetVerify(config.ParamBool("faspex5", "verify", true))
	f5API.SetBearer(map[string]string{
		"token_url":     fmt.Sprintf("%s%s", config.ParamStr("faspex5", "url"), F5APIPathToken),
		"key_pem_path":  config.ParamStr("faspex5", "private_key"),
		"client_id":     config.ParamStr("faspex5", "client_id"),
		"client_secret": config.ParamStr("faspex5", "client_secret"),
		"iss":           config.ParamStr("faspex5", "client_id"),
		"aud":           config.ParamStr("faspex5", "client_id"),
		"sub":           fmt.Sprintf("user:%s", config.ParamStr("faspex5", "username")),
	})
	if err := f5API.SetDefaultScope(""); err != nil {
		return err
	}
	// Create a new package with Faspex 5 API
	config.Log.Info("Creating package")
	packageResp, err := f5API.Create("packages", map[string]interface{}{
		"title":      packageName,
		"recipients": []map[string]string{{"name": config.ParamStr("faspex5", "username")}},
	})
	if err != nil {
		return err
	}

	// Build payload to specify files to send
	filesToSend := map[string]interface{}{}
	if err := config.AddSources(filesToSend, "paths"); err != nil {
		return err
	}

	config.Log.Info("Getting transfer spec")
	// transfer_type=connect: transfer spec for a web client, also usable by the Transfer SDK
	tSpec, err := f5API.Create(fmt.Sprintf("packages/%v/transfer_spec/upload?transfer_type=connect", packageResp["id"]), filesToSend)
	if err != nil {
		return err
	}

	// Optional: multi-session
	if transferSessions != 1 {
		tSpec["multi_session"] = transferSessions
		tSpec["multi_session_threshold"] = 500000
	}

	// Add file list in transfer spec
	if err := config.AddSources(tSpec, "paths"); err != nil {
		return err
	}

	// Remove `authentication`: not used by the Transfer SDK
	delete(tSpec, "authentication")

	// Finally send files to package folder on server
	config.Log.Info("Uploading files")
	return transferClient.StartTransferAndWait(tSpec)
}
