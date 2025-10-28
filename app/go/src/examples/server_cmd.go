// cspell:ignore ascmd zstr ctype codeset fcount errno errstr zmode zuid zgid zctime zmtime zatime dcount tlvs
package main

import (
	"aspera_examples/src/utils"
	"errors"
	"fmt"
	"log"
	"net/url"
	"path/filepath"

	"go.uber.org/zap"
)

var logger *zap.SugaredLogger

// Take local or remote `AsCmd` object to perform ascmd actions on remote HSTS
func performTests(ascmdAgent *utils.AsCmd, existingFile, writableFolder string) error {
	copyFile := filepath.Join(writableFolder, "copied_file")
	deleteFile := filepath.Join(writableFolder, "todelete_file")
	deleteDir := filepath.Join(writableFolder, "todelete_dir")
	if res, err := ascmdAgent.Info(); err != nil {
		logger.Errorf("info: %v", err)
	} else {
		logger.Infof("info: %v", res)
	}
	if res, err := ascmdAgent.Df(); err != nil {
		return err
	} else {
		logger.Infof("df: %v", res)
	}
	if res, err := ascmdAgent.Ls(existingFile); err != nil {
		return err
	} else {
		logger.Infof("ls file: %v", res)
	}
	if res, err := ascmdAgent.Ls(writableFolder); err != nil {
		return err
	} else {
		logger.Infof("ls dir: %v", res)
	}
	if res, err := ascmdAgent.Md5sum(existingFile); err != nil {
		return err
	} else {
		logger.Infof("md5sum: %v", res)
	}
	if res, err := ascmdAgent.Du(existingFile); err != nil {
		return err
	} else {
		logger.Infof("du: %v", res)
	}
	if err := ascmdAgent.Cp(existingFile, copyFile); err != nil {
		return err
	} else {
		logger.Infof("cp: %s", "ok")
	}
	if err := ascmdAgent.Mv(copyFile, deleteFile); err != nil {
		return err
	} else {
		logger.Infof("mv: %s", "ok")
	}
	if err := ascmdAgent.Rm(deleteFile); err != nil {
		return err
	} else {
		logger.Infof("rm file: %s", "ok")
	}
	if err := ascmdAgent.Mkdir(deleteDir); err != nil {
		return err
	} else {
		logger.Infof("mkdir: %s", "ok")
	}
	if err := ascmdAgent.Rm(deleteDir); err != nil {
		return err
	} else {
		logger.Infof("rmdir: %s", "ok")
	}
	// send "exit"
	return ascmdAgent.Terminate()
}

// real stuff : execute remote ascmd
func testRemote(config *utils.Configuration) error {
	logger.Infof("== TEST REMOTE =============")
	serverURL := config.ParamStr("server", "url")
	parsedURL, err := url.Parse(serverURL)
	if err != nil {
		return fmt.Errorf("invalid server URL: %w", err)
	}
	logger.Infof("Server URL: %s", serverURL)
	if parsedURL.Scheme != "ssh" {
		return errors.New("invalid URL scheme, expected 'ssh'")
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
		return fmt.Errorf("tests failed: %w", err)
	}
	return ascmdAgent.Terminate()
}

// execute a local ascmd
func testLocal(config *utils.Configuration) error {
	logger.Infof("== TEST LOCAL =============")
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

func all_tests() error {
	config, err := utils.NewConfiguration()
	if err != nil {
		return err
	}
	logger = config.Log
	utils.SetLogger(config.Log)
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

func main() {
	err := all_tests()
	if err != nil {
		log.Fatal(err)
	}
}
