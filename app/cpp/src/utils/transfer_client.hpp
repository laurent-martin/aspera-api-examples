#pragma once

#include <grpcpp/create_channel.h>

#include <boost/algorithm/string/trim.hpp>
#include <boost/asio/io_context.hpp>
#include <boost/filesystem.hpp>
#include <boost/json.hpp>
#include <algorithm>
#include <boost/process.hpp>
#include <boost/url/parse.hpp>
#include <cctype>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <magic_enum.hpp>
#include <sstream>
#include <thread>
#include <vector>

#include "configuration.hpp"
#include "transferd.grpc.pb.h"
namespace json = boost::json;
namespace trapi = transferd::api;
namespace bp2 = boost::process;

// define TransferStatus_to_string(value) trapi::TransferStatus_Name<trapi::TransferStatus>(value)
#define TransferStatus_to_string(value) magic_enum::enum_name(value)

namespace utils {
inline constexpr const char* ASCP_LOG_FILE = "aspera-scp-transfer.log";
inline constexpr const int MAX_CONNECTION_WAIT_SEC = 10;
// default port of transferd if not specified in URL
inline constexpr const uint16_t TRANSFERD_DEFAULT_PORT = 55002;
// max wait time for the daemon to write its port file
inline constexpr const std::chrono::seconds STARTUP_TIMEOUT{10};
// max wait time for the daemon to stop gracefully
inline constexpr const std::chrono::seconds SHUTDOWN_TIMEOUT{10};
// extension of the port file, written in `runtime_dir` with port 0: `transferd.<port>.optport`
inline constexpr const char* PORT_FILE_EXTENSION = ".optport";

/// @brief Client of the Aspera Transfer Daemon (transferd): start the daemon, start transfers and wait for their end.
class TransferClient {
   private:
    Configuration& _config;
    std::string _server_address;
    uint16_t _server_port;
    boost::asio::io_context _daemon_ioc;
    std::unique_ptr<bp2::process> _transfer_daemon_process;
    std::unique_ptr<trapi::TransferService::Stub> _transfer_service;
    const std::string _daemon_name;
    // folder of the configuration, output and logs of the daemon: a new one for each start
    std::filesystem::path _daemon_folder;
    std::string _daemon_log;
    // `runtime_dir` of the daemon, where it writes its port file: only with port 0
    std::filesystem::path _runtime_dir;

   public:
    /// @brief Create a transfer client.
    /// @param config configuration of the samples
    TransferClient(Configuration& config)
        : _config(config),
          _transfer_daemon_process(nullptr),
          _transfer_service(nullptr),
          _daemon_name(std::filesystem::path(_config.get_path("sdk_daemon")).filename().string()) {
        auto sdk_url = _config.param_str({"trsdk", "url"});
        auto sdk_uri = boost::urls::parse_uri(sdk_url);
        if (!sdk_uri) {
            throw std::runtime_error("Invalid URL: " + sdk_url);
        }
        _server_address = sdk_uri.value().host();
        _server_port = sdk_uri.value().has_port() ? std::stoi(sdk_uri.value().port()) : TRANSFERD_DEFAULT_PORT;
    }

    /// @brief Stop the daemon, if it was started: send SIGINT, and kill it if it does not stop in time.
    ~TransferClient() {
        daemon_shutdown();
    }

