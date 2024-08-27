#pragma once

#include <grpcpp/create_channel.h>
#include <yaml-cpp/yaml.h>

#include <boost/json.hpp>
#include <boost/log/core.hpp>
#include <boost/log/expressions.hpp>
#include <boost/log/sources/logger.hpp>
#include <boost/log/support/date_time.hpp>
#include <boost/log/trivial.hpp>
#include <boost/log/utility/setup/common_attributes.hpp>
#include <boost/log/utility/setup/console.hpp>
#include <boost/process.hpp>
#include <boost/url/parse.hpp>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <magic_enum.hpp>
#include <thread>

#include "transfer.grpc.pb.h"
namespace json = boost::json;
namespace trsdk = transfersdk;

// define TransferStatus_to_string(value) transfersdk::TransferStatus_Name<transfersdk::TransferStatus>(value)
#define TransferStatus_to_string(value) magic_enum::enum_name(value)

#define LOGGER(logger, level) BOOST_LOG_SEV(logger, boost::log::trivial::level)
#define LOG_ITEM(item) std::setw(ITEM_WIDTH) << item << ": "

namespace utils {
inline constexpr const char* PATHS_FILE_REL = "config/paths.yaml";
inline constexpr const char* TRANSFER_SDK_DAEMON = "asperatransferd";
inline constexpr const char* DAEMON_LOG_FILE = "asperatransferd.log";
inline constexpr const char* ASCP_LOG_FILE = "aspera-scp-transfer.log";
inline constexpr const int ITEM_WIDTH = 12;
inline constexpr const int MAX_CONNECTION_WAIT_SEC = 10;

// Provide a common environment for tests, including:
// - logging
// - conf file generation, startup and shutdown of asperatransferd
// - transfer of files and monitoring
class TestEnvironment {
#define LOG(level) LOGGER(_log, level)
    // get the path of the item in the test environment
    std::filesystem::path get_path(const std::string& name) {
        // LOG(debug) << "get_path" << ": " << name;
        std::filesystem::path item_path = _top_folder / _paths[name].as<std::string>();
        if (!std::filesystem::exists(item_path)) {
            LOG(error) << item_path.string() << " not found.\nPlease check: SDK installed in " << _paths["sdk_root"].as<std::string>() << ", configuration file: " << _paths["main_config"].as<std::string>();
            throw std::runtime_error("ERROR");
        }
        return item_path;
    }

    const bool _init_log;
    const bool _auto_shutdown;
    boost::log::sources::severity_logger<boost::log::trivial::severity_level> _log;
    // list of files to transfer
    std::vector<std::string> _file_list;
    // project folder
    const std::filesystem::path _top_folder;
    // conf file with _paths
    const YAML::Node _paths;
    const YAML::Node _config;
    // folder with SDK binaries
    const std::filesystem::path _arch_folder;
    std::string _server_address;
    std::string _server_port_str;
    std::string _channel_address;
    boost::process::child* _transfer_daemon;
    std::unique_ptr<trsdk::TransferService::Stub> _transfer_service;

    YAML::Node load_yaml(const char* const name, const std::filesystem::path& path) {
        LOG(info) << std::setw(ITEM_WIDTH) << name << ": " << path.string();
        return YAML::LoadFile(path.string());
    }

    bool init_log() {
        boost::log::add_common_attributes();
        boost::log::core::get()->set_filter(boost::log::trivial::severity >= boost::log::trivial::debug);
        boost::log::add_console_log(std::clog)->set_formatter(
            boost::log::expressions::stream
            // << boost::log::expressions::format_date_time<boost::posix_time::ptime>("TimeStamp", "%Y-%m-%d %H:%M:%S") << " "        // .%f
            << std::setw(7) << std::left << boost::log::expressions::attr<boost::log::trivial::severity_level>("Severity") << " "  //
            << boost::log::expressions::smessage);
        return true;
    }
    static std::string last_daemon_log_line(const std::string& filename) {
        std::ifstream file(filename, std::ios::binary | std::ios::ate);
        if (!file.is_open())
            throw std::runtime_error("Unable to open file");
        std::string lastLine;
        if (file.tellg() >= 2) {
            // Move to the character before the last newline
            file.seekg(-2, std::ios::end);
            while (file.tellg() > 0) {
                char ch;
                file.get(ch);
                if (ch == '\n') {
                    std::getline(file, lastLine);
                    break;
                }
                file.seekg(-2, std::ios::cur);  // Move one byte back
            }
        }
        file.close();
        return lastLine;
    }

