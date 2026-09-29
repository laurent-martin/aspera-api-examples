#pragma once

#include <yaml-cpp/yaml.h>

#include <boost/algorithm/string/case_conv.hpp>
#include <boost/algorithm/string/classification.hpp>
#include <boost/algorithm/string/join.hpp>
#include <boost/algorithm/string/split.hpp>
#include <boost/beast/core/detail/base64.hpp>
#include <boost/json.hpp>
#include <boost/log/core.hpp>
#include <boost/log/expressions.hpp>
#include <boost/log/sources/logger.hpp>
#include <boost/log/support/date_time.hpp>
#include <boost/log/trivial.hpp>
#include <boost/log/utility/setup/common_attributes.hpp>
#include <boost/log/utility/setup/console.hpp>
#include <boost/regex.hpp>
#include <boost/uuid/uuid.hpp>
#include <boost/uuid/uuid_generators.hpp>
#include <boost/uuid/uuid_io.hpp>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <magic_enum.hpp>
#include <sstream>
#include <string>
#include <vector>

namespace json = boost::json;
namespace base64 = boost::beast::detail::base64;

namespace utils {
inline constexpr const char* PATHS_FILE_REL = "config/paths.yaml";
// logger
inline boost::log::sources::severity_logger<boost::log::trivial::severity_level> global_logger;
#define LOGGER(level) BOOST_LOG_SEV(utils::global_logger, boost::log::trivial::level)
// secrets in logs: value of JSON keys ending with one of those words, and JWT assertion in form parameters
inline const boost::regex SECRETS_REGEX(
    R"re(("[^"]*(?:assertion|authorization|password|private_key|secret|token)"\s*:\s*")[^"]+|(assertion=)[^&]+)re");
// set from configuration file (misc.show_secrets)
inline bool show_secrets = false;

/// @brief Hide secrets in text for logs, unless configured to show them.
/// @param text text that may contain secrets
/// @return text with hidden secrets
inline std::string mask_secrets(const std::string& text) {
    if (show_secrets) {
        return text;
    }
    return boost::regex_replace(text, SECRETS_REGEX, "$1$2***");
}

/// @brief Log a named value: JSON values are displayed in JSON, and secrets are hidden.
/// @param name name of the value
/// @param value value to log: a string, or a JSON value
/// @param level log level, debug by default
template <typename T>
inline void log_dump(const std::string& name, const T& value, const boost::log::trivial::severity_level level = boost::log::trivial::debug) {
    std::ostringstream text;
    text << value;
    BOOST_LOG_SEV(global_logger, level) << name << ": " << mask_secrets(text.str());
}

/// @brief Configuration of the samples: parameters from the configuration file, files to transfer from the command line, and logging.
class Configuration {
   public:
    /// @brief Read the configuration file, and set up logging.
    /// @param argc number of command line arguments
    /// @param argv command line arguments: files to transfer
    Configuration(
        const int argc,
        const char* const argv[])
        : _init_log(init_log()),
          _file_list(argv + 1, argv + argc),
          _top_folder_path(init_top_folder_path()),
          _log_folder_path(std::filesystem::temp_directory_path()),
          _paths(load_yaml(_top_folder_path / PATHS_FILE_REL)),
          _config(load_yaml(get_path("main_config"))) {
        auto log_level = param_str({"misc", "level"});
        auto opt_level = magic_enum::enum_cast<boost::log::trivial::severity_level>(log_level);
        if (!opt_level.has_value()) {
            throw std::invalid_argument("Invalid log level: " + log_level);
        }
        boost::log::core::get()->set_filter(boost::log::trivial::severity >= opt_level.value());
        show_secrets = param_bool({"misc", "show_secrets"}, false);
        if (_file_list.empty()) {
            throw std::runtime_error("Missing arguments: files to transfer");
        }
    }

    /// @brief Stop logging.
    ~Configuration() {
        if (_init_log) {
            boost::log::core::get()->remove_all_sinks();
        }
    }

    /// @brief Get the folder for log files.
    /// @return folder for log files
    const std::filesystem::path& log_folder_path() const {
        return _log_folder_path;
    }

    /// @brief Find a parameter in the configuration file.
    /// @param keys section in the configuration file, and name of the parameter in the section
    /// @return value of the parameter, not defined if not found
    YAML::Node find_param(const std::vector<std::string>& keys) {
        // Need to clone, else it will be modified in loop
        YAML::Node currentNode = YAML::Clone(_config);
        for (const auto& key : keys) {
            const auto next_node = currentNode[key];
            if (!next_node.IsDefined()) {
                return next_node;
            }
            currentNode = next_node;
        }
        return currentNode;
    }

    /// @brief Get a parameter from the configuration file.
    /// @param keys section in the configuration file, and name of the parameter in the section
    /// @return value of the parameter, that is mandatory
    YAML::Node param(const std::vector<std::string>& keys) {
        const YAML::Node node = find_param(keys);
        if (!node.IsDefined()) {
            throw std::runtime_error("Configuration parameter not found: " + boost::algorithm::join(keys, "."));
        }
        return node;
    }