    /// @brief Start the daemon, with its configuration, output and logs in a new folder of the log folder.
    void daemon_start() {
        // samples run at the same time do not share files
        _daemon_folder = _config.log_folder_path() / (_daemon_name + "." + uuid_random());
        create_private_folder(_daemon_folder);
        const std::string file_base = _daemon_folder / _daemon_name;
        const std::string conf_file = file_base + ".conf";
        const std::string out_file = file_base + ".out";
        const std::string err_file = file_base + ".err";
        _daemon_log = file_base + ".log";
        if (_server_port == 0) {
            // the daemon writes its port file in this folder: of this daemon only, readable only by the user
            _runtime_dir = _daemon_folder / "run";
            create_private_folder(_runtime_dir);
        }
        log_dump("Daemon command", _config.get_path("sdk_daemon").string() + " --config " + conf_file);
        log_dump("Daemon out", out_file);
        log_dump("Daemon err", err_file);
        log_dump("Daemon log", _daemon_log);
        log_dump("Ascp log", (_daemon_folder / ASCP_LOG_FILE).string());
        daemon_create_config_file(conf_file);
        LOGGER(info) << "Starting daemon";

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

        wait_daemon_listening();
    }

    /// @brief Wait for the daemon to listen, and get the port if dynamically allocated (port 0).
    /// With port 0, the daemon writes its port in a file of its `runtime_dir` once it listens.
    /// This requires transferd 1.1.7 or later.
    void wait_daemon_listening() {
        const auto deadline = std::chrono::steady_clock::now() + STARTUP_TIMEOUT;
        while (true) {
            // check if the daemon has already exited
            // Note: kill(pid, 0) cannot be used: it also succeeds on a zombie (exited, not yet reaped) process
            boost::system::error_code ec;
            if (!_transfer_daemon_process->running(ec)) {
                throw std::runtime_error("Daemon exited with code " + std::to_string(_transfer_daemon_process->exit_code()) + ", see log: " + _daemon_log);
            }
            // fixed port: readiness is checked on connection
            if (_server_port != 0) {
                return;
            }
            const int port = read_port_file(_runtime_dir);
            if (port != 0) {
                _server_port = port;
                return;
            }
            if (std::chrono::steady_clock::now() > deadline) {
                throw std::runtime_error("Port file not found in " + _runtime_dir.string() + ": transferd 1.1.7 or later is required");
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(200));
        }
    }

    /// @brief Connect to the daemon.
    void daemon_connect() {
        const std::string address = _server_address + ":" + std::to_string(_server_port);
        const auto channel = grpc::CreateChannel(address, grpc::InsecureChannelCredentials());
        // wait until the daemon listens
        if (!channel->WaitForConnected(std::chrono::system_clock::now() + std::chrono::seconds(MAX_CONNECTION_WAIT_SEC))) {
            daemon_shutdown();
            throw std::runtime_error("Failed to connect to daemon: " + address);
        }
        _transfer_service = trapi::TransferService::NewStub(channel);
        LOGGER(info) << "Connected to daemon: " << address;
    }

    /// @brief Start the daemon and connect to it, if not already done.
    void daemon_startup() {
        if (_transfer_service == nullptr) {
            daemon_start();
            daemon_connect();
        }
    }

    /// @brief Stop the daemon, if it was started: send SIGINT, and kill it if it does not stop in time.
    /// Then delete its `runtime_dir`: a killed daemon does not delete its port file.
    /// transferd stops cleanly on SIGINT (not on SIGTERM).
    void daemon_shutdown() {
        if (_transfer_service != nullptr) {
            _transfer_service = nullptr;
        }
        if (_transfer_daemon_process != nullptr) {
            LOGGER(info) << "Stopping daemon";
            boost::system::error_code ec;
            // transferd stops cleanly on SIGINT (not on SIGTERM), kill it if it does not stop in time
            _transfer_daemon_process->interrupt(ec);
            const auto deadline = std::chrono::steady_clock::now() + SHUTDOWN_TIMEOUT;
            while (_transfer_daemon_process->running(ec) && std::chrono::steady_clock::now() < deadline) {
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
            }
            if (_transfer_daemon_process->running(ec)) {
                LOGGER(warning) << "Daemon did not stop, killing it";
                _transfer_daemon_process->terminate(ec);
            }
            _transfer_daemon_process->wait(ec);
            _transfer_daemon_process = nullptr;
        }
        if (!_runtime_dir.empty()) {
            std::error_code remove_error;
            std::filesystem::remove_all(_runtime_dir, remove_error);
            _runtime_dir.clear();
        }
    }

