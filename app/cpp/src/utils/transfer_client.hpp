#pragma once

#include <grpcpp/create_channel.h>
#include <sys/wait.h>

#include <boost/asio/io_context.hpp>
#include <boost/filesystem.hpp>
#include <boost/json.hpp>
#include <boost/process.hpp>
#include <boost/regex.hpp>
#include <boost/url/parse.hpp>
#include <chrono>
#include <fstream>
#include <iostream>
#include <magic_enum.hpp>
#include <thread>

#include "configuration.hpp"
#include "transferd.grpc.pb.h"
namespace json = boost::json;
namespace trapi = transferd::api;
namespace bp2 = boost::process;

// define TransferStatus_to_string(value) trapi::TransferStatus_Name<trapi::TransferStatus>(value)
#define TransferStatus_to_string(value) magic_enum::enum_name(value)
#define grpc_connectivity_state_to_string(value) (magic_enum::enum_name(value).data() + strlen("GRPC_CHANNEL_"))

namespace utils {
inline constexpr const char* ASCP_LOG_FILE = "aspera-scp-transfer.log";
inline constexpr const int MAX_CONNECTION_WAIT_SEC = 10;
// default port of transferd if not specified in URL
inline constexpr const uint16_t TRANSFERD_DEFAULT_PORT = 55002;
// max wait time for the daemon to log its listening port
inline constexpr const std::chrono::seconds STARTUP_TIMEOUT{10};
// API port in daemon log (text or JSON log format), e.g. `API Server: Listening on 127.0.0.1:55002 ...`
inline const boost::regex LISTENING_PORT_REGEX("API Server: Listening on [^\\s\"]+:([0-9]+)");

// Provides the following services:
// - daemon conf file generation, startup and shutdown of transferd
// - transfer of files and monitoring
class TransferClient {
   private:
    Configuration& _config;
    std::string _server_address;
    uint16_t _server_port;
    boost::asio::io_context _daemon_ioc;
    std::unique_ptr<bp2::process> _transfer_daemon_process;
    std::unique_ptr<trapi::TransferService::Stub> _transfer_service;
    const std::string _daemon_name;
    const std::string _daemon_log;

   public:
    TransferClient(Configuration& config)
        : _config(config),
          _transfer_daemon_process(nullptr),
          _transfer_service(nullptr),
          _daemon_name(std::filesystem::path(_config.get_path("sdk_daemon")).filename().string()),
          _daemon_log(_config.log_folder_path() / (_daemon_name + ".log")) {
        auto sdk_url = _config.param_str({"trsdk", "url"});
        auto sdk_uri = boost::urls::parse_uri(sdk_url);
        if (!sdk_uri) {
            throw std::runtime_error("Invalid trapi url");
        }
        LOGGER(debug) << LOG_ITEM("grpc url") << sdk_uri.value();
        _server_address = sdk_uri.value().host();
        _server_port = sdk_uri.value().has_port() ? std::stoi(sdk_uri.value().port()) : TRANSFERD_DEFAULT_PORT;
    }

    ~TransferClient() {
        daemon_shutdown();
    }

