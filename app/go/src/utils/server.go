// Remote access to `ascmd` on Aspera HSTS
// decode the TLV binary protocol
// cspell:ignore ascmd zstr ctype codeset fcount errno errstr zmode zuid zgid zctime zmtime zatime dcount tlvs
package utils

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"reflect"
	"strings"
	"unicode/utf8"

	"go.uber.org/zap"
	"golang.org/x/crypto/ssh"
)

var logger *zap.SugaredLogger

func SetLogger(lg *zap.SugaredLogger) {
	logger = lg
}

const (
	// Sizes of TLV components
	TagSize       = 1
	LengthSize    = 4
	U32Size       = 4
	U64Size       = 8
	END_OF_BUFFER = uint8(0)
	// The executable command
	ASCMDCommand = "ascmd"
)

// TagValue represents a TLV (Tag-Length-Value) structure
type TagValue struct {
	Tag   uint8
	Value []byte
}

// Info holds platform information
type Info struct {
	Platform   string
	Version    string
	Lang       string
	Territory  string
	Codeset    string
	LcCtype    string
	LcNumeric  string
	LcTime     string
	LcAll      string
	Dev        []string
	BrowseCaps string
	Protocol   uint64
}

// newInfo decodes a byte array into an Info structure
func newInfo(data []byte) (*Info, error) {
	logger.Debugf("decoding info: %v", data)
	info := &Info{
		Dev: make([]string, 0),
	}
	reader := bufio.NewReader(bytes.NewReader(data))
	for {
		tlv, err := readTLV(reader)
		if err != nil {
			return nil, err
		}
		switch tlv.Tag {
		case END_OF_BUFFER:
			return info, nil
		case 1:
			if info.Platform, err = decodeZstr("platform", tlv.Value); err != nil {
				return nil, err
			}
		case 2:
			if info.Version, err = decodeZstr("version", tlv.Value); err != nil {
				return nil, err
			}
		case 3:
			if info.Lang, err = decodeZstr("lang", tlv.Value); err != nil {
				return nil, err
			}
		case 4:
			if info.Territory, err = decodeZstr("territory", tlv.Value); err != nil {
				return nil, err
			}
		case 5:
			if info.Codeset, err = decodeZstr("codeset", tlv.Value); err != nil {
				return nil, err
			}
		case 6:
			if info.LcCtype, err = decodeZstr("lc_ctype", tlv.Value); err != nil {
				return nil, err
			}
		case 7:
			if info.LcNumeric, err = decodeZstr("lc_numeric", tlv.Value); err != nil {
				return nil, err
			}
		case 8:
			if info.LcTime, err = decodeZstr("lc_time", tlv.Value); err != nil {
				return nil, err
			}
		case 9:
			if info.LcAll, err = decodeZstr("lc_all", tlv.Value); err != nil {
				return nil, err
			}
		case 10:
			dev, _ := decodeZstr("dev", tlv.Value)
			info.Dev = append(info.Dev, dev)
		case 11:
			if info.BrowseCaps, err = decodeZstr("browse_caps", tlv.Value); err != nil {
				return nil, err
			}
		case 12:
			if info.Protocol, err = decodeU64("protocol", tlv.Value); err != nil {
				return nil, err
			}
		default:
			return nil, fmt.Errorf("unknown TLV type: %d", tlv.Tag)
		}
	}
}

// Mnt holds drive information
type Mnt struct {
	Fs     string
	Dir    string
	IsA    string
	Total  uint64
	Used   uint64
	Free   uint64
	Fcount uint64
	Errno  uint32
	Errstr string
}

// Mounts holds a list of Mnt structures
type Mounts struct {
	Mounts []Mnt
}