    /// @brief Start the daemon if needed, start a transfer, and wait for its end.
    /// @param transfer_spec transfer spec
    void transfer_start_and_wait(const json::object& transfer_spec) {
        // ensure daemon is started and we are connected
        daemon_startup();
        const std::string ts_json = json::serialize(transfer_spec);
        log_dump("Transfer spec", ts_json);
        // create a transfer request
        auto* transfer_config = new trapi::TransferConfig;
        trapi::TransferRequest transfer_request;
        transfer_request.set_transfertype(trapi::TransferType::FILE_REGULAR);
        transfer_request.set_allocated_config(transfer_config);
        transfer_request.set_transferspec(ts_json);
        // start the transfer: the daemon sends an event on each change, until the end of the transfer
        grpc::ClientContext monitor_context;
        const auto events = _transfer_service->StartTransferWithMonitor(&monitor_context, transfer_request);
        trapi::TransferResponse event;
        while (events->Read(&event)) {
            const trapi::TransferStatus status = event.status();
            log_status(status, event.transferinfo().averageratekbps());
            try {
                // `error` is empty on session errors: the cause is in session or transfer information
                transfer_check_failed_status(
                    status,
                    error_description({event.error().description(), event.sessioninfo().errordesc(), event.transferinfo().errordescription()}));
            } catch (const std::exception&) {
                // stop monitoring, if the stream is still open
                monitor_context.TryCancel();
                throw;
            }
            if (status == trapi::TransferStatus::COMPLETED) {
                // stop monitoring, if the stream is still open
                monitor_context.TryCancel();
                return;
            }
        }
        // the stream ended before the end of the transfer: the cause is in the status of the call
        check_rpc_status("StartTransferWithMonitor", events->Finish());
        throw std::runtime_error("Transfer monitoring ended before transfer completion");
    }

    /// @brief Get the transfer spec from the response of Node API `upload_setup` or `download_setup`, and throw an exception on error.
    /// The Node API may return an error in the response data, or an empty object, instead of an HTTP error.
    /// @param response_data response data, for a single transfer request
    /// @return transfer spec
    static json::object transfer_spec_from_setup(const json::value& response_data) {
        static const json::object empty_object;
        const json::object& data = response_data.is_object() ? response_data.as_object() : empty_object;
        const json::object* result = &empty_object;
        const json::value* transfer_specs = data.if_contains("transfer_specs");
        if (transfer_specs && !transfer_specs->as_array().empty()) {
            result = &transfer_specs->as_array()[0].as_object();
        }
        const json::value* error = data.if_contains("error");
        if (!error) {
            error = result->if_contains("error");
        }
        if (error) {
            throw std::runtime_error("Node API error: " + std::string(error->as_object().at("user_message").as_string()));
        }
        const json::value* transfer_spec = result->if_contains("transfer_spec");
        if (!transfer_spec) {
            throw std::runtime_error("No transfer spec in Node API response");
        }
        return transfer_spec->as_object();
    }

   private:
    /// @brief Read the port of the daemon in its port file `transferd.<port>.optport`, in its `runtime_dir`.
    /// The daemon creates the file, then writes the port: an empty file is not ready yet.
    /// @param runtime_dir `runtime_dir` of the daemon
    /// @return port, or 0 if not written (yet)
    static int read_port_file(const std::filesystem::path& runtime_dir) {
        std::vector<std::filesystem::path> port_files;
        for (const auto& entry : std::filesystem::directory_iterator(runtime_dir)) {
            if (entry.path().extension() == PORT_FILE_EXTENSION) {
                port_files.push_back(entry.path());
            }
        }
        if (port_files.empty()) {
            return 0;
        }
        if (port_files.size() > 1) {
            throw std::runtime_error("Several port files in " + runtime_dir.string());
        }
        std::ifstream port_stream(port_files.front(), std::ios::binary);
        const std::string content((std::istreambuf_iterator<char>(port_stream)), std::istreambuf_iterator<char>());
        if (content.empty()) {
            return 0;
        }
        if (!std::all_of(content.begin(), content.end(), [](const unsigned char c) { return std::isdigit(c); })) {
            throw std::runtime_error("No port in file " + port_files.front().string());
        }
        return std::stoi(content);
    }

