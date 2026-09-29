use env_logger;
use regex::Regex;
use serde_json::json;
use std::env;
use std::error::Error;
use std::fs::File;
use std::io;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::sync::atomic::{AtomicBool, Ordering};

const PATHS_FILE_REL: &str = "config/paths.yaml";
const DIR_TOP_VAR: &str = "DIR_TOP";
/// secrets in logs: value of JSON keys ending with one of those words, and JWT assertion in form parameters
static SECRETS_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"("[^"]*(?:assertion|authorization|password|private_key|secret|token)"\s*:\s*")[^"]+|(assertion=)[^&]+"#)
        .unwrap()
});
/// set from configuration file (misc.show_secrets)
static SHOW_SECRETS: AtomicBool = AtomicBool::new(false);

/// Hide secrets in text for logs, unless configured to show them.
///
/// # Arguments
/// * `text` - text that may contain secrets
///
/// # Returns
/// Text with hidden secrets
pub fn mask_secrets(text: &str) -> String {
    if SHOW_SECRETS.load(Ordering::Relaxed) {
        return text.to_string();
    }
    SECRETS_REGEX.replace_all(text, "${1}${2}***").into_owned()
}

/// Log a named value: objects are displayed in JSON, and secrets are hidden.
///
/// # Arguments
/// * `name` - name of the value
/// * `value` - value to log: a string, or a JSON value
/// * `level` - log level, typically debug
pub fn log_dump(name: &str, value: impl std::fmt::Display, level: log::Level) {
    if log::log_enabled!(level) {
        log::log!(level, "{name}: {}", mask_secrets(&value.to_string()));
    }
}

/// Configuration of the samples: parameters from the configuration file, files to transfer from the command line, and logging.
pub struct Configuration {
    log_folder_path: PathBuf,
    top_folder_path: PathBuf,
    file_list: Vec<String>,
    paths: serde_yaml_ng::Value,
    config: serde_yaml_ng::Value,
}

