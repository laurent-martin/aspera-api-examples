#pragma once

#include <yaml-cpp/yaml.h>

#include <boost/algorithm/string/classification.hpp>
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
#include <boost/uuid/uuid.hpp>
#include <boost/uuid/uuid_generators.hpp>
#include <boost/uuid/uuid_io.hpp>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <magic_enum.hpp>
#include <string>
#include <vector>

namespace json = boost::json;
namespace base64 = boost::beast::detail::base64;

namespace utils {
inline constexpr const char* PATHS_FILE_REL = "config/paths.yaml";
inline constexpr const int ITEM_WIDTH = 12;
// logger
inline boost::log::sources::severity_logger<boost::log::trivial::severity_level> global_logger;
#define LOG(level) BOOST_LOG_SEV(utils::global_logger, boost::log::trivial::level)
#define LOG_ITEM(item) std::setw(utils::ITEM_WIDTH) << item << ": "

// Provide a common environment for tests, including:
// - configuration file parameters
// - misc utilities
//      - logging
//      - read last line of file
//      - file list as command line parameters
class Configuration {
   public:
    Configuration(
        const int argc,
        const char* const argv[])
        : _init_log(init_log()),
          _file_list(argv + 1, argv + argc),
          _top_folder_path(init_top_folder_path()),
          _log_folder_path(std::filesystem::temp_directory_path()),
          _paths(load_yaml("paths", _top_folder_path / PATHS_FILE_REL)),
          _config(load_yaml("main_config", get_path("main_config"))) {
        auto log_level = param_str({"misc", "level"});
        auto opt_level = magic_enum::enum_cast<boost::log::trivial::severity_level>(log_level);
        if (!opt_level.has_value()) {
            throw std::invalid_argument("Invalid log level string: " + log_level);
        }
        boost::log::core::get()->set_filter(boost::log::trivial::severity >= opt_level.value());
        if (_file_list.empty()) {
            LOG(error) << "No file(s) to transfer provided.";
            throw std::runtime_error("ERROR");
        }
        LOG(debug) << LOG_ITEM("top_folder") << _top_folder_path.string();
        for (const auto& one_file : _file_list) {
            LOG(debug) << LOG_ITEM("file") << one_file;
        }
    }

    ~Configuration() {
        if (_init_log) {
            boost::log::core::get()->remove_all_sinks();
        }
    }

    const std::filesystem::path& log_folder_path() const {
        return _log_folder_path;
    }

    // Dig to the yaml node by list of keys
    // @param keys list of keys to dig to get the value
    YAML::Node param(const std::vector<std::string>& keys) {
        // Need to clone, else it will be modified in loop
        YAML::Node currentNode = YAML::Clone(_config);
        for (const auto& key : keys) {
            const auto next_node = currentNode[key];
            if (next_node.IsDefined()) {
                currentNode = next_node;
            } else {
                throw std::runtime_error("Key not found: " + key);
            }
        }
        return currentNode;
    }

    // Get a string from the configuration file
    // @param keys list of keys to dig to get the value
    // @return string value
    std::string param_str(const std::vector<std::string>& keys) {
        return param(keys).as<std::string>();
    }
    // Get a boolean from the configuration file
    // @param keys list of keys to dig to get the value
    // @return boolean value
    bool param_bool(const std::vector<std::string>& keys, bool default_value = false) {
        return param(keys).as<bool>();
    }

    // get the path of the item in the test environment
    std::filesystem::path get_path(const std::string& name) {
        // LOG(debug) << "get_path" << ": " << name;
        std::filesystem::path item_path = _top_folder_path / _paths[name].as<std::string>();
        if (!std::filesystem::exists(item_path)) {
            LOG(error) << item_path.string() << " not found.\nPlease check: SDK installed in " << _paths["sdk_runtime"].as<std::string>() << ", configuration file: " << _paths["main_config"].as<std::string>();
            throw std::runtime_error("ERROR");
        }
        return item_path;
    }

    // Set source files in the transfer spec at the specified key.
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
                throw std::runtime_error("Key is not a valid object: " + key);
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

    YAML::Node load_yaml(const char* const name, const std::filesystem::path& path) {
        LOG(debug) << std::setw(ITEM_WIDTH) << name << ": " << path.string();
        return YAML::LoadFile(path.string());
    }

    // Initialize the logging system
    bool init_log() {
        boost::log::add_common_attributes();
        boost::log::core::get()->set_filter(boost::log::trivial::severity >= boost::log::trivial::info);
        boost::log::add_console_log(std::clog)->set_formatter(
            boost::log::expressions::stream
            // << boost::log::expressions::format_date_time<boost::posix_time::ptime>("TimeStamp", "%Y-%m-%d %H:%M:%S") << " "        // .%f
            << std::setw(7) << std::left << boost::log::expressions::attr<boost::log::trivial::severity_level>("Severity") << " "  //
            << boost::log::expressions::smessage);
        return true;
    }
    static inline std::filesystem::path init_top_folder_path() {
        const char* dir_top = std::getenv("DIR_TOP");
        if (dir_top == nullptr) {
            throw std::runtime_error("Environment variable DIR_TOP is not set.");
        }

        std::filesystem::path top_path = dir_top;
        if (!std::filesystem::exists(top_path)) {
            throw std::runtime_error("The folder specified by DIR_TOP does not exist: " + top_path.string());
        }

        return top_path;
    }
};
// Get the last line of a file
inline std::string last_file_line(const std::string& filename) {
    // ate: seek to the end of the file
    std::ifstream file(filename, std::ios::binary | std::ios::ate);
    file.seekg(-2, std::ios::cur);
    if (!file.is_open())
        throw std::runtime_error("Unable to open file: " + filename);
    std::string last_line;
    char char_at_pos = 0;
    // read until a newline or beginning of the file
    // we skip the last byte (the newline)
    while (file.tellg() > 1 && char_at_pos != '\n') {
        // Move two bytes back and read one char
        file.seekg(-2, std::ios::cur);
        file.get(char_at_pos);
    }
    std::getline(file, last_line);
    file.close();
    return last_line;
}

inline std::string base64_encode(const std::string& clear_string) {
    std::string encoded_string;
    encoded_string.resize(base64::encoded_size(clear_string.size()));
    base64::encode(encoded_string.data(), clear_string.data(), clear_string.size());
    return encoded_string;
}

inline std::string uuid_random() {
    return boost::uuids::to_string(boost::uuids::random_generator()());
}
}  // namespace utils