   public:
    TestEnvironment(
        int argc,
        char* argv[],
        bool shutdown = true)
        : _init_log(init_log()),
          _auto_shutdown(shutdown),
          _log(),
          _file_list(argv + 1, argv + argc),
          _top_folder(std::filesystem::absolute(argv[0]).parent_path().parent_path().parent_path()),
          _paths(load_yaml("paths", _top_folder / PATHS_FILE_REL)),
          _config(load_yaml("main_config", get_path("main_config"))),
          _arch_folder(get_path("sdk_root") / conf_str({"misc", "platform"})),
          _transfer_daemon(nullptr),
          _transfer_service(nullptr) {
        const std::string sdk_url = conf_str({"trsdk", "url"});
        LOG(info) << LOG_ITEM("sdk_url") << sdk_url;
        const auto sdk_uri = boost::urls::parse_uri(sdk_url).value();
        _server_address = sdk_uri.host();
        _server_port_str = sdk_uri.port();
        _channel_address = _server_address + ":" + _server_port_str;
        LOG(info) << LOG_ITEM("channel addr") << _channel_address;
        if (_file_list.empty()) {
            LOG(error) << "No file(s) to transfer provided.";
            throw std::runtime_error("ERROR");
        }
        LOG(info) << LOG_ITEM("top_folder") << _top_folder.string();
        LOG(info) << LOG_ITEM("arch_folder") << _arch_folder.string();
        for (const auto& one_file : _file_list) {
            LOG(info) << LOG_ITEM("file") << one_file;
        }
    }

    ~TestEnvironment() {
        if (_auto_shutdown) {
            shutdown();
        }
    }

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

    auto& log() {
        return _log;
    }

    // Start the transfer SDK daemon
    void start_daemon() {
        const std::filesystem::path log_folder(std::filesystem::temp_directory_path());
        // Prepare daemon configuration file
        const json::object config_info = json::object{
            {"address", _server_address},
            {"port", std::stoi(_server_port_str)},
            {"log_directory", log_folder.string()},
            {"log_level", "debug"},
            {"fasp_runtime", json::object{
                                 {"use_embedded", false},
                                 {"user_defined", json::object{
                                                      {"bin", _arch_folder.string()},
                                                      {"etc", get_path("trsdk_noarch").string()}}},
                                 {"log", json::object{//
                                                      {"dir", log_folder.string()},
                                                      {"level", 2}}}}}};
        const std::string config_data = json::serialize(config_info);
        const std::string file_base = log_folder / TRANSFER_SDK_DAEMON;
        const std::string conf_file = file_base + ".conf";
        const std::string out_file = file_base + ".out";
        const std::string err_file = file_base + ".err";
        const std::string daemon_path = _arch_folder / TRANSFER_SDK_DAEMON;
        const std::string daemon_log = log_folder / DAEMON_LOG_FILE;
        const std::string command = daemon_path + " --config " + conf_file;
        LOG(info) << LOG_ITEM("daemon out") << out_file;
        LOG(info) << LOG_ITEM("daemon err") << err_file;
        LOG(info) << LOG_ITEM("daemon log") << daemon_log;
        LOG(info) << LOG_ITEM("ascp log") << (log_folder / ASCP_LOG_FILE).string();
        LOG(info) << LOG_ITEM("command") << command;
        LOG(info) << config_data;
        LOG(info) << "Starting daemon...";
        std::ofstream conf_stream(conf_file);
        conf_stream << config_data;
        conf_stream.close();
        // Start daemon
        _transfer_daemon = new boost::process::child(
            command,
            boost::process::std_out > out_file,
            boost::process::std_err > err_file);
        std::this_thread::sleep_for(std::chrono::seconds(2));
        if (!_transfer_daemon->running()) {
            _transfer_daemon->wait();
            LOG(error) << "Daemon not started.";
            LOG(error) << "Exited with code: " << _transfer_daemon->exit_code();
            LOG(error) << "Check daemon log: " << daemon_log;
            LOG(error) << last_daemon_log_line(daemon_log);
            throw std::runtime_error("daemon startup failed");
        }
        LOG(info) << "Daemon started: " << _transfer_daemon->id();
    }
    void connect_to_daemon() {
        const auto channel = grpc::CreateChannel(_channel_address, grpc::InsecureChannelCredentials());
        _transfer_service = trsdk::TransferService::NewStub(channel);
        grpc_connectivity_state state;
        for (int i = 0; i < MAX_CONNECTION_WAIT_SEC; i++) {
            state = channel->GetState(true);
            LOG(info) << "channel: " << magic_enum::enum_name(state);
            if (state == GRPC_CHANNEL_READY) {
                break;
            }
            std::this_thread::sleep_for(std::chrono::seconds(1));
        }
        if (state != GRPC_CHANNEL_READY) {
            LOG(error) << "Failed to connect: " << state;
            shutdown();
            throw std::runtime_error("failed to connect.");
        }
        LOG(info) << "Connected !";
    }

