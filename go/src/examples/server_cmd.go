// cspell:ignore ascmd zstr ctype codeset fcount errno errstr zmode zuid zgid zctime zmtime zatime dcount tlvs
package main

import (
	"aspera_examples/src/utils"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"

	"go.uber.org/zap"
)

var logger *zap.SugaredLogger

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
	return ascmdAgent.Terminate()
}

func testLocal() error {
	logger.Infof("== TEST LOCAL =============")
	protocol := 1
	cmd := exec.Command("ascmd")
	cmd.Env = append(os.Environ(), "SSH_CLIENT=")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("failed to open stdin: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to open stdout: %w", err)
	}
	if protocol != 1 {
		cmd.Args = append(cmd.Args, fmt.Sprintf("-V%d", protocol))
	}
	err = cmd.Start()
	if err != nil {
		return fmt.Errorf("failed to start ascmd: %w", err)
	}
	ascmdAgent, err := utils.NewAsCmd(stdin, stdout, "", uint32(protocol))
	if err != nil {
		return fmt.Errorf("failed to create ascmd agent: %w", err)
	}
	err = performTests(ascmdAgent, "/workspace/aspera/rust_ascmd/README.md", "/workspace/aspera/rust_ascmd")
	if err != nil {
		return err
	}
	err = cmd.Wait()
	if err != nil {
		return fmt.Errorf("ascmd exited with error: %w", err)
	}
	logger.Infof("ascmd exited successfully")
	return nil
}

func main() {
	config, err := utils.NewConfiguration()
	if err != nil {
		log.Fatal(err)
	}
	logger = config.Log
	utils.SetLogger(config.Log)
	defer logger.Sync()
	err = testLocal()
	if err != nil {
		log.Fatal(err)
	}
}
