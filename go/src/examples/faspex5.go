package main

import (
	"aspera_examples/src/utils"
	"fmt"
)

const (
	F5APIPathV5      = "/api/v5"
	F5APIPathToken   = "/auth/token"
	packageName      = "sample package"
	transferSessions = 1
)

func main() {
	config, err := utils.NewConfiguration()
	if err != nil {
		config.Log.Fatalf("Error loading configuration: %v", err)
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
	f5API.SetDefaultScope("")
	// Create a new package with Faspex 5 API
	config.Log.Debugf("Creating package: %s", packageName)
	packageResp, err := f5API.Create("packages", map[string]interface{}{
		"title":      packageName,
		"recipients": []map[string]string{{"name": config.ParamStr("faspex5", "username")}},
	})
	if err != nil {
		config.Log.Fatalf("Failed to create package: %v", err)
	}
	config.Log.Debugf("Package info: %+v", packageResp)

	// Build payload to specify files to send
	filesToSend := map[string]interface{}{"paths": []map[string]string{}}
	config.AddSources(filesToSend, "paths")

	config.Log.Debugf("Getting transfer spec")
	tSpec, err := f5API.Create(fmt.Sprintf("packages/%v/transfer_spec/upload?transfer_type=connect", packageResp["id"]), filesToSend)
	if err != nil {
		config.Log.Fatalf("Failed to get transfer spec: %v", err)
	}

	// Optional: multi-session
	if transferSessions != 1 {
		tSpec["multi_session"] = transferSessions
		tSpec["multi_session_threshold"] = 500000
	}

	// Add file list in transfer spec
	tSpec["paths"] = []map[string]string{}
	config.AddSources(tSpec, "paths")

	// Remove authentication (not used in transfer sdk)
	delete(tSpec, "authentication")

	// Finally send files to package folder on server
	transferClient.StartTransferAndWait(tSpec)
}