    /// @brief Create a folder readable only by the user, where the OS supports it.
    /// @param folder path of the folder
    static void create_private_folder(const std::filesystem::path& folder) {
        std::filesystem::create_directory(folder);
        std::filesystem::permissions(folder, std::filesystem::perms::owner_all);
    }

    /// @brief Convert the log level of ascp from name to number.
    /// @param level `info`, `debug` or `trace`
    /// @return 0, 1 or 2
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

    /// @brief Create the configuration file of the daemon.
    /// See: https://developer.ibm.com/apis/catalog/aspera--aspera-transfer-sdk/Configuration%20File
    /// @param conf_file path of the configuration file
    void daemon_create_config_file(const std::string& conf_file) {
        // Prepare daemon configuration file
        json::object config_info = {
            {"address", _server_address},
            {"port", _server_port},
            {"log_directory", _daemon_folder.string()},
            {"log_level", _config.param_str({"trsdk", "level"})},
            {"fasp_runtime",
             {{"use_embedded", true},
              {"log",
               {{"dir", _daemon_folder.string()},
                {"level", ascp_level(_config.param_str({"trsdk", "ascp_level"}))}}}}}};
        if (!_runtime_dir.empty()) {
            config_info["runtime_dir"] = _runtime_dir.string();
        }
        const std::string config_data = json::serialize(config_info);
        std::ofstream conf_stream(conf_file);
        conf_stream << config_data;
        if (!conf_stream) {
            throw std::ios_base::failure("Failed to open configuration file");
        }
    }

    /// @brief Throw an exception if a call to the daemon API failed, e.g. daemon not reachable.
    /// @param rpc_name name of the API call
    /// @param rpc_status status of the call
    static void check_rpc_status(const std::string& rpc_name, const grpc::Status& rpc_status) {
        if (!rpc_status.ok()) {
            throw std::runtime_error(rpc_name + " call failed: " + rpc_status.error_message());
        }
    }

    /// @brief Get the first non-empty error description.
    /// @param texts error descriptions
    /// @return error description, or `unknown error`
    static std::string error_description(std::initializer_list<std::string> texts) {
        for (std::string text : texts) {
            boost::algorithm::trim(text);
            if (!text.empty()) {
                return text;
            }
        }
        return "unknown error";
    }

    /// @brief Log the transfer status, and the rate when running.
    /// @param status transfer status
    /// @param average_rate_kbps average rate in kilobits per second
    static void log_status(const trapi::TransferStatus status, const int64_t average_rate_kbps) {
        std::ostringstream message;
        message << "Transfer: " << TransferStatus_to_string(status);
        if (status == trapi::TransferStatus::RUNNING) {
            message << " " << std::fixed << std::setprecision(1) << average_rate_kbps / 1000.0 << " Mbps";
        }
        LOGGER(info) << message.str();
    }

    /// @brief Throw an exception if the transfer status is failed, canceled or unknown.
    /// @param status transfer status
    /// @param description error description
    static void transfer_check_failed_status(const trapi::TransferStatus& status, const std::string& description) {
        if (status == trapi::TransferStatus::FAILED || status == trapi::TransferStatus::CANCELED) {
            throw std::runtime_error("Transfer failed: " + description);
        }
        if (status == trapi::TransferStatus::UNKNOWN_STATUS) {
            throw std::runtime_error("Transfer status unknown: " + description);
        }
    }
};
}  // namespace utils
