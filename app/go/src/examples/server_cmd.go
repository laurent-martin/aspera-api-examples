// cspell:ignore ascmd zstr ctype codeset fcount errno errstr zmode zuid zgid zctime zmtime zatime dcount tlvs
package main

import (
	"aspera_examples/src/utils"
	"errors"
	"fmt"
	"log"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"

	"go.uber.org/zap"
	"golang.org/x/crypto/ssh"
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

func testRemote(config *utils.Configuration) error {
	log.Println("== TEST REMOTE =============")
	serverURL := config.ParamStr("server", "url")
	parsedURL, err := url.Parse(serverURL)
	if err != nil {
		return fmt.Errorf("invalid server URL: %w", err)
	}
	log.Printf("Server URL: %s", serverURL)
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
	protocol := 2
	// Initialize SSH connection
	address := net.JoinHostPort(host, port)
	conn, err := net.Dial("tcp", address)
	if err != nil {
		return fmt.Errorf("failed to connect to server: %w", err)
	}
	sshConfig := &ssh.ClientConfig{
		User: username,
		Auth: []ssh.AuthMethod{
			ssh.Password(password),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	}
	clientConn, chans, reqs, err := ssh.NewClientConn(conn, host, sshConfig)
	if err != nil {
		return fmt.Errorf("SSH handshake failed: %w", err)
	}
	client := ssh.NewClient(clientConn, chans, reqs)
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create SSH session: %w", err)
	}
	defer session.Close()

	ascmdCommand := "ascmd"
	var command string
	if protocol == 1 {
		command = ascmdCommand
	} else {
		command = fmt.Sprintf("%s -V%d", ascmdCommand, protocol)
	}

	// Set up streams
	stdinPipe, err := session.StdinPipe()
	if err != nil {
		return fmt.Errorf("unable to set up stdin pipe: %w", err)
	}

	stdoutPipe, err := session.StdoutPipe()
	if err != nil {
		return fmt.Errorf("unable to set up stdout pipe: %w", err)
	}
	if err := session.Start(command); err != nil {
		return fmt.Errorf("failed to start command: %w", err)
	}

	// Initialize AsCmd agent
	ascmdAgent, err := utils.NewAsCmd(stdinPipe, stdoutPipe, host, uint32(protocol))
	if err != nil {
		return fmt.Errorf("failed to initialize AsCmd agent: %w", err)
	}

	// Perform tests
	fileDownloadPath := config.ParamStr("server", "file_download")
	folderUploadPath := config.ParamStr("server", "folder_upload")
	if err := performTests(
		ascmdAgent,
		filepath.FromSlash(fileDownloadPath),
		filepath.FromSlash(folderUploadPath),
	); err != nil {
		return fmt.Errorf("tests failed: %w", err)
	}

	// Wait for session to close
	if err := session.Wait(); err != nil {
		return fmt.Errorf("command exited with error: %w", err)
	}
	log.Println("Command exited successfully")
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
	err = testRemote(config)
	if err != nil {
		log.Fatal(err)
	}
}