    /// @brief Get a string parameter from the configuration file.
    /// @param keys section in the configuration file, and name of the parameter in the section
    /// @return value of the parameter, that is mandatory
    std::string param_str(const std::vector<std::string>& keys) {
        return param(keys).as<std::string>();
    }
    /// @brief Get a boolean parameter from the configuration file.
    /// @param keys section in the configuration file, and name of the parameter in the section
    /// @param default_value value if the parameter is not set
    /// @return value of the parameter
    bool param_bool(const std::vector<std::string>& keys, bool default_value = false) {
        const YAML::Node node = find_param(keys);
        return node.IsDefined() ? node.as<bool>() : default_value;
    }

    /// @brief Get the path of an item of the project, from the paths file.
    /// @param name name of the item in the paths file
    /// @return absolute path of the item, that must exist
    std::filesystem::path get_path(const std::string& name) {
        std::filesystem::path item_path = _top_folder_path / _paths[name].as<std::string>();
        if (!std::filesystem::exists(item_path)) {
            throw std::runtime_error("File not found: " + item_path.string());
        }
        return item_path;
    }

    /// @brief Add the files to transfer, from the command line arguments, to the transfer spec.
    /// @param transfer_spec transfer spec to modify
    /// @param path path of the file list in the transfer spec: `paths` (V1) or `assets.paths` (V2)
    /// @param add_destination if true, add the file name as destination
    void add_sources(json::object& transfer_spec, const std::string& path, bool add_destination = false) const {
        std::vector<std::string> keys;
        boost::split(keys, path, boost::is_any_of("."), boost::token_compress_on);
        json::object* current_node = &transfer_spec;

        // Iterate through all keys except the last one
        for (size_t i = 0; i < keys.size() - 1; ++i) {
            const std::string& key = keys[i];
            if (current_node->contains(key) && current_node->at(key).is_object()) {
                current_node = &current_node->at(key).as_object();
            } else {
                throw std::runtime_error("Invalid path in transfer spec: " + path);
            }
        }

        // Access or create the final list at the last key
        // json::array& paths = current_node->emplace(keys.back(), json::array{}).first->value().as_array();
        json::array& paths = current_node->insert_or_assign(keys.back(), json::array{}).first->value().as_array();
        // Add files to the paths array
        for (const auto& f : _file_list) {
            json::object source = {{"source", f}};
            if (add_destination) {
                source["destination"] = std::filesystem::path(f).filename().string();
            }
            paths.push_back(source);
        }
    }

   private:
    // log initialization
    const bool _init_log;
    // list of files to transfer
    const std::vector<std::string> _file_list;
    // project folder
    const std::filesystem::path _top_folder_path;
    const std::filesystem::path _log_folder_path;
    // config file with paths
    const YAML::Node _paths;
    // config file with parameters (server addresses ...)
    const YAML::Node _config;

    /// @brief Load a YAML file.
    /// @param path path of the YAML file
    /// @return content of the file
    YAML::Node load_yaml(const std::filesystem::path& path) {
        return YAML::LoadFile(path.string());
    }

    /// @brief Set up logging to the console: level in uppercase, and message.
    /// @return true
    bool init_log() {
        boost::log::add_common_attributes();
        boost::log::core::get()->set_filter(boost::log::trivial::severity >= boost::log::trivial::info);
        boost::log::add_console_log(std::clog)->set_formatter(
            [](const boost::log::record_view& record, boost::log::formatting_ostream& stream) {
                const auto severity = record[boost::log::trivial::severity];
                const std::string level = severity ? boost::algorithm::to_upper_copy(std::string(boost::log::trivial::to_string(*severity))) : "";
                stream << std::setw(8) << std::left << level << " " << record[boost::log::expressions::smessage];
            });
        return true;
    }
    /// @brief Get the folder of the project, from environment variable `DIR_TOP`.
    /// @return folder of the project
    static inline std::filesystem::path init_top_folder_path() {
        const char* dir_top = std::getenv("DIR_TOP");
        if (dir_top == nullptr) {
            throw std::runtime_error("Environment variable DIR_TOP is not set");
        }
        std::filesystem::path top_path = dir_top;
        if (!std::filesystem::is_directory(top_path)) {
            throw std::runtime_error("Folder not found: " + top_path.string());
        }
        return top_path;
    }
};

/// @brief Encode a string in base64.
/// @param clear_string string to encode
/// @return base64 string
inline std::string base64_encode(const std::string& clear_string) {
    std::string encoded_string;
    encoded_string.resize(base64::encoded_size(clear_string.size()));
    base64::encode(encoded_string.data(), clear_string.data(), clear_string.size());
    return encoded_string;
}

/// @brief Generate a random UUID.
/// @return UUID
inline std::string uuid_random() {
    return boost::uuids::to_string(boost::uuids::random_generator()());
}
}  // namespace utils