// newMounts decodes a byte array into a Mounts structure
func newMounts(data []byte) (*Mounts, error) {
	logger.Debugf("decoding mounts: %v", data)
	mounts := &Mounts{
		Mounts: make([]Mnt, 0),
	}
	var mnt *Mnt
	reader := bufio.NewReader(bytes.NewReader(data))
	for {
		tlv, err := readTLV(reader)
		if err != nil {
			return nil, err
		}
		switch tlv.Tag {
		case END_OF_BUFFER:
			if mnt != nil {
				mounts.Mounts = append(mounts.Mounts, *mnt)
			}
			return mounts, nil
		case 1:
			if mnt != nil {
				mounts.Mounts = append(mounts.Mounts, *mnt)
			}
			mnt = &Mnt{}
			if mnt.Fs, err = decodeZstr("fs", tlv.Value); err != nil {
				return mounts, err
			}
		case 2:
			if mnt.Dir, err = decodeZstr("dir", tlv.Value); err != nil {
				return mounts, err
			}
		case 3:
			if mnt.IsA, err = decodeZstr("is_a", tlv.Value); err != nil {
				return mounts, err
			}
		case 4:
			if mnt.Total, err = decodeU64("total", tlv.Value); err != nil {
				return mounts, err
			}
		case 5:
			if mnt.Used, err = decodeU64("used", tlv.Value); err != nil {
				return mounts, err
			}
		case 6:
			if mnt.Free, err = decodeU64("free", tlv.Value); err != nil {
				return mounts, err
			}
		case 7:
			if mnt.Fcount, err = decodeU64("fcount", tlv.Value); err != nil {
				return mounts, err
			}
		case 8:
			if mnt.Errno, err = decodeU32("errno", tlv.Value); err != nil {
				return mounts, err
			}
		case 9:
			if mnt.Errstr, err = decodeZstr("errstr", tlv.Value); err != nil {
				return mounts, err
			}
		default:
			return nil, fmt.Errorf("unknown TLV type: %d", tlv.Tag)
		}
	}
}

// Stat holds the information about a file or directory
type Stat struct {
	Name    string
	Size    uint64
	Mode    uint32
	Zmode   string
	Uid     uint32
	Zuid    string
	Gid     uint32
	Zgid    string
	Ctime   uint64
	Zctime  string
	Mtime   uint64
	Zmtime  string
	Atime   uint64
	Zatime  string
	Symlink string
	Errno   uint32
	Errstr  string
}

// newStat decodes the TLV data into a Stat structure
func newStat(data []byte) (*Stat, error) {
	logger.Debugf("decoding stat: %v", data)
	stat := &Stat{
		Name:    "",
		Size:    0,
		Mode:    0,
		Zmode:   "",
		Uid:     0,
		Zuid:    "",
		Gid:     0,
		Zgid:    "",
		Ctime:   0,
		Zctime:  "",
		Mtime:   0,
		Zmtime:  "",
		Atime:   0,
		Zatime:  "",
		Symlink: "",
		Errno:   0,
		Errstr:  "",
	}
	reader := bufio.NewReader(bytes.NewReader(data))
	for {
		tlv, err := readTLV(reader)
		if err != nil {
			return nil, err
		}
		switch tlv.Tag {
		case END_OF_BUFFER:
			return stat, nil
		case 1:
			if stat.Name, err = decodeZstr("name", tlv.Value); err != nil {
				return stat, err
			}
		case 2:
			if stat.Size, err = decodeU64("size", tlv.Value); err != nil {
				return nil, err
			}
		case 3:
			if stat.Mode, err = decodeU32("mode", tlv.Value); err != nil {
				return nil, err
			}
		case 4:
			if stat.Zmode, err = decodeZstr("zmode", tlv.Value); err != nil {
				return stat, err
			}
		case 5:
			if stat.Uid, err = decodeU32("uid", tlv.Value); err != nil {
				return nil, err
			}
		case 6:
			if stat.Zuid, err = decodeZstr("zuid", tlv.Value); err != nil {
				return stat, err
			}
		case 7:
			if stat.Gid, err = decodeU32("gid", tlv.Value); err != nil {
				return nil, err
			}
		case 8:
			if stat.Zgid, err = decodeZstr("zgid", tlv.Value); err != nil {
				return stat, err
			}
		case 9:
			if stat.Ctime, err = decodeU64("ctime", tlv.Value); err != nil {
				return nil, err
			}
		case 10:
			if stat.Zctime, err = decodeZstr("zctime", tlv.Value); err != nil {
				return stat, err
			}
		case 11:
			if stat.Mtime, err = decodeU64("mtime", tlv.Value); err != nil {
				return nil, err
			}
		case 12:
			if stat.Zmtime, err = decodeZstr("zmtime", tlv.Value); err != nil {
				return stat, err
			}
		case 13:
			if stat.Atime, err = decodeU64("atime", tlv.Value); err != nil {
				return nil, err
			}
		case 14:
			if stat.Zatime, err = decodeZstr("zatime", tlv.Value); err != nil {
				return stat, err
			}
		case 15:
			if stat.Symlink, err = decodeZstr("symlink", tlv.Value); err != nil {
				return stat, err
			}
		case 16:
			if stat.Errno, err = decodeU32("errno", tlv.Value); err != nil {
				return nil, err
			}
		case 17:
			if stat.Errstr, err = decodeZstr("errstr", tlv.Value); err != nil {
				return stat, err
			}
		default:
			return nil, fmt.Errorf("unknown TLV tag: %d", tlv.Tag)
		}
	}
}