    inline void
    start_transfer_and_wait(const json::object& transfer_spec) {
        const std::string ts_json = json::serialize(transfer_spec);
        LOG(info) << LOG_ITEM("ts") << ts_json;
        if (_transfer_service == nullptr) {
            start_daemon();
            connect_to_daemon();
        }

        // create a transfer request
        auto* transfer_config = new trsdk::TransferConfig;
        transfer_config->set_loglevel(2);  // levels: 0 1 2
        trsdk::TransferRequest transfer_request;
        transfer_request.set_transfertype(trsdk::TransferType::FILE_REGULAR);
        transfer_request.set_allocated_config(transfer_config);
        transfer_request.set_transferspec(ts_json);

        // send start transfer request to the transfer daemon
        grpc::ClientContext start_transfer_context;
        transfersdk::StartTransferResponse startTransferResponse;
        _transfer_service->StartTransfer(&start_transfer_context, transfer_request, &startTransferResponse);
        throw_on_error(startTransferResponse.status(), startTransferResponse.error());
        const std::string transfer_id = startTransferResponse.transferid();
        LOG(info) << "transfer id: " << transfer_id << ", status: " << TransferStatus_to_string(startTransferResponse.status());
        // wait until finished, check every second
        while (true) {
            std::this_thread::sleep_for(std::chrono::seconds(1));
            trsdk::TransferInfoRequest transfer_info_request;
            transfer_info_request.set_transferid(transfer_id);
            grpc::ClientContext query_transfer_context;
            trsdk::QueryTransferResponse query_transfer_response;
            _transfer_service->QueryTransfer(&query_transfer_context, transfer_info_request, &query_transfer_response);
            throw_on_error(query_transfer_response.status(), query_transfer_response.error());
            trsdk::TransferStatus status = query_transfer_response.status();
            LOG(info) << "transfer status: " << TransferStatus_to_string(status);
            if (status == trsdk::TransferStatus::COMPLETED)
                break;
        }
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

    // Shutdown daemon
    void shutdown() {
        if (_transfer_service != nullptr) {
            _transfer_service = nullptr;
        }
        if (_transfer_daemon != nullptr) {
            LOG(info) << "Shutting down daemon...";
            _transfer_daemon->terminate();
            _transfer_daemon->wait();
            delete _transfer_daemon;
            _transfer_daemon = nullptr;
        }
    }

    static inline void throw_on_error(const trsdk::TransferStatus& status, const trsdk::Error& error) {
        if (status == trsdk::TransferStatus::FAILED) {
            throw std::runtime_error("transfer failed: " + error.description());
        }
        if (status == trsdk::TransferStatus::UNKNOWN_STATUS) {
            throw std::runtime_error("unknown transfer id: " + error.description());
        }
    }
#undef LOG
};
}  // namespace utils
