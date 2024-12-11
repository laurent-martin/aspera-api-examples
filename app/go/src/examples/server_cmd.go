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

type AsCmdLocal struct {
	*utils.AsCmd
	cmd *exec.Cmd
}

func NewAsCmdLocal(protocol uint32) (*AsCmdLocal, error) {
	cmd := exec.Command(utils.ASCMDCommand)
	cmd.Env = append(os.Environ(), "SSH_CLIENT=")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to open stdin: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to open stdout: %w", err)
	}
	if protocol != 1 {
		cmd.Args = append(cmd.Args, fmt.Sprintf("-V%d", protocol))
	}
	err = cmd.Start()
	if err != nil {
		return nil, fmt.Errorf("failed to start ascmd: %w", err)
	}
	ascmdAgent, err := utils.NewAsCmd(stdin, stdout, "", uint32(protocol))
	if err != nil {
		return nil, fmt.Errorf("failed to create ascmd agent: %w", err)
	}
	return &AsCmdLocal{
		AsCmd: ascmdAgent,
		cmd:   cmd,
	}, nil
}

func (self *AsCmdLocal) Terminate() error {
	err := self.cmd.Wait()
	if err != nil {
		return fmt.Errorf("ascmd exited with error: %w", err)
	}
	logger.Infof("ascmd exited successfully")
	return nil
}

// execute a local ascmd
func testLocal() error {
	logger.Infof("== TEST LOCAL =============")
	ascmdAgent, err := NewAsCmdLocal(1)
	if err != nil {
		return err
	}
	err = performTests(ascmdAgent.AsCmd, "/workspace/aspera/rust_ascmd/README.md", "/workspace/aspera/rust_ascmd")
	if err != nil {
		return err
	}
	return ascmdAgent.Terminate()
}

type AsCmdRemote struct {
	*utils.AsCmd
	client  *ssh.Client
	session *ssh.Session
}

func NewAsCmdRemote(host string, port string, username string, password string, protocol uint32) (*AsCmdRemote, error) {
	// Initialize SSH connection
	address := net.JoinHostPort(host, port)
	conn, err := net.Dial("tcp", address)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to server: %w", err)
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
		return nil, fmt.Errorf("SSH handshake failed: %w", err)
	}
	client := ssh.NewClient(clientConn, chans, reqs)

	session, err := client.NewSession()
	if err != nil {
		return nil, fmt.Errorf("failed to create SSH session: %w", err)
	}

	ascmdCommand := utils.ASCMDCommand
	var command string
	if protocol == 1 {
		command = ascmdCommand
	} else {
		command = fmt.Sprintf("%s -V%d", ascmdCommand, protocol)
	}
	stdinPipe, err := session.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("unable to set up stdin pipe: %w", err)
	}
	stdoutPipe, err := session.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("unable to set up stdout pipe: %w", err)
	}
	if err := session.Start(command); err != nil {
		return nil, fmt.Errorf("failed to start command: %w", err)
	}
	// Initialize AsCmd agent
	ascmdAgent, err := utils.NewAsCmd(stdinPipe, stdoutPipe, host, uint32(protocol))
	if err != nil {
		return nil, fmt.Errorf("failed to initialize AsCmd agent: %w", err)
	}
	return &AsCmdRemote{
		AsCmd:   ascmdAgent,
		client:  client,
		session: session,
	}, nil
}
func (self *AsCmdRemote) Terminate() error {
	// Wait for session to close
	if err := self.session.Wait(); err != nil {
		return fmt.Errorf("command exited with error: %w", err)
	}
	self.session.Close()
	self.client.Close()
	logger.Infof("Command exited successfully")
	return nil
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
	ascmdAgent, err := NewAsCmdRemote(host, port, username, password, 2)
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

func all_tests() error {
	config, err := utils.NewConfiguration()
	if err != nil {
		return err
	}
	logger = config.Log
	utils.SetLogger(config.Log)
	defer logger.Sync()

	err = testLocal()
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
