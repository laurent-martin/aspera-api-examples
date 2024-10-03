use env_logger;
use serde_json::json;
use std::env;
use std::error::Error;
use std::fs::File;
use std::io;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

const PATHS_FILE_REL: &str = "config/paths.yaml";
const ITEM_WIDTH: usize = 12;

pub struct Configuration {
    log_folder_path: PathBuf,
    top_folder_path: PathBuf,
    file_list: Vec<String>,
    paths: serde_yaml::Value,
    config: serde_yaml::Value,
}

impl Configuration {
    pub fn new() -> Result<Self, Box<dyn Error>> {
        // Initialize logger
        env_logger::init();
        // Collect command-line arguments (argc and argv equivalent in Rust)
        let args: Vec<String> = env::args().collect();
        if args.len() < 2 {
            log::error!("No file(s) to transfer provided.");
            return Err(Box::new(io::Error::new(
                io::ErrorKind::Other,
                "No files provided",
            )));
        }

        // Initialize paths
        let top_folder_path = env::current_dir()?.parent().unwrap().to_path_buf();
        let log_folder_path = std::env::temp_dir();
        let file_list = args[2..].to_vec();

        // Load YAML files
        let paths = Self::load_yaml("paths", top_folder_path.join(PATHS_FILE_REL))?;
        let config = Self::load_yaml(
            "main_config",
            top_folder_path.join(Self::get_path_from_yaml(&paths, "main_config")?),
        )?;

        Ok(Self {
            log_folder_path,
            top_folder_path,
            file_list,
            paths,
            config,
        })
    }

    pub fn log_folder_path(&self) -> &Path {
        &self.log_folder_path
    }

    fn get_subkey_value(
        yaml: serde_yaml::Value,
        key: &str,
        subkey: &str,
    ) -> Result<serde_yaml::Value, Box<dyn Error>> {
        // Access the top-level map and retrieve the key
        let map = yaml
            .as_mapping()
            .ok_or("The root YAML structure is not a map")?;
        let hash_value = map
            .get(&serde_yaml::Value::String(key.to_string()))
            .ok_or(format!("Key '{}' not found", key))?;
        // Access the sub-map and retrieve the subkey
        let submap = hash_value
            .as_mapping()
            .ok_or(format!("The value for '{}' is not a map", key))?;
        let subkey_value = submap
            .get(&serde_yaml::Value::String(subkey.to_string()))
            .ok_or(format!("Subkey '{}' not found in '{}'", subkey, key))?;
        Ok(subkey_value.clone()) // Return the found value
    }
    pub fn param_str(&self, key1: &str, key2: &str) -> Result<String, Box<dyn Error>> {
        // Use the helper function to retrieve the nested value
        let value = Self::get_subkey_value(self.config.clone(), key1, key2)?;

        // Check if the retrieved value is a string, return an error if not
        value.as_str().map(|s| s.to_string()).ok_or(
            format!(
                "Value for key '{}' and subkey '{}' is not a valid string",
                key1, key2
            )
            .into(),
        )
    }

    pub fn get_path(&self, name: &str) -> io::Result<PathBuf> {
        let item_path = self
            .top_folder_path
            .join(Self::get_path_from_yaml(&self.paths, name)?);
        if !item_path.exists() {
            log::error!("{} not found.", item_path.display());
            return Err(io::Error::new(io::ErrorKind::NotFound, "Path not found"));
        }
        Ok(item_path)
    }

    pub fn add_files_to_ts(
        &self,
        path: &str,
        json: &mut serde_json::Value,
    ) -> Result<(), Box<dyn Error>> {
        // Split the path into keys
        let keys: Vec<&str> = path.split('.').collect();

        // Ensure we have at least one key
        if keys.is_empty() {
            return Err("Path cannot be empty.".into());
        }

        // Take the last key ("paths") for later use
        let last_key = keys.last().unwrap();
        let parent_keys = &keys[..keys.len() - 1]; // All keys except the last one

        // Navigate to the correct location in the JSON
        let mut current = json;

        for key in parent_keys {
            // Dereference the key to use it as a &str
            current = match current.as_object_mut() {
                Some(obj) => obj
                    .entry(*key)
                    .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new())), // Use a closure here
                None => {
                    return Err(format!("Error: Path '{}' is not valid.", path).into());
                }
            };
        }

        // Create the paths array and populate it with file paths
        let paths_array: Vec<_> = self
            .file_list
            .clone()
            .into_iter()
            .map(|path| json!({ "source": path }))
            .collect();

        // Set the paths key to the new array
        current[last_key] = json!(paths_array);

        Ok(())
    }

    fn last_file_line(filename: &str) -> io::Result<String> {
        let mut file = File::open(filename)?;

        // Start by seeking to the end of the file
        let mut buffer = Vec::new();
        let mut pos = file.seek(SeekFrom::End(0))?;

        // Read backwards until we find a newline or reach the beginning of the file
        while pos > 0 {
            // Move the cursor back by one byte
            pos -= 1;
            file.seek(SeekFrom::Start(pos))?;

            let mut byte = [0; 1];
            file.read_exact(&mut byte)
                .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;

            // Stop when we find a newline character (or the beginning of the file)
            if byte[0] == b'\n' && !buffer.is_empty() {
                break;
            }

            buffer.push(byte[0]);
        }

        // Reverse the buffer since we read it backwards
        buffer.reverse();

        // Convert the buffer to a string and return
        let last_line =
            String::from_utf8(buffer).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        Ok(last_line)
    }
    fn load_yaml(name: &str, path: PathBuf) -> Result<serde_yaml::Value, Box<dyn Error>> {
        log::debug!("{:width$}: {}", name, path.display(), width = ITEM_WIDTH); // Open the file and propagate the error if any
        let mut file = File::open(path)?;

        // Read the file contents into a string
        let mut contents = String::new();
        file.read_to_string(&mut contents)?;

        // Parse the YAML string into a `Value` and propagate any error
        let yaml: serde_yaml::Value = serde_yaml::from_str(&contents)?;

        let yaml_dump = serde_yaml::to_string(&yaml)?;

        // Log the parsed YAML value
        log::debug!("{}:\n{}", name, yaml_dump);

        // Return the parsed YAML value
        Ok(yaml)
    }

    fn get_path_from_yaml(yaml: &serde_yaml::Value, key: &str) -> io::Result<String> {
        Ok(yaml[key].as_str().unwrap_or("").to_string())
    }
}
