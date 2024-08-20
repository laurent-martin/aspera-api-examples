#pragma once

#include <grpcpp/create_channel.h>
#include <yaml-cpp/yaml.h>

#include <boost/core/detail/string_view.hpp>
#include <boost/log/attributes/named_scope.hpp>
#include <boost/log/core.hpp>
#include <boost/log/expressions.hpp>
#include <boost/log/sinks/sync_frontend.hpp>
#include <boost/log/sinks/text_file_backend.hpp>
#include <boost/log/sinks/text_ostream_backend.hpp>
#include <boost/log/sources/logger.hpp>
#include <boost/log/support/date_time.hpp>
#include <boost/log/trivial.hpp>
#include <boost/log/utility/setup/common_attributes.hpp>
#include <boost/log/utility/setup/console.hpp>
#include <boost/log/utility/setup/file.hpp>
#include <boost/process.hpp>
#include <boost/url/parse.hpp>
#include <boost/url/url.hpp>
#include <chrono>
#include <cppcodec/base64_rfc4648.hpp>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <nlohmann/json.hpp>
#include <thread>

#include "transfer.grpc.pb.h"
using json = nlohmann::json;

// namespace filesystem = std::__fs::filesystem;
namespace trsdk = transfersdk;

#define PATHS_FILE_REL "config/paths.yaml"
#define TRANSFER_SDK_DAEMON "asperatransferd"
#define SDK_LOG "asperatransferd.log"
#define XFER_LOG "aspera-scp-transfer.log"

#define ENUM_TO_STRING_BEGIN(enum_ns, enum_name)                \
    namespace enum_ns {                                         \
    inline std::string enum_name##_to_string(enum_name value) { \
        switch (value) {
#define ENUM_TO_STRING_CASE(enum_name, enum_value) \
    case enum_name ::enum_value:                   \
        return #enum_value;
#define ENUM_TO_STRING_END(enum_name)                              \
    default:                                                       \
        return "Unknown " #enum_name ": " + std::to_string(value); \
        }                                                          \
        }                                                          \
        }
// define the enum to string conversion
ENUM_TO_STRING_BEGIN(transfersdk, TransferStatus)
ENUM_TO_STRING_CASE(TransferStatus, UNKNOWN_STATUS)
ENUM_TO_STRING_CASE(TransferStatus, QUEUED)
ENUM_TO_STRING_CASE(TransferStatus, RUNNING)
ENUM_TO_STRING_CASE(TransferStatus, COMPLETED)
ENUM_TO_STRING_CASE(TransferStatus, FAILED)
ENUM_TO_STRING_CASE(TransferStatus, CANCELED)
ENUM_TO_STRING_CASE(TransferStatus, PAUSED)
ENUM_TO_STRING_CASE(TransferStatus, ORPHANED)
ENUM_TO_STRING_END(TransferStatus)

#define LOGGER(level) BOOST_LOG_SEV(_log, boost::log::trivial::level)

// provide a common environment for tests
// including startup of asperatransferd
class TestEnvironment {
    // get the path of the item in the test environment
    std::filesystem::path get_path(const std::string& name) {
        LOGGER(debug) << "get_path: " << name;
        std::filesystem::path item_path = _top_folder / _paths[name].as<std::string>();
        if (!std::filesystem::exists(item_path)) {
            LOGGER(error) << item_path.string() << " not found.\nPlease check: SDK installed in " << _paths["sdk_root"].as<std::string>() << ", configuration file: " << _paths["main_config"].as<std::string>();
            throw std::runtime_error("ERROR");
        }
        return item_path;
    }

    const bool _init_log;
    const bool _shutdown;
    boost::log::sources::severity_logger<boost::log::trivial::severity_level> _log;
    // list of files to transfer
    std::vector<std::string> _file_list;
    // project folder
    const std::filesystem::path _top_folder;
    // conf file with _paths
    const YAML::Node _paths;
    const YAML::Node _config;
    // folder with SDK binaries
    std::filesystem::path _arch_folder;
    boost::process::child* _transfer_daemon;
    std::unique_ptr<trsdk::TransferService::Stub> _client;
    YAML::Node load_yaml(const char* const name, const std::filesystem::path& path) {
        LOGGER(info) << name << "=" << path.string();
        return YAML::LoadFile(path.string());
    }

    bool init_log() {
        boost::log::add_console_log(std::clog, boost::log::keywords::format = "[%TimeStamp%]: %Message%");
        boost::log::core::get()->set_filter(boost::log::trivial::severity >= boost::log::trivial::debug);
        return true;
    }

   public:
    TestEnvironment(int argc, char* argv[], bool shutdown = true) : _init_log(init_log()),
                                                                    _shutdown(shutdown),
                                                                    _log(),
                                                                    _file_list(argv + 1, argv + argc),
                                                                    _top_folder(std::filesystem::absolute(__FILE__).parent_path().parent_path().parent_path()),
                                                                    _paths(load_yaml("paths", _top_folder / PATHS_FILE_REL)),
                                                                    _config(load_yaml("main_config", get_path("main_config"))),
                                                                    _arch_folder(get_path("sdk_root") / conf_str({"misc", "platform"})),
                                                                    _transfer_daemon(nullptr),
                                                                    _client(nullptr) {
        if (_file_list.empty()) {
            LOGGER(error) << "No file(s) to transfer provided.";
            throw std::runtime_error("ERROR");
        }
        LOGGER(info) << "arch_folder=" << _arch_folder.string();
        for (const auto& one_file : _file_list) {
            LOGGER(info) << "file: " << one_file;
        }
    }