    // Start the transfer SDK daemon process
    void daemon_start() {
        const std::string file_base = _config.log_folder_path() / _daemon_name;
        const std::string conf_file = file_base + ".conf";
        const std::string out_file = file_base + ".out";
        const std::string err_file = file_base + ".err";
        LOGGER(debug) << LOG_ITEM("daemon out") << out_file;
        LOGGER(debug) << LOG_ITEM("daemon err") << err_file;
        LOGGER(debug) << LOG_ITEM("daemon log") << _daemon_log;
        LOGGER(debug) << LOG_ITEM("ascp log") << (_config.log_folder_path() / ASCP_LOG_FILE).string();
        LOGGER(debug) << LOG_ITEM("exe") << _config.get_path("sdk_daemon");
        daemon_create_config_file(conf_file);
        // the log file may contain lines of previous executions: only read new lines
        std::error_code size_error;
        const std::uintmax_t log_size = std::filesystem::file_size(_daemon_log, size_error);
        const std::uintmax_t log_offset = size_error ? 0 : log_size;
        LOGGER(info) << "Starting daemon...";

        // Open stdout/stderr redirect files (FILE* is accepted cross-platform by process_stdio)
        FILE* out_fp = std::fopen(out_file.c_str(), "w");
        FILE* err_fp = std::fopen(err_file.c_str(), "w");
        if (!out_fp || !err_fp) {
            throw std::runtime_error("Failed to open daemon output files");
        }
        _transfer_daemon_process.reset(new bp2::process(
            _daemon_ioc,
            boost::filesystem::path(_config.get_path("sdk_daemon")),
            std::vector<std::string>{"--config", conf_file},
            bp2::process_stdio{{}, out_fp, err_fp}));
        std::fclose(out_fp);
        std::fclose(err_fp);

        wait_daemon_listening(log_offset);
        LOGGER(info) << "Daemon started: " << _transfer_daemon_process->id();
    }

    // Wait for the daemon to listen, and get the port if dynamically allocated (port 0).
    // The port is read from the daemon log: requires log level `info` or more verbose.
    void wait_daemon_listening(const std::uintmax_t log_offset) {
        const auto deadline = std::chrono::steady_clock::now() + STARTUP_TIMEOUT;
        while (true) {
            // check if the daemon has already exited.
            // Note: kill(pid, 0) cannot be used: it also succeeds on a zombie (exited, not yet reaped) process
            int wait_status = 0;
            const pid_t wait_result = ::waitpid(_transfer_daemon_process->id(), &wait_status, WNOHANG);
            if (wait_result != 0) {
                LOGGER(error) << "Daemon not started.";
                if (wait_result > 0 && WIFEXITED(wait_status)) {
                    LOGGER(error) << "Exited with code: " << WEXITSTATUS(wait_status);
                }
                LOGGER(error) << "Check daemon log: " << _daemon_log;
                throw std::runtime_error("daemon startup failed");
            }
            // fixed port: readiness is checked on connection
            if (_server_port != 0) {
                return;
            }
            const int port = find_listening_port(_daemon_log, log_offset);
            if (port != 0) {
                _server_port = port;
                LOGGER(info) << "Allocated server port: " << _server_port;
                return;
            }
            if (std::chrono::steady_clock::now() > deadline) {
                throw std::runtime_error("Listening port not found in daemon log: " + _daemon_log);
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(200));
        }
    }

    // Connect to the transfer SDK daemon
    void daemon_connect() {
        const std::string _channel_address = _server_address + ":" + std::to_string(_server_port);
        LOGGER(info) << "Connecting to " << _daemon_name << " on: " << _channel_address << " ...";
        const auto channel = grpc::CreateChannel(_channel_address, grpc::InsecureChannelCredentials());
        // wait until the daemon listens
        if (!channel->WaitForConnected(std::chrono::system_clock::now() + std::chrono::seconds(MAX_CONNECTION_WAIT_SEC))) {
            LOGGER(error) << "Failed to connect: " << grpc_connectivity_state_to_string(channel->GetState(false));
            daemon_shutdown();
            throw std::runtime_error("failed to connect.");
        }
        _transfer_service = trapi::TransferService::NewStub(channel);
        LOGGER(info) << "Connected !";
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
            LOGGER(info) << "Shutting down daemon...";
            boost::system::error_code ec;
            _transfer_daemon_process->terminate(ec);
            _transfer_daemon_process->wait(ec);
            _transfer_daemon_process = nullptr;
        }
    }

