package utils

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strconv"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"gopkg.in/yaml.v3"
)

// Constants for config file and logging
const (
	PathsFileRel = "config/paths.yaml"
	ItemWidth    = 12
)

// Configuration provides common environment settings for the application.
// It includes methods for configuration loading, logging, file utilities, and more.
type Configuration struct {
	Log           *zap.SugaredLogger
	FileList      []string
	TopFolderPath string
	LogFolderPath string
	Paths         map[string]interface{}
	Config        map[string]interface{}
}

// NewConfiguration initializes a Configuration instance, loading YAML configuration files and setting up logging.
func NewConfiguration() (*Configuration, error) {
	// Create an atomic level that can be dynamically changed
	atomicLevel := zap.NewAtomicLevelAt(zapcore.DebugLevel)

	// Define custom zap configuration
	zap_config := zap.Config{
		Level:       atomicLevel,
		Development: true,
		Encoding:    "console", // Use console encoding
		EncoderConfig: zapcore.EncoderConfig{
			MessageKey:  "msg",
			LevelKey:    "level",
			EncodeLevel: zapcore.CapitalColorLevelEncoder, // For colorized output
			//TimeKey:     "ts",
			EncodeTime: nil,
		},
		OutputPaths:      []string{"stdout"},
		ErrorOutputPaths: []string{"stderr"},
	}

	// Build the logger
	zlogger, _ := zap_config.Build()
	defer zlogger.Sync() // Flushes buffer, if any
	logger := zlogger.Sugar()
	if len(os.Args) < 1 {
		return nil, errors.New("no files to process")
	}

	topFolderPath, err := filepath.Abs(filepath.Join(filepath.Dir(os.Args[0]), "../.."))
	if err != nil {
		return nil, err
	}
	logger.Debugf("top folder path: %s", topFolderPath)

	pathsFile := filepath.Join(topFolderPath, PathsFileRel)
	paths, err := loadYAML(pathsFile)
	if err != nil {
		return nil, fmt.Errorf("failed to load paths YAML: %v", err)
	}
	logger.Debugf("paths: %v", paths)

	configFileRel, ok := paths["main_config"].(string)
	if !ok {
		return nil, fmt.Errorf("invalid config file path")
	}
	logger.Debugf("config file: %s", configFileRel)
	configFile := filepath.Join(topFolderPath, configFileRel)
	logger.Debugf("config file path: %s", configFile)

	config, err := loadYAML(configFile)
	if err != nil {
		return nil, fmt.Errorf("failed to load main config: %v", err)
	}

	c := &Configuration{
		Log:           logger,
		FileList:      os.Args[1:],
		TopFolderPath: topFolderPath,
		LogFolderPath: os.TempDir(),
		Paths:         paths,
		Config:        config,
	}

	// Set logging level based on config
	logLevel := c.ParamStr("misc", "level")
	logger.Debugf("log level: %s", logLevel)

	if len(c.FileList) == 0 {
		c.Log.Error("No files provided")
		return nil, errors.New("no files provided")
	}

	// Logging paths and files
	c.Log.Debugf("top_folder: %s", c.TopFolderPath)
	for _, file := range c.FileList {
		c.Log.Debugf("file: %s", file)
	}

	return c, nil
}

// param digs into the config based on a key list and returns the result.
func (c *Configuration) param(key1 string, key2 string) (interface{}, error) {
	val1, ok := c.Config[key1]
	if !ok {
		return nil, fmt.Errorf("key %s not found", key1)
	}
	val2, ok := val1.(map[string]interface{})[key2]
	if !ok {
		return nil, fmt.Errorf("key %s not found", key2)
	}
	return val2, nil
}

// ParamStr gets a string from the configuration file.
func (c *Configuration) ParamStr(key1 string, key2 string) string {
	val, err := c.param(key1, key2)
	if err != nil {
		panic(err)
	}
	return val.(string)
}

// getPath retrieves the path for a specified key in the test environment.
func (c *Configuration) getPath(name string) (string, error) {
	itemPath := filepath.Join(c.TopFolderPath, c.Paths[name].(string))
	if _, err := os.Stat(itemPath); os.IsNotExist(err) {
		c.Log.Errorf("%s not found", itemPath)
		return "", errors.New("path not found")
	}
	return itemPath, nil
}

// lastFileLine gets the last line of a file.
func lastFileLine(filename string) (string, error) {
	file, err := os.Open(filename)
	if err != nil {
		return "", err
	}
	defer file.Close()

	// Get file size
	fileInfo, err := file.Stat()
	if err != nil {
		return "", err
	}

	fileSize := fileInfo.Size()

	var lastLine string
	buf := make([]byte, 1)
	// Start reading from the end of the file
	for {
		if _, err := file.ReadAt(buf, fileSize-1); err == nil && buf[0] == '\n' {
			break
		}
		fileSize--
		if fileSize <= 0 {
			break
		}
	}

	// Read the last line
	file.Seek(fileSize, io.SeekStart)
	scanner := bufio.NewScanner(file)
	if scanner.Scan() {
		lastLine = scanner.Text()
	}

	if err := scanner.Err(); err != nil {
		return "", err
	}

	return lastLine, nil
}

// loadYAML loads a YAML file and returns its contents as a map.
func loadYAML(filePath string) (map[string]interface{}, error) {
	obj := make(map[string]interface{})
	yamlFile, err := os.ReadFile(filePath)
	if err != nil {
		return nil, err
	}
	err = yaml.Unmarshal(yamlFile, obj)
	if err != nil {
		return nil, err
	}
	return obj, nil
}

// AddFilesToTS simulates adding files to the transfer spec
func (c *Configuration) AddFilesToTS(key string, transferSpec map[string]interface{}) error {
	// Here, you can add actual file paths to the "paths" key in the transfer spec
	paths := []string{"file1.txt", "file2.txt"} // Example files
	spec, ok := transferSpec["assets"].(map[string]interface{})
	if !ok {
		return fmt.Errorf("assets not found in transfer spec")
	}

	spec["paths"] = append(spec["paths"].([]string), paths...)
	return nil
}

// Helper function to get the port or default value
func GetPortOrDefault(u *url.URL, defaultPort int) int {
	result := defaultPort
	if u.Port() != "" {
		port, err := strconv.Atoi(u.Port())
		if err != nil {
			panic(err)
		}
		result = port
	}
	return result
}