// Size holds the information about the size of a file or directory
type Size struct {
	Size         uint64
	Fcount       uint32
	Dcount       uint32
	FailedFcount uint32
	FailedDcount uint32
}

// newSize decodes the TLV data into a Size structure
func newSize(data []byte) (*Size, error) {
	logger.Debugf("decoding size: %v", data)
	size := &Size{
		Size:         0,
		Fcount:       0,
		Dcount:       0,
		FailedFcount: 0,
		FailedDcount: 0,
	}
	reader := bufio.NewReader(bytes.NewReader(data))
	for {
		tlv, err := readTLV(reader)
		if err != nil {
			return nil, err
		}
		switch tlv.Tag {
		case END_OF_BUFFER:
			return size, nil
		case 1:
			if size.Size, err = decodeU64("size", tlv.Value); err != nil {
				return nil, err
			}
		case 2:
			if size.Fcount, err = decodeU32("fcount", tlv.Value); err != nil {
				return nil, err
			}
		case 3:
			if size.Dcount, err = decodeU32("dcount", tlv.Value); err != nil {
				return nil, err
			}
		case 4:
			if size.FailedFcount, err = decodeU32("failed_fcount", tlv.Value); err != nil {
				return nil, err
			}
		case 5:
			if size.FailedDcount, err = decodeU32("failed_dcount", tlv.Value); err != nil {
				return nil, err
			}
		default:
			return nil, fmt.Errorf("unknown TLV tag: %d", tlv.Tag)
		}
	}
}

type CommandError struct {
	Errno  uint32
	Errstr string
}

// newCommandError decodes the TLV data into a CommandError structure
func newCommandError(data []byte) (*CommandError, error) {
	logger.Debugf("decoding error: %v", data)
	error := &CommandError{
		Errno:  0,
		Errstr: "",
	}
	reader := bufio.NewReader(bytes.NewReader(data))
	for {
		tlv, err := readTLV(reader)
		if err != nil {
			return nil, err
		}
		switch tlv.Tag {
		case END_OF_BUFFER:
			return error, nil
		case 1:
			if error.Errno, err = decodeU32("errno", tlv.Value); err != nil {
				return nil, err
			}
		case 2:
			if error.Errstr, err = decodeZstr("errstr", tlv.Value); err != nil {
				return nil, err
			}
		default:
			return nil, fmt.Errorf("unknown TLV tag: %d", tlv.Tag)
		}
	}
}

type Md5sum struct {
	Md5sum string
}

// newMd5sum decodes the TLV data into an Md5sum structure
func newMd5sum(data []byte) (*Md5sum, error) {
	logger.Debugf("decoding md5sum: %v", data)
	md5sum := &Md5sum{
		Md5sum: "",
	}
	reader := bufio.NewReader(bytes.NewReader(data))
	for {
		tlv, err := readTLV(reader)
		if err != nil {
			return nil, err
		}
		switch tlv.Tag {
		case END_OF_BUFFER:
			return md5sum, nil
		case 1:
			if md5sum.Md5sum, err = decodeZstr("md5sum", tlv.Value); err != nil {
				return nil, err
			}
		default:
			return nil, fmt.Errorf("unknown TLV tag: %d", tlv.Tag)
		}
	}
}