impl Configuration {
    /// Read the configuration file, and set up logging.
    ///
    /// # Returns
    /// Configuration of the samples
    pub fn new() -> Result<Self, Box<dyn Error>> {
        // Initialize logger
        env_logger::Builder::new()
            .filter_level(log::LevelFilter::Debug)
            .format(|buf: &mut env_logger::fmt::Formatter, record| {
                writeln!(buf, "{:<8} {}", record.level(), record.args())
            })
            .init();
        let top_folder_path = Self::find_top_folder()?;
        let log_folder_path = std::env::temp_dir();
        let paths = Self::load_yaml(top_folder_path.join(PATHS_FILE_REL))?;
        let config = Self::load_yaml(top_folder_path.join(Self::get_path_from_yaml(&paths, "main_config")))?;
        let mut configuration = Self {
            log_folder_path,
            top_folder_path,
            file_list: Vec::new(),
            paths,
            config,
        };
        // set general log level
        log::set_max_level(Self::get_level_filter(&configuration.param_str("misc", "level")?)?);
        let show_secrets = configuration.param("misc", "show_secrets").ok().and_then(|value| value.as_bool());
        SHOW_SECRETS.store(show_secrets.unwrap_or(false), Ordering::Relaxed);
        // first arg is executable path
        configuration.file_list = env::args().skip(1).collect();
        if configuration.file_list.is_empty() {
            return Err("Missing arguments: files to transfer".into());
        }
        Ok(configuration)
    }
    /// Get the folder for log files.
    ///
    /// # Returns
    /// Folder for log files
    pub fn log_folder_path(&self) -> &Path {
        &self.log_folder_path
    }
    /// Get a parameter from the configuration file.
    ///
    /// # Arguments
    /// * `section` - section in the configuration file
    /// * `param` - name of the parameter in the section
    ///
    /// # Returns
    /// Value of the parameter, that is mandatory
    fn param(&self, section: &str, param: &str) -> Result<&serde_yaml_ng::Value, Box<dyn Error>> {
        self.config
            .get(section)
            .and_then(|value| value.get(param))
            .ok_or_else(|| format!("Configuration parameter not found: {section}.{param}").into())
    }
    /// Get a string parameter from the configuration file.
    ///
    /// # Arguments
    /// * `section` - section in the configuration file
    /// * `param` - name of the parameter in the section
    ///
    /// # Returns
    /// Value of the parameter, that is mandatory
    pub fn param_str(&self, section: &str, param: &str) -> Result<String, Box<dyn Error>> {
        self.param(section, param)?
            .as_str()
            .map(|value| value.to_string())
            .ok_or_else(|| format!("Invalid configuration parameter: {section}.{param}").into())
    }
    /// Get a boolean parameter from the configuration file.
    ///
    /// # Arguments
    /// * `section` - section in the configuration file
    /// * `param` - name of the parameter in the section
    ///
    /// # Returns
    /// Value of the parameter, that is mandatory
    pub fn param_bool(&self, section: &str, param: &str) -> Result<bool, Box<dyn Error>> {
        self.param(section, param)?
            .as_bool()
            .ok_or_else(|| format!("Invalid configuration parameter: {section}.{param}").into())
    }
    /// Get the path of an item of the project, from the paths file.
    ///
    /// # Arguments
    /// * `name` - name of the item in the paths file
    ///
    /// # Returns
    /// Absolute path of the item, that must exist
    pub fn get_path(&self, name: &str) -> io::Result<PathBuf> {
        let item_path = self.top_folder_path.join(Self::get_path_from_yaml(&self.paths, name));
        if !item_path.exists() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                format!("File not found: {}", item_path.display()),
            ));
        }
        Ok(item_path)
    }
    /// Add the files to transfer, from the command line arguments, to the transfer spec.
    ///
    /// # Arguments
    /// * `path` - path of the file list in the transfer spec: `paths` (V1) or `assets.paths` (V2)
    /// * `json` - transfer spec to modify
    pub fn add_files_to_ts(&self, path: &str, json: &mut serde_json::Value) -> Result<(), Box<dyn Error>> {
        let keys: Vec<&str> = path.split('.').collect();
        let (last_key, parent_keys) = keys.split_last().unwrap();
        // Navigate to the correct location in the JSON
        let mut current = json;
        for key in parent_keys {
            current = match current.as_object_mut() {
                Some(obj) => obj
                    .entry(*key)
                    .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new())),
                None => return Err(format!("Invalid path in transfer spec: {path}").into()),
            };
        }
        let paths_array: Vec<_> = self.file_list.iter().map(|file| json!({ "source": file })).collect();
        current[*last_key] = json!(paths_array);
        Ok(())
    }
    /// Find the main folder of the repository: from environment variable `DIR_TOP` if set,
    /// else the first folder containing `config/paths.yaml`, from the current folder up.
    ///
    /// # Returns
    /// Absolute path of the main folder
    fn find_top_folder() -> Result<PathBuf, Box<dyn Error>> {
        if let Some(dir_top) = env::var(DIR_TOP_VAR).ok().filter(|value| !value.is_empty()) {
            let top_folder_path = std::path::absolute(&dir_top)?;
            if !top_folder_path.is_dir() {
                return Err(format!("Folder not found: {}", top_folder_path.display()).into());
            }
            return Ok(top_folder_path);
        }
        env::current_dir()?
            .ancestors()
            .find(|folder| folder.join(PATHS_FILE_REL).is_file())
            .map(Path::to_path_buf)
            .ok_or_else(|| format!("Main folder not found: run from inside the repository, or set {DIR_TOP_VAR}").into())
    }
    /// Load a YAML file.
    ///
    /// # Arguments
    /// * `path` - path of the YAML file
    ///
    /// # Returns
    /// Content of the file
    fn load_yaml(path: PathBuf) -> Result<serde_yaml_ng::Value, Box<dyn Error>> {
        let mut file = File::open(&path).map_err(|_| format!("File not found: {}", path.display()))?;
        let mut contents = String::new();
        file.read_to_string(&mut contents)?;
        Ok(serde_yaml_ng::from_str(&contents)?)
    }
    /// Get the relative path of an item of the project, from the paths file.
    ///
    /// # Arguments
    /// * `yaml` - content of the paths file
    /// * `key` - name of the item in the paths file
    ///
    /// # Returns
    /// Relative path of the item, or empty
    fn get_path_from_yaml(yaml: &serde_yaml_ng::Value, key: &str) -> String {
        yaml[key].as_str().unwrap_or("").to_string()
    }
    /// Convert the log level of the samples from name to filter.
    ///
    /// # Arguments
    /// * `level` - `debug`, `info`, `warning` or `error`
    ///
    /// # Returns
    /// Log level filter
    fn get_level_filter(level: &str) -> Result<log::LevelFilter, Box<dyn Error>> {
        match level {
            "error" => Ok(log::LevelFilter::Error),
            "warning" => Ok(log::LevelFilter::Warn),
            "info" => Ok(log::LevelFilter::Info),
            "debug" => Ok(log::LevelFilter::Debug),
            _ => Err(format!("Invalid log level: {level}").into()),
        }
    }
}
