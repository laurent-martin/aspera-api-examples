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
#include <thread>

#include "transfer.grpc.pb.h"

namespace json = boost::json;
namespace trsdk = transfersdk;

#define TransferStatus_to_string(value) transfersdk::TransferStatus_Name<transfersdk::TransferStatus>(value)

#define LOGGER(logger, level) BOOST_LOG_SEV(logger, boost::log::trivial::level)

namespace utils {
inline constexpr const char* PATHS_FILE_REL = "config/paths.yaml";
inline constexpr const char* TRANSFER_SDK_DAEMON = "asperatransferd";
inline constexpr const char* DAEMON_LOG_FILE = "asperatransferd.log";
inline constexpr const char* ASCP_LOG_FILE = "aspera-scp-transfer.log";
// Provide a common environment for tests, including:
// - conf file generation
// - startup and shutdown of asperatransferd
// - transfer of files
// - logging
class TestEnvironment {
#define LOG(level) LOGGER(_log, level)
    // get the path of the item in the test environment
    std::filesystem::path get_path(const std::string& name) {
        LOG(debug) << "get_path: " << name;
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
    boost::process::child* _transfer_daemon;
    std::unique_ptr<trsdk::TransferService::Stub> _transfer_service;

    YAML::Node load_yaml(const char* const name, const std::filesystem::path& path) {
        LOG(info) << name << "=" << path.string();
        return YAML::LoadFile(path.string());
    }

    bool init_log() {
        boost::log::add_common_attributes();
        boost::log::core::get()->set_filter(boost::log::trivial::severity >= boost::log::trivial::debug);
        auto fmtTimeStamp = boost::log::expressions::format_date_time<boost::posix_time::ptime>("TimeStamp", "%Y-%m-%d %H:%M:%S.%f");
        auto fmtSeverity = boost::log::expressions::attr<boost::log::trivial::severity_level>("Severity");
        boost::log::formatter logFmt = boost::log::expressions::format("[%1%] (%2%) %3%") % fmtTimeStamp % fmtSeverity % boost::log::expressions::smessage;
        auto consoleSink = boost::log::add_console_log(std::clog);
        consoleSink->set_formatter(logFmt);
        return true;
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
        if (_file_list.empty()) {
            LOG(error) << "No file(s) to transfer provided.";
            throw std::runtime_error("ERROR");
        }
        LOG(info) << "top_folder=" << _top_folder.string();
        LOG(info) << "arch_folder=" << _arch_folder.string();
        for (const auto& one_file : _file_list) {
            LOG(info) << "file: " << one_file;
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
        const std::string sdk_url = conf_str({"trsdk", "url"});
        LOG(info) << "sdk_url=" << sdk_url;
        const auto sdk_uri = boost::urls::parse_uri(sdk_url).value();
        const std::string server_port_str = sdk_uri.port();
        const std::string server_address = sdk_uri.host();
        const std::string channel_address = server_address + ":" + server_port_str;
        LOG(info) << "channel_address=" << channel_address;
        // create a connection to the daemon
        const auto channel = grpc::CreateChannel(channel_address, grpc::InsecureChannelCredentials());
        _transfer_service = trsdk::TransferService::NewStub(channel);
        std::this_thread::sleep_for(std::chrono::seconds(5));
        const std::filesystem::path log_folder(std::filesystem::temp_directory_path());
        // wait for connection, or start the daemon
        for (int i = 0; i < 2; ++i) {
            LOG(info) << "Connecting to " << channel_address << " using gRPC";
            grpc_connectivity_state state = channel->GetState(true);
            if (state == GRPC_CHANNEL_READY) {
                LOG(info) << "Connected !";
                return;
            }
            LOG(error) << "Failed to connect";
            // Prepare daemon configuration file
            json::object config_info = json::object{
                {"address", server_address},
                {"port", std::stoi(server_port_str)},
                {"log_directory", log_folder.string()},
                {"log_level", "debug"},
                {"fasp_runtime", json::object{
                                     {"use_embedded", false},
                                     {"user_defined", json::object{
                                                          {"bin", _arch_folder.string()},
                                                          {"etc", get_path("trsdk_noarch").string()}}}}},
                {"log", json::object{{"dir", log_folder.string()}, {"level", 2}}}};
            LOG(info) << json::serialize(config_info);
            auto conf_file = log_folder / "daemon.conf";
            auto daemon_path = _arch_folder / TRANSFER_SDK_DAEMON;
            std::ofstream conf_stream(conf_file.string());
            conf_stream << json::serialize(config_info);
            conf_stream.close();
            // Start daemon
            std::string command = daemon_path.string() + " --config " + conf_file.string();
            std::string out_file = log_folder / "daemon.out";
            std::string err_file = log_folder / "daemon.err";
            LOG(info) << "stderr: " << err_file;
            LOG(info) << "stdout: " << out_file;
            LOG(info) << "sdk log: " << log_folder / DAEMON_LOG_FILE;
            LOG(info) << "xfer log: " << log_folder / ASCP_LOG_FILE;
            LOG(info) << "Starting: " << command;
            _transfer_daemon = new boost::process::child(
                command,
                boost::process::std_out > out_file,
                boost::process::std_err > err_file);
            // Wait for the daemon to start
            std::this_thread::sleep_for(std::chrono::seconds(10));
        }
        LOG(error) << "Check the logs: daemon.err and daemon.out (see paths above).";
        throw std::runtime_error("daemon not started or cannot be started.");
    }

    inline void
    start_transfer_and_wait(const json::object& transfer_spec) {
        const std::string ts_json = json::serialize(transfer_spec);
        LOG(info) << "ts=" << ts_json;
        if (_transfer_service == nullptr) {
            start_daemon();
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
