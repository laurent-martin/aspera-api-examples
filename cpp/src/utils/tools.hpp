#pragma once

#include <yaml-cpp/yaml.h>

#include <boost/json.hpp>
#include <boost/log/core.hpp>
#include <boost/log/expressions.hpp>
#include <boost/log/sources/logger.hpp>
#include <boost/log/support/date_time.hpp>
#include <boost/log/trivial.hpp>
#include <boost/log/utility/setup/common_attributes.hpp>
#include <boost/log/utility/setup/console.hpp>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <magic_enum.hpp>

namespace json = boost::json;

#define LOGGER(logger, level) BOOST_LOG_SEV(logger, boost::log::trivial::level)
#define LOG_ITEM(item) std::setw(utils::ITEM_WIDTH) << item << ": "

namespace utils {
inline constexpr const char* PATHS_FILE_REL = "config/paths.yaml";
inline constexpr const int ITEM_WIDTH = 12;

// Provide a common environment for tests, including:
// - logging
// - misc utilities
class Tools {
#define LOG(level) LOGGER(_log, level)
   public:
    Tools(
        const int argc,
        const char* const argv[])
        : _log(),
          _init_log(init_log()),
          _file_list(argv + 1, argv + argc),
          _top_folder_path(std::filesystem::absolute(argv[0]).parent_path().parent_path().parent_path()),
          _log_folder_path(std::filesystem::temp_directory_path()),
          _paths(load_yaml("paths", _top_folder_path / PATHS_FILE_REL)),
          _config(load_yaml("main_config", get_path("main_config"))),
          _arch_folder_path(get_path("sdk_root") / conf_str({"misc", "platform"})) {
        auto log_level = conf_str({"misc", "level"});
        auto opt_level = magic_enum::enum_cast<boost::log::trivial::severity_level>(log_level);
        if (!opt_level.has_value()) {
            throw std::invalid_argument("Invalid log level string: " + log_level);
        }
        boost::log::core::get()->set_filter(boost::log::trivial::severity >= opt_level.value());
        if (_file_list.empty()) {
            LOG(error) << "No file(s) to transfer provided.";
            throw std::runtime_error("ERROR");
        }
        LOG(info) << LOG_ITEM("top_folder") << _top_folder_path.string();
        LOG(info) << LOG_ITEM("arch_folder") << _arch_folder_path.string();
        for (const auto& one_file : _file_list) {
            LOG(info) << LOG_ITEM("file") << one_file;
        }
    }

    ~Tools() {
        if (_init_log) {
            boost::log::core::get()->remove_all_sinks();
        }
    }

    const std::filesystem::path& log_folder_path() const {
        return _log_folder_path;
    }

    const std::filesystem::path& arch_folder_path() const {
        return _arch_folder_path;
    }

    // Dig to the yaml node by list of keys
    // @param keys list of keys to dig to get the value
    YAML::Node conf(const std::vector<std::string>& keys) {
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
    std::string conf_str(const std::vector<std::string>& keys) {
        return conf(keys).as<std::string>();
    }

    // get the path of the item in the test environment
    std::filesystem::path get_path(const std::string& name) {
        // LOG(debug) << "get_path" << ": " << name;
        std::filesystem::path item_path = _top_folder_path / _paths[name].as<std::string>();
        if (!std::filesystem::exists(item_path)) {
            LOG(error) << item_path.string() << " not found.\nPlease check: SDK installed in " << _paths["sdk_root"].as<std::string>() << ", configuration file: " << _paths["main_config"].as<std::string>();
            throw std::runtime_error("ERROR");
        }
        return item_path;
    }

    // @return the logger
    auto& log() {
        return _log;
    }

    // Get the last line of a file
    static std::string last_file_line(const std::string& filename) {
        // ate: seek to the end of the file
        std::ifstream file(filename, std::ios::binary | std::ios::ate);
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
        file.seekg(-1, std::ios::cur);
        std::getline(file, last_line);
        file.close();
        return last_line;
    }

    // Add files to the transfer spec
    void add_files_to_ts(json::array& paths, bool add_destination = false) {
        paths.clear();
        for (const auto& one_file : _file_list) {
            json::object one = json::object{{"source", one_file}};
            if (add_destination) {
                one["destination"] = std::string(std::filesystem::path(one_file).filename());
            }
            paths.push_back(one);
        }
    }

   private:
    boost::log::sources::severity_logger<boost::log::trivial::severity_level> _log;
    const bool _init_log;
    // list of files to transfer
    std::vector<std::string> _file_list;
    // project folder
    const std::filesystem::path _top_folder_path;
    const std::filesystem::path _log_folder_path;
    // conf file with _paths
    const YAML::Node _paths;
    const YAML::Node _config;
    // folder with SDK binaries
    const std::filesystem::path _arch_folder_path;

    YAML::Node load_yaml(const char* const name, const std::filesystem::path& path) {
        LOG(info) << std::setw(ITEM_WIDTH) << name << ": " << path.string();
        return YAML::LoadFile(path.string());
    }

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

#undef LOG
};
}  // namespace utils
