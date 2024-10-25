#pragma once

#include <grpcpp/create_channel.h>

#include <boost/json.hpp>
#include <boost/process.hpp>
#include <boost/url/parse.hpp>
#include <chrono>
#include <fstream>
#include <iostream>
#include <magic_enum.hpp>
#include <thread>

#include "configuration.hpp"
#include "transfer.grpc.pb.h"
namespace json = boost::json;
namespace trsdk = transfersdk;

// define TransferStatus_to_string(value) transfersdk::TransferStatus_Name<transfersdk::TransferStatus>(value)
#define TransferStatus_to_string(value) magic_enum::enum_name(value)
#define grpc_connectivity_state_to_string(value) (magic_enum::enum_name(value).data() + strlen("GRPC_CHANNEL_"))

namespace utils {
inline constexpr const char* TRANSFER_SDK_DAEMON = "asperatransferd";
inline constexpr const char* DAEMON_LOG_FILE = "asperatransferd.log";
inline constexpr const char* ASCP_LOG_FILE = "aspera-scp-transfer.log";
inline constexpr const int MAX_CONNECTION_WAIT_SEC = 10;

// Provide a common environment for tests, including:
// - conf file generation, startup and shutdown of asperatransferd
// - transfer of files and monitoring
class TransferClient {
   private:
    Configuration& _config;
    std::string _server_address;
    uint16_t _server_port;
    std::unique_ptr<boost::process::child> _transfer_daemon_process;
    std::unique_ptr<trsdk::TransferService::Stub> _transfer_service;
    // folder with SDK binaries
    const std::filesystem::path _sdk_runtime_path;
    const std::string _daemon_log;

   public:
    TransferClient(Configuration& config)
        : _config(config),
          _transfer_daemon_process(nullptr),
          _transfer_service(nullptr),
          _sdk_runtime_path(_config.get_path("sdk_runtime")),
          _daemon_log(_config.log_folder_path() / DAEMON_LOG_FILE) {
        LOG(debug) << LOG_ITEM("sdk_folder") << _sdk_runtime_path.string();
        auto sdk_url = _config.param_str({"trsdk", "url"});
        auto sdk_uri = boost::urls::parse_uri(sdk_url);
        if (!sdk_uri) {
            throw std::runtime_error("Invalid trsdk url");
        }
        LOG(debug) << LOG_ITEM("grpc url") << sdk_uri.value();
        _server_address = sdk_uri.value().host();
        _server_port = std::stoi(sdk_uri.value().port());
    }

    ~TransferClient() {
        daemon_shutdown();
    }
    // Start the transfer SDK daemon process
    void daemon_start() {
        const std::string file_base = _config.log_folder_path() / TRANSFER_SDK_DAEMON;
        const std::string conf_file = file_base + ".conf";
        const std::string out_file = file_base + ".out";
        const std::string err_file = file_base + ".err";
        const std::string command = std::string(_sdk_runtime_path / TRANSFER_SDK_DAEMON) + " --config " + conf_file;
        LOG(debug) << LOG_ITEM("daemon out") << out_file;
        LOG(debug) << LOG_ITEM("daemon err") << err_file;
        LOG(debug) << LOG_ITEM("daemon log") << _daemon_log;
        LOG(debug) << LOG_ITEM("ascp log") << (_config.log_folder_path() / ASCP_LOG_FILE).string();
        LOG(debug) << LOG_ITEM("command") << command;
        daemon_create_config_file(conf_file);
        LOG(info) << "Starting daemon...";
        // Start daemon
        _transfer_daemon_process = std::make_unique<boost::process::child>(boost::process::child(
            command,
            boost::process::std_out > out_file,
            boost::process::std_err > err_file));
        std::this_thread::sleep_for(std::chrono::seconds(2));
        if (!_transfer_daemon_process->running()) {
            _transfer_daemon_process->wait();
            LOG(error) << "Daemon not started.";
            LOG(error) << "Exited with code: " << _transfer_daemon_process->exit_code();
            LOG(error) << "Check daemon log: " << _daemon_log;
            LOG(error) << Configuration::last_file_line(_daemon_log);
            throw std::runtime_error("daemon startup failed");
        }
        LOG(info) << "Daemon started: " << _transfer_daemon_process->id();
    }
    // Connect to the transfer SDK daemon
    void daemon_connect() {
        const std::string _channel_address = _server_address + ":" + std::to_string(_server_port);
        LOG(info) << "Connecting to " << TRANSFER_SDK_DAEMON << " on: " << _channel_address << " ...";
        const auto channel = grpc::CreateChannel(_channel_address, grpc::InsecureChannelCredentials());
        _transfer_service = trsdk::TransferService::NewStub(channel);
        grpc_connectivity_state state;
        for (int i = 0; i < MAX_CONNECTION_WAIT_SEC; i++) {
            state = channel->GetState(true);
            LOG(info) << "channel: " << grpc_connectivity_state_to_string(state);
            if (state == GRPC_CHANNEL_READY) {
                break;
            }
            std::this_thread::sleep_for(std::chrono::seconds(1));
        }
        if (state != GRPC_CHANNEL_READY) {
            LOG(error) << "Failed to connect: " << state;
            daemon_shutdown();
            throw std::runtime_error("failed to connect.");
        }
        LOG(info) << "Connected !";
    }
    // Start daemon and connect to it
    void daemon_startup() {
        if (_transfer_service == nullptr) {
            daemon_start();
            daemon_connect();
        }
    }