    ~TestEnvironment() {
        if (_shutdown) {
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

    std::string conf_str(const std::vector<std::string>& keys) {
        return conf(keys).as<std::string>();
    }

    boost::log::sources::severity_logger<boost::log::trivial::severity_level>& log() {
        return _log;
    }

    void start_daemon() {
        std::string sdk_url = conf_str({"trsdk", "url"});
        LOGGER(info) << "sdk_url=" << sdk_url;
        auto sdk_uri = boost::urls::parse_uri(sdk_url).value();
        auto server_port_str = std::string(sdk_uri.port());
        auto server_address = std::string(sdk_uri.host());
        std::string channel_address = server_address + ":" + server_port_str;
        LOGGER(info) << "channel_address=" << channel_address;
        // create a connection to the daemon
        auto channel = grpc::CreateChannel(channel_address, grpc::InsecureChannelCredentials());
        _client = trsdk::TransferService::NewStub(channel);
        std::this_thread::sleep_for(std::chrono::seconds(5));
        const std::filesystem::path log_folder(std::filesystem::temp_directory_path());
        // wait for connection, or start the daemon
        for (int i = 0; i < 2; ++i) {
            LOGGER(info) << "Connecting to " << channel_address << " using gRPC";
            grpc_connectivity_state state = channel->GetState(true);
            if (state == GRPC_CHANNEL_READY) {
                LOGGER(info) << "Connected !";
                return;
            }
            LOGGER(error) << "Failed to connect";
            // Prepare daemon configuration file
            json config_info = {
                {"address", server_address},
                {"port", std::stoi(server_port_str)},
                {"log_directory", log_folder},
                {"log_level", "debug"},
                {"fasp_runtime",
                 {{"use_embedded", false},
                  {"user_defined",
                   {{"bin", _arch_folder},
                    {"etc", get_path("trsdk_noarch")}}}}},
                {"log",
                 {{"dir", log_folder},
                  {"level", 2}}}};
            LOGGER(info) << config_info.dump(4);
            auto conf_file = log_folder / "daemon.conf";
            auto daemon_path = _arch_folder / TRANSFER_SDK_DAEMON;
            std::ofstream conf_stream(conf_file.string());
            conf_stream << config_info.dump(4);
            conf_stream.close();
            // Start daemon
            std::string command = daemon_path.string() + " --config " + conf_file.string();
            std::string out_file = log_folder / "daemon.out";
            std::string err_file = log_folder / "daemon.err";
            LOGGER(info) << "stderr: " << err_file;
            LOGGER(info) << "stdout: " << out_file;
            LOGGER(info) << "sdk log: " << log_folder / SDK_LOG;
            LOGGER(info) << "xfer log: " << log_folder / XFER_LOG;
            LOGGER(info) << "Starting: " << command;
            _transfer_daemon = new boost::process::child(
                command,
                boost::process::std_out > out_file,
                boost::process::std_err > err_file);
            // Wait for the daemon to start
            std::this_thread::sleep_for(std::chrono::seconds(10));
        }
        LOGGER(error) << "daemon not started or cannot be started.\nCheck the logs: daemon.err and daemon.out (see paths above).";
        exit(1);
    }

    inline void
    start_transfer_and_wait(const json& transferSpec) {
        LOGGER(info) << "ts=" << transferSpec.dump(4);
        if (_client == nullptr) {
            start_daemon();
        }

        // create a transfer request
        auto* transferConfig = new trsdk::TransferConfig;
        transferConfig->set_loglevel(2);  // levels: 0 1 2
        trsdk::TransferRequest transferRequest;
        transferRequest.set_transfertype(trsdk::TransferType::FILE_REGULAR);
        transferRequest.set_allocated_config(transferConfig);
        transferRequest.set_transferspec(transferSpec.dump());

        // send start transfer request to the transfer daemon
        grpc::ClientContext startTransferContext;
        transfersdk::StartTransferResponse startTransferResponse;
        _client->StartTransfer(&startTransferContext, transferRequest, &startTransferResponse);
        std::string transferId = startTransferResponse.transferid();
        LOGGER(info) << "transfer started with id " << transferId;
        trsdk::TransferStatus status;
        // wait until finished, check every second
        do {
            std::this_thread::sleep_for(std::chrono::seconds(1));
            trsdk::TransferInfoRequest transferInfoRequest;
            transferInfoRequest.set_transferid(transferId);
            trsdk::QueryTransferResponse queryTransferResponse;
            grpc::ClientContext queryTransferContext;
            _client->QueryTransfer(&queryTransferContext, transferInfoRequest, &queryTransferResponse);
            status = queryTransferResponse.status();
            LOGGER(info) << "transfer status: " << TransferStatus_to_string(status);
        } while (!transfer_finished(status));
    }
    // add files to the transfer spec
    void add_files_to_ts(json& paths, bool add_destination = false) {
        for (const auto& one_file : _file_list) {
            json one = {{"source", one_file}};
            if (add_destination) {
                one.push_back({"destination", std::filesystem::path(one_file).filename()});
            }
            paths.push_back(one);
        }
    }

    // shutdown daemon
    void shutdown() {
        if (_client != nullptr) {
            _client = nullptr;
        }
        if (_transfer_daemon != nullptr) {
            LOGGER(info) << "Shutting down daemon...";
            _transfer_daemon->terminate();
            _transfer_daemon->wait();
            delete _transfer_daemon;
            _transfer_daemon = nullptr;
        }
    }

    // create a basic auth header
    static inline std::string basic_auth_header(const std::string& username, const std::string& password) {
        return "Basic " + cppcodec::base64_rfc4648::encode(username + ":" + password);
    }

    static inline bool transfer_finished(const trsdk::TransferStatus& status) {
        return status == trsdk::TransferStatus::COMPLETED ||
               status == trsdk::TransferStatus::FAILED ||
               status == trsdk::TransferStatus::UNKNOWN_STATUS;
    }
};