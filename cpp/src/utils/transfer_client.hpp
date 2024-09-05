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

#include "tools.hpp"
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
#define LOG(level) LOGGER(_tools.log(), level)
    Tools& _tools;
    const bool _auto_shutdown;
    const std::string _daemon_log;
    std::string _server_address;
    uint16_t _server_port;
    std::string _channel_address;
    std::unique_ptr<boost::process::child> _transfer_daemon_process;
    std::unique_ptr<trsdk::TransferService::Stub> _transfer_service;

   public:
    TransferClient(
        Tools& tools,
        bool shutdown = true)
        : _tools(tools),
          _auto_shutdown(shutdown),
          _daemon_log(_tools.log_folder_path() / DAEMON_LOG_FILE),
          _transfer_daemon_process(nullptr),
          _transfer_service(nullptr) {
        auto sdk_url = _tools.conf_str({"trsdk", "url"});
        auto result = boost::urls::parse_uri(sdk_url);
        if (!result) {
            throw std::runtime_error("Invalid trsdk url");
        }
        LOG(info) << LOG_ITEM("grpc url") << result.value();
        _server_address = result.value().host();
        _server_port = std::stoi(result.value().port());
        _channel_address = _server_address + ":" + std::to_string(_server_port);
        LOG(info) << LOG_ITEM("channel addr") << _channel_address;
    }

    ~TransferClient() {
        if (_auto_shutdown) {
            shutdown();
        }
    }

    void create_config_file(const std::string& conf_file) {
        // Prepare daemon configuration file
        const json::object config_info = {
            {"address", _server_address},
            {"port", _server_port},
            {"log_directory", _tools.log_folder_path().string()},
            {"log_level", "4"},  // 0 .. 4
            {"fasp_runtime",
             {{"use_embedded", false},
              {"user_defined",
               {{"bin", _tools.arch_folder_path().string()},
                {"etc", _tools.get_path("trsdk_noarch").string()}}},
              {"log",
               {{"dir", _tools.log_folder_path().string()},
                {"level", 2}}}}}};
        const std::string config_data = json::serialize(config_info);
        LOG(info) << LOG_ITEM("config") << config_data;
        std::ofstream conf_stream(conf_file);
        conf_stream << config_data;
        conf_stream.close();
    }

    // Start the transfer SDK daemon process
    void start_daemon() {
        const std::string file_base = _tools.log_folder_path() / TRANSFER_SDK_DAEMON;
        const std::string conf_file = file_base + ".conf";
        const std::string out_file = file_base + ".out";
        const std::string err_file = file_base + ".err";
        const std::string command = std::string(_tools.arch_folder_path() / TRANSFER_SDK_DAEMON) + " --config " + conf_file;
        LOG(info) << LOG_ITEM("daemon out") << out_file;
        LOG(info) << LOG_ITEM("daemon err") << err_file;
        LOG(info) << LOG_ITEM("daemon log") << _daemon_log;
        LOG(info) << LOG_ITEM("ascp log") << (_tools.log_folder_path() / ASCP_LOG_FILE).string();
        LOG(info) << LOG_ITEM("command") << command;
        create_config_file(conf_file);
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
            LOG(error) << Tools::last_file_line(_daemon_log);
            throw std::runtime_error("daemon startup failed");
        }
        LOG(info) << "Daemon started: " << _transfer_daemon_process->id();
    }
    void connect_to_daemon() {
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
            shutdown();
            throw std::runtime_error("failed to connect.");
        }
        LOG(info) << "Connected !";
    }

    void startup() {
        if (_transfer_service == nullptr) {
            start_daemon();
            connect_to_daemon();
        }
    }

    // Shutdown daemon
    void shutdown() {
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

    std::string start_transfer(const json::object& transfer_spec) {
        const std::string ts_json = json::serialize(transfer_spec);
        LOG(info) << LOG_ITEM("ts") << ts_json;
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
        throw_on_error(start_transfer_response.status(), start_transfer_response.error());
        const std::string transfer_id = start_transfer_response.transferid();
        LOG(info) << "transfer id: " << transfer_id << ", status: " << TransferStatus_to_string(start_transfer_response.status());
        return transfer_id;
    }

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
            throw_on_error(status, query_transfer_response.error());
            if (status == trsdk::TransferStatus::COMPLETED)
                break;
        }
    }

    void start_transfer_and_wait(const json::object& transfer_spec) {
        // ensure daemon is started and we are connected
        startup();
        wait_transfer(start_transfer(transfer_spec));
    }

    void throw_on_error(const trsdk::TransferStatus& status, const trsdk::Error& error) {
        if (status == trsdk::TransferStatus::FAILED) {
            LOG(error) << Tools::last_file_line(_daemon_log);
            throw std::runtime_error("transfer failed: " + error.description());
        }
        if (status == trsdk::TransferStatus::UNKNOWN_STATUS) {
            throw std::runtime_error("unknown transfer id: " + error.description());
        }
    }
#undef LOG
};
}  // namespace utils
