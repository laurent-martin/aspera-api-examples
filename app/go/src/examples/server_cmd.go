// cspell:ignore ascmd zstr ctype codeset fcount errno errstr zmode zuid zgid zctime zmtime zatime dcount tlvs
package main

import (
	"aspera_examples/src/utils"
	"fmt"
	"log"
	"net/url"
	"path/filepath"

	"go.uber.org/zap"
)

var logger *zap.SugaredLogger

// performTests performs file operations on the server with ascmd.
//
// Parameters:
//   - ascmdAgent: ascmd client
//   - existingFile: path of a file on the server
//   - writableFolder: path of a folder on the server, where files are created and deleted
func performTests(ascmdAgent *utils.AsCmd, existingFile, writableFolder string) error {
	copyFile := filepath.Join(writableFolder, "copied_file")
	deleteFile := filepath.Join(writableFolder, "todelete_file")
	deleteDir := filepath.Join(writableFolder, "todelete_dir")
	if res, err := ascmdAgent.Info(); err != nil {
		logger.Errorf("Failed to get server information: %s", err)
	} else {
		logger.Infof("Server information: %v", res)
	}
	if res, err := ascmdAgent.Df(); err != nil {
		return err
	} else {
		logger.Infof("Disk space: %v", res)
	}
	if res, err := ascmdAgent.Ls(existingFile); err != nil {
		return err
	} else {
		logger.Infof("File information: %v", res)
	}
	if res, err := ascmdAgent.Ls(writableFolder); err != nil {
		return err
	} else {
		logger.Infof("Folder content: %v", res)
	}
	if res, err := ascmdAgent.Md5sum(existingFile); err != nil {
		return err
	} else {
		logger.Infof("File MD5: %v", res)
	}
	if res, err := ascmdAgent.Du(existingFile); err != nil {
		return err
	} else {
		logger.Infof("Disk usage: %v", res)
	}
	if err := ascmdAgent.Cp(existingFile, copyFile); err != nil {
		return err
	} else {
		logger.Info("File copied")
	}
	if err := ascmdAgent.Mv(copyFile, deleteFile); err != nil {
		return err
	} else {
		logger.Info("File moved")
	}
	if err := ascmdAgent.Rm(deleteFile); err != nil {
		return err
	} else {
		logger.Info("File deleted")
	}
	if err := ascmdAgent.Mkdir(deleteDir); err != nil {
		return err
	} else {
		logger.Info("Folder created")
	}
	if err := ascmdAgent.Rm(deleteDir); err != nil {
		return err
	} else {
		logger.Info("Folder deleted")
	}
	// send "exit"
	return ascmdAgent.Terminate()
}

// testRemote tests ascmd executed on the server through SSH.
//
// Parameters:
//   - config: configuration of the samples
func testRemote(config *utils.Configuration) error {
	logger.Info("Testing remote ascmd")
	serverURL := config.ParamStr("server", "url")
	parsedURL, err := url.Parse(serverURL)
	if err != nil || parsedURL.Scheme != "ssh" {
		return fmt.Errorf("Expecting SSH URL: %s", serverURL)
	}
	host := parsedURL.Hostname()
	port := parsedURL.Port()
	if port == "" {
		port = "33001"
	}
	username := config.ParamStr("server", "username")
	password := config.ParamStr("server", "password")
	ascmdAgent, err := utils.NewAsCmdRemote(host, port, username, password, 2)
	if err != nil {
		return err
	}
	if err := performTests(
		ascmdAgent.AsCmd,
		filepath.FromSlash(config.ParamStr("server", "file_download")),
		filepath.FromSlash(config.ParamStr("server", "folder_upload")),
	); err != nil {
		return err
	}
	return ascmdAgent.Terminate()
}

// testLocal tests ascmd executed locally.
//
// Parameters:
//   - config: configuration of the samples
func testLocal(config *utils.Configuration) error {
	logger.Info("Testing local ascmd")
	ascmdAgent, err := utils.NewAsCmdLocal(1)
	if err != nil {
		return err
	}
	err = performTests(ascmdAgent.AsCmd, config.ParamStr("local", "file"), config.ParamStr("local", "folder"))
	if err != nil {
		return err
	}
	return ascmdAgent.Terminate()
}

// all_tests tests ascmd executed locally, and on the server.
func all_tests() error {
	config, err := utils.NewConfiguration()
	if err != nil {
		return err
	}
	logger = config.Log
	defer logger.Sync()

	err = testLocal(config)
	if err != nil {
		return err
	}
	err = testRemote(config)
	if err != nil {
		return err
	}
	return nil
}

// main runs the sample, and exits on error.
func main() {
	err := all_tests()
	if err != nil {
		log.Fatal(err)
	}
}