    // Start a transfer given a transfer spec
    // @param transfer_spec: a json object with the transfer specification
    // @return transfer_id: the id of the started transfer
    std::string transfer_start(const json::object& transfer_spec) {
        const std::string ts_json = json::serialize(transfer_spec);
        LOGGER(debug) << LOG_ITEM("ts") << ts_json;
        // create a transfer request
        auto* transfer_config = new trapi::TransferConfig;
        transfer_config->set_loglevel(2);  // ascp levels: 0 1 2
        trapi::TransferRequest transfer_request;
        transfer_request.set_transfertype(trapi::TransferType::FILE_REGULAR);
        transfer_request.set_allocated_config(transfer_config);
        transfer_request.set_transferspec(ts_json);
        // send start transfer request to the transfer daemon
        grpc::ClientContext start_transfer_context;
        trapi::StartTransferResponse start_transfer_response;
        check_rpc_status(
            "StartTransfer",
            _transfer_service->StartTransfer(&start_transfer_context, transfer_request, &start_transfer_response));
        transfer_check_failed_status(start_transfer_response.status(), start_transfer_response.error());
        const std::string transfer_id = start_transfer_response.transferid();
        LOGGER(info) << "transfer id: " << transfer_id << ", status: " << TransferStatus_to_string(start_transfer_response.status());
        return transfer_id;
    }

    void wait_transfer(const std::string& transfer_id) {
        // wait until finished, check every second
        while (true) {
            std::this_thread::sleep_for(std::chrono::seconds(1));
            trapi::TransferInfoRequest transfer_info_request;
            transfer_info_request.set_transferid(transfer_id);
            grpc::ClientContext query_transfer_context;
            trapi::QueryTransferResponse query_transfer_response;
            check_rpc_status(
                "QueryTransfer",
                _transfer_service->QueryTransfer(&query_transfer_context, transfer_info_request, &query_transfer_response));
            const trapi::TransferStatus status = query_transfer_response.status();
            LOGGER(info) << "transfer: " << TransferStatus_to_string(status);
            transfer_check_failed_status(status, query_transfer_response.error());
            if (status == trapi::TransferStatus::COMPLETED)
                break;
        }
    }

    void transfer_start_and_wait(const json::object& transfer_spec) {
        // ensure daemon is started and we are connected
        daemon_startup();
        wait_transfer(transfer_start(transfer_spec));
    }

   private:
    // Find the API listening port in the daemon log, after the given offset.
    // Returns 0 if not found (yet).
    static int find_listening_port(const std::string& log_file, std::uintmax_t offset) {
        std::ifstream log_stream(log_file, std::ios::binary);
        if (!log_stream) {
            return 0;
        }
        const std::string content((std::istreambuf_iterator<char>(log_stream)), std::istreambuf_iterator<char>());
        // log file was truncated
        if (content.size() < offset) {
            offset = 0;
        }
        const std::string new_lines = content.substr(offset);
        boost::smatch match;
        if (!boost::regex_search(new_lines, match, LISTENING_PORT_REGEX)) {
            return 0;
        }
        return std::stoi(match[1]);
    }

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
             {{"use_embedded", true},
              {"log",
               {{"dir", _config.log_folder_path().string()},
                {"level", ascp_level(_config.param_str({"trsdk", "ascp_level"}))}}}}}};
        const std::string config_data = json::serialize(config_info);
        LOGGER(debug) << LOG_ITEM("config") << config_data;
        std::ofstream conf_stream(conf_file);
        conf_stream << config_data;
        if (!conf_stream) {
            throw std::ios_base::failure("Failed to open configuration file");
        }
    }

    // Throw if the gRPC call itself failed (e.g. daemon not reachable)
    static void check_rpc_status(const std::string& rpc_name, const grpc::Status& rpc_status) {
        if (!rpc_status.ok()) {
            throw std::runtime_error(rpc_name + " call failed: " + rpc_status.error_message());
        }
    }

    void transfer_check_failed_status(const trapi::TransferStatus& status, const trapi::Error& error) {
        if (status == trapi::TransferStatus::FAILED) {
            LOGGER(error) << last_file_line(_daemon_log);
            throw std::runtime_error("transfer failed: " + error.description());
        }
        if (status == trapi::TransferStatus::UNKNOWN_STATUS) {
            throw std::runtime_error("unknown transfer id: " + error.description());
        }
    }
};
}  // namespace utils
