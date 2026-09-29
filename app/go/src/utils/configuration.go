// Configuration object
// Allows sample programs to retrieve parameters from config file
package utils

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"gopkg.in/yaml.v3"
)

// Constants for config file
const (
	PathsFileRel = "config/paths.yaml"
	DirTopVar    = "DIR_TOP"
)

// logger of the package, set by NewConfiguration
var logger *zap.SugaredLogger

// secrets in logs: value of JSON keys ending with one of those words, and JWT assertion in form parameters
var secretsRegex = regexp.MustCompile(`("[^"]*(?:assertion|authorization|password|private_key|secret|token)"\s*:\s*")[^"]+|(assertion=)[^&]+`)

// set from configuration file (misc.show_secrets)
var showSecrets = false

// MaskSecrets hides secrets in text for logs, unless configured to show them.
//
// Parameters:
//   - text: text that may contain secrets
//
// Returns: text with hidden secrets
func MaskSecrets(text string) string {
	if showSecrets {
		return text
	}
	return secretsRegex.ReplaceAllString(text, "${1}${2}***")
}

// LogDump logs a named value: objects are displayed in JSON, and secrets are hidden.
//
// Parameters:
//   - name: name of the value
//   - value: value to log: a string, or an object displayed in JSON
//   - level: log level, debug by default
func LogDump(name string, value any, level ...zapcore.Level) {
	logLevel := zapcore.DebugLevel
	if len(level) != 0 {
		logLevel = level[0]
	}
	if !logger.Level().Enabled(logLevel) {
		return
	}
	text, isString := value.(string)
	if !isString {
		data, err := json.Marshal(value)
		if err != nil {
			text = fmt.Sprint(value)
		} else {
			text = string(data)
		}
	}
	logger.Logf(logLevel, "%s: %s", name, MaskSecrets(text))
}

// Configuration is the configuration of the samples: parameters from the configuration file, files to transfer from the command line, and logging.
type Configuration struct {
	Log       *zap.SugaredLogger
	FileList  []string
	TopFolder string
	LogFolder string
	Paths     map[string]interface{}
	Config    map[string]interface{}
}

// NewConfiguration reads the configuration file, and sets up logging.
//
// Returns: configuration of the samples
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
	logger = zlogger.Sugar()

	topFolderPath, err := findTopFolder()
	if err != nil {
		return nil, err
	}

	paths, err := loadYAML(filepath.Join(topFolderPath, PathsFileRel))
	if err != nil {
		return nil, err
	}

	configFileRel, ok := paths["main_config"].(string)
	if !ok {
		return nil, errors.New("Configuration parameter not found: main_config")
	}

	config, err := loadYAML(filepath.Join(topFolderPath, configFileRel))
	if err != nil {
		return nil, err
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
	zapLevel := logLevel
	if zapLevel == "warning" {
		zapLevel = "warn"
	}
	level, err := zapcore.ParseLevel(zapLevel)
	if err != nil {
		return nil, fmt.Errorf("Invalid log level: %s", logLevel)
	}
	atomicLevel.SetLevel(level)
	showSecrets = c.ParamBool("misc", "show_secrets", false)

	if len(c.FileList) == 0 {
		return nil, errors.New("Missing arguments: files to transfer")
	}

	return c, nil
}

// param gets a parameter from the configuration file.
//
// Parameters:
//   - key1: section in the configuration file
//   - key2: name of the parameter in the section
//
// Returns: value of the parameter, or an error if the parameter is not set
func (c *Configuration) param(key1 string, key2 string) (interface{}, error) {
	section, _ := c.Config[key1].(map[string]interface{})
	val, ok := section[key2]
	if !ok {
		return nil, fmt.Errorf("Configuration parameter not found: %s.%s", key1, key2)
	}
	return val, nil
}

// ParamStr gets a string parameter from the configuration file.
//
// Parameters:
//   - key1: section in the configuration file
//   - key2: name of the parameter in the section
//
// Returns: value of the parameter, that is mandatory
func (c *Configuration) ParamStr(key1 string, key2 string) string {
	val, err := c.param(key1, key2)
	if err != nil {
		panic(err)
	}
	return val.(string)
}

// ParamBool gets a boolean parameter from the configuration file.
//
// Parameters:
//   - key1: section in the configuration file
//   - key2: name of the parameter in the section
//   - def: value if the parameter is not set
//
// Returns: value of the parameter
func (c *Configuration) ParamBool(key1 string, key2 string, def bool) bool {
	val, err := c.param(key1, key2)
	if err != nil {
		return def
	}
	return val.(bool)
}

// GetPath gets the path of an item of the project, from the paths file.
//
// Parameters:
//   - name: name of the item in the paths file
//
// Returns: absolute path of the item, that must exist
func (c *Configuration) GetPath(name string) string {
	itemPath := filepath.Join(c.TopFolder, c.Paths[name].(string))
	if _, err := os.Stat(itemPath); os.IsNotExist(err) {
		c.Log.Fatalf("File not found: %s", itemPath)
	}
	return itemPath
}

// findTopFolder finds the main folder of the repository: from environment variable `DIR_TOP` if set,
// else the first folder containing `config/paths.yaml`, from the current folder up.
//
// Returns: absolute path of the main folder
func findTopFolder() (string, error) {
	if dirTop := os.Getenv(DirTopVar); dirTop != "" {
		topFolderPath, err := filepath.Abs(dirTop)
		if err != nil {
			return "", err
		}
		info, err := os.Stat(topFolderPath)
		if err != nil || !info.IsDir() {
			return "", fmt.Errorf("Folder not found: %s", topFolderPath)
		}
		return topFolderPath, nil
	}
	folder, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if info, err := os.Stat(filepath.Join(folder, PathsFileRel)); err == nil && !info.IsDir() {
			return folder, nil
		}
		parent := filepath.Dir(folder)
		if parent == folder {
			return "", fmt.Errorf("Main folder not found: run from inside the repository, or set %s", DirTopVar)
		}
		folder = parent
	}
}

// loadYAML loads a YAML file.
//
// Parameters:
//   - filePath: path of the YAML file
//
// Returns: content of the file
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

// AddSources adds the files to transfer, from the command line arguments, to the transfer spec.
//
// Parameters:
//   - transferSpec: transfer spec to modify
//   - dotPath: path of the file list in the transfer spec: `paths` (V1) or `assets.paths` (V2)
func (c *Configuration) AddSources(transferSpec map[string]interface{}, dotPath string) error {
	keys := strings.Split(dotPath, ".")
	lastKey := keys[len(keys)-1]
	m := transferSpec
	for _, key := range keys[:len(keys)-1] {
		if val, ok := m[key]; ok {
			if nestedMap, ok := val.(map[string]interface{}); ok {
				m = nestedMap
			} else {
				return fmt.Errorf("Invalid path in transfer spec: %s", dotPath)
			}
		} else {
			return fmt.Errorf("Invalid path in transfer spec: %s", dotPath)
		}
	}
	// value may be absent or of any slice type (e.g. []interface{} when decoded from JSON)
	pathsArray := make([]map[string]string, 0, len(c.FileList))
	for _, filePath := range c.FileList {
		pathsArray = append(pathsArray, map[string]string{
			"source": filePath,
		})
	}
	m[lastKey] = pathsArray
	return nil
}

// GetPortOrDefault gets the port of a URL, or a default port.
//
// Parameters:
//   - u: URL
//   - defaultPort: port if the URL has no port
//
// Returns: port
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
