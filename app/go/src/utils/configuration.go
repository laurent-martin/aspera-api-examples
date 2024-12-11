// Configuration object
// Allows sample programs to retrieve parameters from config file
package utils

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

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
	Log       *zap.SugaredLogger
	FileList  []string
	TopFolder string
	LogFolder string
	Paths     map[string]interface{}
	Config    map[string]interface{}
}

// Initializes a Configuration instance, loading YAML configuration files and setting up logging.
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

	topFolderPath := os.Getenv("DIR_TOP")
	if topFolderPath == "" {
		return nil, fmt.Errorf("environment variable DIR_TOP is not set")
	}
	topFolderPath, err := filepath.Abs(topFolderPath)
	if err != nil {
		return nil, fmt.Errorf("failed to get absolute path of DIR_TOP: %v", err)
	}
	info, err := os.Stat(topFolderPath)
	if os.IsNotExist(err) || !info.IsDir() {
		return nil, fmt.Errorf("the folder specified by DIR_TOP does not exist: %s", topFolderPath)
	} else if err != nil {
		return nil, fmt.Errorf("error checking DIR_TOP: %v", err)
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
		Log:       logger,
		FileList:  os.Args[1:],
		TopFolder: topFolderPath,
		LogFolder: os.TempDir(),
		Paths:     paths,
		Config:    config,
	}

	// Set logging level based on config
	logLevel := c.ParamStr("misc", "level")
	logger.Debugf("log level: %s", logLevel)

	if len(c.FileList) == 0 {
		c.Log.Error("No files provided")
		return nil, errors.New("no files provided")
	}

	// Logging paths and files
	c.Log.Debugf("top_folder: %s", c.TopFolder)
	for _, file := range c.FileList {
		c.Log.Debugf("file: %s", file)
	}

	return c, nil
}

// Digs into the config based on a key list and returns the result.
//
// Parameters:
//   - key1: first level key in map
//   - key2: second level key in map
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

// Gets a string from the configuration file.
func (c *Configuration) ParamStr(key1 string, key2 string) string {
	val, err := c.param(key1, key2)
	if err != nil {
		panic(err)
	}
	return val.(string)
}

func (c *Configuration) ParamBool(key1 string, key2 string, def bool) bool {
	val, err := c.param(key1, key2)
	if err != nil {
		return def
	}
	return val.(bool)
}

// Retrieves the path for a specified key in the test environment.
func (c *Configuration) GetPath(name string) string {
	itemPath := filepath.Join(c.TopFolder, c.Paths[name].(string))
	if _, err := os.Stat(itemPath); os.IsNotExist(err) {
		c.Log.Fatalf("%s not found", itemPath)
	}
	return itemPath
}

// Gets the last line of a file.
//
// Parameters:
//   - filename: path to the log file.
func LastFileLine(filename string) (string, error) {
	file, err := os.Open(filename)
	if err != nil {
		return "", err
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil {
		return "", err
	}
	var offset int64 = stat.Size() - 1
	var lastLine []byte
	buf := make([]byte, 1)
	for offset >= 0 {
		file.Seek(offset, 0)
		_, err := file.Read(buf)
		if err != nil {
			return "", err
		}
		if buf[0] == '\n' && offset != stat.Size()-1 { // On saute le dernier \n
			break
		}
		lastLine = append([]byte{buf[0]}, lastLine...)
		offset--
	}
	return string(lastLine), nil
}

// Loads a YAML file and returns its contents as a map.
//
// Parameters:
//   - filename: path to the yaml file.
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

// Add files provided on command line to the transfer specification.
//
// Parameters:
//   - dotPath: path in map of transfer spec
//   - transferSpec: transfer specification map
func (c *Configuration) AddSources(transferSpec map[string]interface{}, dotPath string) error {
	keys := strings.Split(dotPath, ".")
	lastKey := keys[len(keys)-1]
	m := transferSpec
	for _, key := range keys[:len(keys)-1] {
		if val, ok := m[key]; ok {
			if nestedMap, ok := val.(map[string]interface{}); ok {
				m = nestedMap
			} else {
				return fmt.Errorf("key %s is not a map", key)
			}
		} else {
			return fmt.Errorf("key %s not found in map", key)
		}
	}
	if pathsArray, ok := m[lastKey].([]map[string]string); ok {
		for _, filePath := range c.FileList {
			pathsArray = append(pathsArray, map[string]string{
				"source": filePath,
			})
		}
		m[lastKey] = pathsArray
	} else {
		return fmt.Errorf("%s is not a valid array", lastKey)
	}
	return nil
}

// Helper function to get the port or default value
//
// Parameters:
//   - u: URL object
//   - defaultPort: default port value
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