type CommandSuccess struct {
}

type CommandExit struct {
}

// CommandResult represents the top-level result of a command
type CommandResult struct {
	Result interface{}
}

func (c CommandResult) String() string {
	// Customize this to show meaningful data
	return fmt.Sprintf("%+v", c.Result)
}

// newCommandResult decodes the TagValue into a CommandResult
func newCommandResult(typeValue *TagValue) (*CommandResult, error) {
	switch typeValue.Tag {
	case END_OF_BUFFER:
		return nil, fmt.Errorf("buffer is empty")
	case 1:
		stat, err := newStat(typeValue.Value)
		if err != nil {
			return nil, err
		}
		return &CommandResult{Result: stat}, nil

	case 2:
		dir := []Stat{}
		reader := bufio.NewReader(bytes.NewReader(typeValue.Value))
		for {
			// finish if reader is empty
			_, err := reader.Peek(1)
			if err == io.EOF {
				break
			}
			tlv, err := readTLV(reader)
			if err != nil {
				return nil, err
			}
			if tlv.Tag != 1 {
				return nil, fmt.Errorf("expected tag 1, got %d", tlv.Tag)
			}
			stat, err := newStat(tlv.Value)
			if err != nil {
				return nil, err
			}
			dir = append(dir, *stat)
		}
		return &CommandResult{Result: dir}, nil

	case 3:
		size, err := newSize(typeValue.Value)
		if err != nil {
			return nil, err
		}
		return &CommandResult{Result: size}, nil

	case 4:
		cmdErr, err := newCommandError(typeValue.Value)
		if err != nil {
			return nil, err
		}
		return &CommandResult{Result: cmdErr}, nil

	case 5:
		info, err := newInfo(typeValue.Value)
		if err != nil {
			return nil, err
		}
		return &CommandResult{Result: info}, nil

	case 6:
		return &CommandResult{Result: &CommandSuccess{}}, nil // Success (empty struct)
	case 7:
		return &CommandResult{Result: &CommandExit{}}, nil // Exit (empty struct)
	case 8:
		mounts, err := newMounts(typeValue.Value)
		if err != nil {
			return nil, err
		}
		return &CommandResult{Result: mounts}, nil
	case 9:
		md5sum, err := newMd5sum(typeValue.Value)
		if err != nil {
			return nil, err
		}
		return &CommandResult{Result: md5sum}, nil
	default:
		return nil, fmt.Errorf("unknown TLV tag: %d", typeValue.Tag)
	}
}

// readTLV reads a TLV structure from a reader
func readTLV(reader *bufio.Reader) (*TagValue, error) {
	t := make([]byte, TagSize)
	if _, err := io.ReadFull(reader, t); err != nil {
		if err == io.EOF {
			return &TagValue{Tag: END_OF_BUFFER, Value: []byte{}}, nil
		}
		return nil, err
	}
	lengthBuf := make([]byte, LengthSize)
	if _, err := io.ReadFull(reader, lengthBuf); err != nil {
		return nil, err
	}
	length := binary.BigEndian.Uint32(lengthBuf)
	value := make([]byte, length)
	if _, err := io.ReadFull(reader, value); err != nil {
		return nil, err
	}
	return &TagValue{Tag: t[0], Value: value}, nil
}

// AsCmd is a struct that represents a command execution environment
type AsCmd struct {
	stdin   io.Writer
	stdout  io.Reader
	version uint32
}

// NewAsCmd creates a new AsCmd instance
func NewAsCmd(stdin io.Writer, stdout io.Reader, host string, version uint32) (*AsCmd, error) {
	if stdin == nil {
		panic("stdin is nil")
	}
	if stdout == nil {
		panic("stdout is nil")
	}

	ascmd := &AsCmd{
		stdin:   stdin,
		stdout:  stdout,
		version: version,
	}
	switch version {
	case 1:
		// No initialization needed for version 1
	case 2:
		command := "session_init --protocol=2"
		if host != "" {
			command += fmt.Sprintf(" --host=%s", host)
		}
		if err := ascmd.sendCommand(command); err != nil {
			return nil, err
		}
	default:
		return nil, fmt.Errorf("unsupported ascmd version: %d", version)
	}
	// Read the first TLV response
	initialReader := bufio.NewReader(ascmd.stdout)
	data, err := readTLV(initialReader)
	if err != nil {
		return nil, err
	}
	if data.Tag != 5 {
		return nil, fmt.Errorf("expected tag 5, got: %d", data.Tag)
	}
	info, err := newInfo(data.Value)
	if err != nil {
		return nil, err
	}
	logger.Debugf("initial info: %v", info)
	return ascmd, nil
}

