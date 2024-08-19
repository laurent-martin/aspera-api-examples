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
#include <filesystem>
#include <fstream>
#include <iostream>
#include <nlohmann/json.hpp>
#include <thread>

#include "transfer.grpc.pb.h"
using json = nlohmann::json;

//namespace filesystem = std::__fs::filesystem;
namespace trsdk = transfersdk;

#define PATHS_FILE_REL "config/paths.yaml"
#define TRANSFER_SDK_DAEMON "asperatransferd"

#define ENUM_TO_STRING_BEGIN(enum_ns,enum_name)                       \
    inline std::string enum_name##ToString(enum_ns::enum_name value) { \
        switch (value) {
#define ENUM_TO_STRING_CASE(enum_name, enum_value) \
    case enum_name ::enum_value:                   \
        return #enum_value;
#define ENUM_TO_STRING_END(enum_name)                         \
    default:                                                  \
        return "Unknown " #enum_name + std::to_string(value); \
        }                                                     \
        }
// define the enum to string conversion
ENUM_TO_STRING_BEGIN(transfersdk,TransferStatus)
ENUM_TO_STRING_CASE(transfersdk::TransferStatus, UNKNOWN_STATUS)
ENUM_TO_STRING_CASE(transfersdk::TransferStatus, QUEUED)
ENUM_TO_STRING_CASE(transfersdk::TransferStatus, RUNNING)
ENUM_TO_STRING_CASE(transfersdk::TransferStatus, COMPLETED)
ENUM_TO_STRING_CASE(transfersdk::TransferStatus, FAILED)
ENUM_TO_STRING_CASE(transfersdk::TransferStatus, CANCELED)
ENUM_TO_STRING_CASE(transfersdk::TransferStatus, PAUSED)
ENUM_TO_STRING_CASE(transfersdk::TransferStatus, ORPHANED)
ENUM_TO_STRING_END(transfersdk::TransferStatus)

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
    void log_yaml(YAML::Node node) {
        for (YAML::const_iterator it = node.begin(); it != node.end(); ++it) {
            LOGGER(debug) << "key:" << it->first.as<std::string>() << std::endl;
        }
    }
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
    TestEnvironment(int argc, char* argv[]) : _init_log(init_log()),
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

    YAML::Node conf(const std::vector<std::string>& keys) {
        // Need to clone, else it will be modified in loop
        YAML::Node currentNode = YAML::Clone(_config);
        for (const auto& key : keys) {
            LOGGER(debug) << "dig: " << key;
            const auto next_node = currentNode[key];
            if (next_node.IsDefined()) {
                currentNode = next_node;
            } else {
                if (next_node.IsMap()) {
                    log_yaml(next_node);
                }
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
        auto port_str = std::string(sdk_uri.port());
        auto hostname = std::string(sdk_uri.host());
        std::string channel_address = hostname + ":" + port_str;
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
            json config_info = {
                {"address", hostname},
                {"port", std::stoi(port_str)},
                {"log_directory", log_folder},
                {"log_level", "debug"},
                {"fasp_runtime",
                 {{"use_embedded", false},
                  {"user_defined",
                   {{"bin", _arch_folder},
                    {"etc", get_path("trsdk_noarch")}}}}},
                {"_log",
                 {{"dir", log_folder},
                  {"level", 2}}}};
            config_info.dump(4);
            // Prepare daemon configuration
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
            LOGGER(info) << "Starting: " << command;
            _transfer_daemon = new boost::process::child(
                command,
                boost::process::std_out > out_file,
                boost::process::std_err > err_file);
            // Wait for the daemon to start
            std::this_thread::sleep_for(std::chrono::seconds(10));
        }
        LOGGER(error) << "daemon not started or cannot be started.\nCheck the logs: daemon.err and daemon.out (see _paths above).";
        exit(1);
    }

    inline void
    start_transfer_and_wait(const json& transferSpec) {
        LOGGER(info) << "ts=" << transferSpec.dump(4);
        if (_client == nullptr) {
            start_daemon();
        }

        // create a transfer request
        trsdk::TransferRequest transferRequest;
        transferRequest.set_transfertype(trsdk::TransferType::FILE_REGULAR);
        auto* transferConfig = new trsdk::TransferConfig;
        transferConfig->set_loglevel(2);
        transferRequest.set_allocated_config(transferConfig);
        transferRequest.set_transferspec(transferSpec.dump());

        // send start transfer request to the faspmanager daemon
        grpc::ClientContext startTransferContext;
        transfersdk::StartTransferResponse startTransferResponse;
        _client->StartTransfer(&startTransferContext, transferRequest, &startTransferResponse);
        std::string transferId = startTransferResponse.transferid();
        LOGGER(info) << "transfer started with id " << transferId;

        bool finished = false;
        trsdk::TransferStatus status;
        // wait until finished, check every second
        while (!finished) {
            trsdk::TransferInfoRequest transferInfoRequest;
            transferInfoRequest.set_transferid(transferId);
            trsdk::QueryTransferResponse queryTransferResponse;
            grpc::ClientContext queryTransferContext;
            _client->QueryTransfer(&queryTransferContext, transferInfoRequest, &queryTransferResponse);
            status = queryTransferResponse.status();
            LOGGER(info) << "transfer info " << TransferStatusToString(status);
            finished = status == trsdk::TransferStatus::COMPLETED ||
                       status == trsdk::TransferStatus::FAILED ||
                       status == trsdk::TransferStatus::UNKNOWN_STATUS;
            std::this_thread::sleep_for(std::chrono::seconds(1));
        }
        LOGGER(info) << "finished " << TransferStatusToString(status);
    }
    // add files to the transfer spec
    void add_files_to_ts(json& _paths) {
        for (const auto& one_file : _file_list) {
            _paths.push_back({{"source", one_file}});
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
};