    // Shutdown daemon
    void daemon_shutdown() {
        if (_transfer_service != nullptr) {
            _transfer_service = nullptr;
        }
        if (_transfer_daemon_process != nullptr) {
            LOG(info) << "Shutting down daemon...";
            _transfer_daemon_process->terminate();
            _transfer_daemon_process->wait();
            _transfer_daemon_process = nullptr;
        }
    }
    // Start a transfer given a transfer spec
    // @param transfer_spec: a json object with the transfer specification
    // @return transfer_id: the id of the started transfer
    std::string transfer_start(const json::object& transfer_spec) {
        const std::string ts_json = json::serialize(transfer_spec);
        LOG(debug) << LOG_ITEM("ts") << ts_json;
        // create a transfer request
        auto* transfer_config = new trsdk::TransferConfig;
        transfer_config->set_loglevel(2);  // ascp levels: 0 1 2
        trsdk::TransferRequest transfer_request;
        transfer_request.set_transfertype(trsdk::TransferType::FILE_REGULAR);
        transfer_request.set_allocated_config(transfer_config);
        transfer_request.set_transferspec(ts_json);
        // send start transfer request to the transfer daemon
        grpc::ClientContext start_transfer_context;
        transfersdk::StartTransferResponse start_transfer_response;
        _transfer_service->StartTransfer(&start_transfer_context, transfer_request, &start_transfer_response);
        transfer_check_failed_status(start_transfer_response.status(), start_transfer_response.error());
        const std::string transfer_id = start_transfer_response.transferid();
        LOG(info) << "transfer id: " << transfer_id << ", status: " << TransferStatus_to_string(start_transfer_response.status());
        return transfer_id;
    }
    //
    void wait_transfer(const std::string& transfer_id) {
        // wait until finished, check every second
        while (true) {
            std::this_thread::sleep_for(std::chrono::seconds(1));
            trsdk::TransferInfoRequest transfer_info_request;
            transfer_info_request.set_transferid(transfer_id);
            grpc::ClientContext query_transfer_context;
            trsdk::QueryTransferResponse query_transfer_response;
            _transfer_service->QueryTransfer(&query_transfer_context, transfer_info_request, &query_transfer_response);
            const trsdk::TransferStatus status = query_transfer_response.status();
            LOG(info) << "transfer: " << TransferStatus_to_string(status);
            transfer_check_failed_status(status, query_transfer_response.error());
            if (status == trsdk::TransferStatus::COMPLETED)
                break;
        }
    }

    void transfer_start_and_wait(const json::object& transfer_spec) {
        // ensure daemon is started and we are connected
        daemon_startup();
        wait_transfer(transfer_start(transfer_spec));
    }

   private:
    /** Convert log level for ascp from string to int */
    static int ascp_level(const std::string& level) {
        if (level == "info") {
            return 0;
        } else if (level == "debug") {
            return 1;
        } else if (level == "trace") {
            return 2;
        } else {
            throw std::invalid_argument("Invalid ascp_level: " + level);
        }
    }
    void daemon_create_config_file(const std::string& conf_file) {
        // Prepare daemon configuration file
        const json::object config_info = {
            {"address", _server_address},
            {"port", _server_port},
            {"log_directory", _config.log_folder_path().string()},
            {"log_level", _config.param_str({"trsdk", "level"})},
            {"fasp_runtime",
             {{"use_embedded", false},
              {"user_defined",
               {{"bin", _sdk_runtime_path.string()},
                {"etc", _sdk_runtime_path.string()}}},
              {"log",
               {{"dir", _config.log_folder_path().string()},
                {"level", ascp_level(_config.param_str({"trsdk", "ascp_level"}))}}}}}};
        const std::string config_data = json::serialize(config_info);
        LOG(debug) << LOG_ITEM("config") << config_data;
        std::ofstream conf_stream(conf_file);
        conf_stream << config_data;
        if (!conf_stream) {
            throw std::ios_base::failure("Failed to open configuration file");
        }
    }

    void transfer_check_failed_status(const trsdk::TransferStatus& status, const trsdk::Error& error) {
        if (status == trsdk::TransferStatus::FAILED) {
            LOG(error) << Configuration::last_file_line(_daemon_log);
            throw std::runtime_error("transfer failed: " + error.description());
        }
        if (status == trsdk::TransferStatus::UNKNOWN_STATUS) {
            throw std::runtime_error("unknown transfer id: " + error.description());
        }
    }
};
}  // namespace utils