// Sends a command to ascmd
//
// Parameters:
//   - command: the command to send, without leading "as_" and trailing "\n"
func (a *AsCmd) sendCommand(command string) error {
	logger.Debugf("sending command: as_%s", command)
	command = fmt.Sprintf("as_%s\n", command)
	_, err := a.stdin.Write([]byte(command))
	if err != nil {
		return err
	}
	return nil
}

// Executes a command and returns the result and error status
//
// Parameters:
//   - command: the command to execute.
//   - args: the arguments to the command.
func (a *AsCmd) executeCommandRes(command string, args ...string) (CommandResult, error) {
	full_command := command
	if len(args) > 0 {
		var quotedArgs []string
		for _, arg := range args {
			quotedArgs = append(quotedArgs, fmt.Sprintf(`"%s"`, strings.ReplaceAll(strings.ReplaceAll(arg, `"`, `\"`), `\`, `\\`)))
		}
		full_command += " " + strings.Join(quotedArgs, " ")
	}
	logger.Debugf("executing command: %s", command)
	if err := a.sendCommand(full_command); err != nil {
		return CommandResult{}, err
	}
	resultReader := bufio.NewReader(a.stdout)
	logger.Debugf("reading result for command: %s", command)
	typeValue, err := readTLV(resultReader) // Assuming readTLV is defined elsewhere
	if err != nil {
		return CommandResult{}, err
	}
	result, err := newCommandResult(typeValue)
	if err != nil {
		return CommandResult{}, err
	}
	return *result, nil
}

// Executes a command and returns only error status
//
// Parameters:
//   - command: the command to execute.
//   - args: the arguments to the command.
func (a *AsCmd) executeCommandNoRes(command string, args ...string) error {
	result, err := a.executeCommandRes(command, args...)
	if err != nil {
		return err
	}
	switch res := result.Result.(type) {
	case *CommandSuccess:
		return nil
	case *CommandError:
		return fmt.Errorf("error: %s", res.Errstr)
	default:
		return fmt.Errorf("unexpected result: %s: %v", reflect.TypeOf(result.Result), result.Result)
	}
}

// Decodes a zero terminated string
func decodeZstr(name string, buf []byte) (string, error) {
	// Check if the last byte is zero
	if len(buf) == 0 || buf[len(buf)-1] != 0 {
		return "", fmt.Errorf("expected zero-terminated buffer in decodeZstr(%s): %v", name, buf)
	}
	// Remove the last zero byte and convert the rest to a string
	decodedString := string(buf[:len(buf)-1])
	// Check for invalid UTF-8 characters
	if !utf8.ValidString(decodedString) {
		return "", errors.New("invalid UTF-8 sequence")
	}
	logger.Debugf("decoded string: %s: %v", name, decodedString)
	return decodedString, nil
}

// Decodes a 64-bit unsigned integer from a byte slice
func decodeU64(fieldName string, data []byte) (uint64, error) {
	if len(data) != U64Size {
		return 0, fmt.Errorf("invalid length for %s: expected %d, got %d", fieldName, U64Size, len(data))
	}
	result := binary.BigEndian.Uint64(data)
	logger.Debugf("decoded u64: %s: %v", fieldName, result)
	return result, nil
}

// Decodes a 32-bit unsigned integer from a byte slice
func decodeU32(fieldName string, data []byte) (uint32, error) {
	if len(data) != U32Size {
		return 0, fmt.Errorf("invalid length for %s: expected %d, got %d", fieldName, U32Size, len(data))
	}
	result := binary.BigEndian.Uint32(data)
	logger.Debugf("decoded u32: %s: %v", fieldName, result)
	return result, nil
}

// Retrieves information about the platform
func (a *AsCmd) Info() (Info, error) {
	command := "info"
	result, err := a.executeCommandRes(command)
	if err != nil {
		return Info{}, err
	}
	switch res := result.Result.(type) {
	case Info:
		return res, nil
	case *CommandError:
		return Info{}, fmt.Errorf("error: %s", res.Errstr)
	default:
		return Info{}, fmt.Errorf("unexpected result: %s: %s: %v", command, reflect.TypeOf(result.Result), result.Result)
	}
}

// Retrieves information about a file or directory
func (a *AsCmd) Ls(path string) ([]Stat, error) {
	command := "ls"
	result, err := a.executeCommandRes(command, path)
	if err != nil {
		return nil, err
	}
	switch res := result.Result.(type) {
	case []Stat:
		return result.Result.([]Stat), nil
	case *Stat:
		return []Stat{*res}, nil
	case *CommandError:
		return nil, fmt.Errorf("error: %s", res.Errstr)
	default:
		return nil, fmt.Errorf("unexpected result: %s: %s: %v", command, reflect.TypeOf(result.Result), result.Result)
	}
}

// Deletes a file or directory
func (a *AsCmd) Rm(path string) error {
	return a.executeCommandNoRes("rm", path)
}

// Retrieves size information about a file or directory
func (a *AsCmd) Du(path string) (Size, error) {
	command := "du"
	result, err := a.executeCommandRes(command, path)
	if err != nil {
		return Size{}, err
	}
	switch res := result.Result.(type) {
	case *Size:
		return *res, nil
	case *CommandError:
		return Size{}, fmt.Errorf("error: %s", res.Errstr)
	default:
		return Size{}, fmt.Errorf("unexpected result: %s: %s: %v", command, reflect.TypeOf(result.Result), result.Result)
	}
}

// Creates a directory
func (a *AsCmd) Mkdir(path string) error {
	return a.executeCommandNoRes("mkdir", path)
}

// Copies a file
func (a *AsCmd) Cp(source, destination string) error {
	return a.executeCommandNoRes("cp", source, destination)
}

// Moves a file
func (a *AsCmd) Mv(source, destination string) error {
	return a.executeCommandNoRes("mv", source, destination)
}

// Retrieves information on drives in the system
func (a *AsCmd) Df() (Mounts, error) {
	command := "df"
	result, err := a.executeCommandRes(command)
	if err != nil {
		return Mounts{}, err
	}
	switch res := result.Result.(type) {
	case *Mounts:
		return *res, nil
	case *CommandError:
		return Mounts{}, fmt.Errorf("error: %s", res.Errstr)
	default:
		return Mounts{}, fmt.Errorf("unexpected result: %s: %s: %v", command, reflect.TypeOf(result.Result), result.Result)
	}
}

// Retrieves the MD5 checksum of a file
func (a *AsCmd) Md5sum(path string) (string, error) {
	command := "md5sum"
	result, err := a.executeCommandRes(command, path)
	if err != nil {
		return "", err
	}
	switch res := result.Result.(type) {
	case *Md5sum:
		return res.Md5sum, nil
	case *CommandError:
		return "", fmt.Errorf("error: %s", res.Errstr)
	default:
		return "", fmt.Errorf("unexpected result: %s: %s: %v", command, reflect.TypeOf(result.Result), result.Result)
	}
}

// Terminate sends the "as_exit" command to terminate the ascmd agent
func (a *AsCmd) Terminate() error {
	return a.sendCommand("exit")
}

//===============================================

type AsCmdLocal struct {
	*AsCmd
	cmd *exec.Cmd
}

func NewAsCmdLocal(protocol uint32) (*AsCmdLocal, error) {
	cmd := exec.Command(ASCMDCommand)
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
	ascmdAgent, err := NewAsCmd(stdin, stdout, "", uint32(protocol))
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

type AsCmdRemote struct {
	*AsCmd
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

	ascmdCommand := ASCMDCommand
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
	ascmdAgent, err := NewAsCmd(stdinPipe, stdoutPipe, host, uint32(protocol))
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
