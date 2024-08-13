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
namespace urls = boost::urls;
namespace core = boost::core;

namespace filesystem = std::__fs::filesystem;

using grpc::Channel;
using grpc::ClientContext;
using grpc::Status;
using transfersdk::QueryTransferResponse;
using transfersdk::RetryStrategy;
using transfersdk::StartTransferResponse;
using transfersdk::TransferConfig;
using transfersdk::TransferInfoRequest;
using transfersdk::TransferRequest;
using transfersdk::TransferResponse;
using transfersdk::TransferService;
using transfersdk::TransferStatus;
using transfersdk::TransferType;

#define PATHS_FILE_REL "config/paths.yaml"
#define TRANSFER_SDK_DAEMON "asperatransferd"

#define ENUM_TO_STRING_BEGIN(enum_name)                       \
    inline std::string enum_name##ToString(enum_name value) { \
        switch (value) {
#define ENUM_TO_STRING_CASE(enum_name, enum_value) \
    case enum_name ::enum_value:                   \
        return #enum_value;
#define ENUM_TO_STRING_END(enum_name)                         \
    default:                                                  \
        return "Unknown " #enum_name + std::to_string(value); \
        }                                                     \
        }
ENUM_TO_STRING_BEGIN(TransferStatus)
ENUM_TO_STRING_CASE(TransferStatus, UNKNOWN_STATUS)
ENUM_TO_STRING_CASE(TransferStatus, QUEUED)
ENUM_TO_STRING_CASE(TransferStatus, RUNNING)
ENUM_TO_STRING_CASE(TransferStatus, COMPLETED)
ENUM_TO_STRING_CASE(TransferStatus, FAILED)
ENUM_TO_STRING_CASE(TransferStatus, CANCELED)
ENUM_TO_STRING_CASE(TransferStatus, PAUSED)
ENUM_TO_STRING_CASE(TransferStatus, ORPHANED)
ENUM_TO_STRING_END(TransferStatus)

#define LOGGER(level) BOOST_LOG_SEV(log, boost::log::trivial::level)

// provide a common environment for tests
// including startup of asperatransferd
class TestEnvironment {
   public:
    // get the path of the item in the test environment
    std::filesystem::path get_path(const std::string& name) {
        std::filesystem::path item_path = top_folder / paths[name].as<std::string>();
        if (!std::filesystem::exists(item_path)) {
            LOGGER(error) << item_path.string() << " not found.\nPlease check: SDK installed in " << paths["sdk_root"].as<std::string>() << ", configuration file: " << paths["main_config"].as<std::string>();
            throw std::runtime_error("ERROR");
        }
        return item_path;
    }

    // project folder
    const std::filesystem::path top_folder;
    // folder with SDK binaries
    std::filesystem::path arch_folder;
    // conf file with paths
    YAML::Node paths;
    YAML::Node config;
    std::vector<std::string> file_list;
    std::unique_ptr<TransferService::Stub> client;
    boost::process::child* transfer_daemon;
    std::filesystem::path log_folder;
    boost::log::sources::severity_logger<boost::log::trivial::severity_level> log;

    TestEnvironment(int argc, char* argv[]) : top_folder(std::filesystem::absolute(__FILE__).parent_path().parent_path().parent_path()),
                                              file_list(argv + 1, argv + argc),
                                              client(nullptr),
                                              log_folder(std::filesystem::temp_directory_path()) {
        boost::log::add_console_log(std::clog, boost::log::keywords::format = "[%TimeStamp%]: %Message%");
        boost::log::core::get()->set_filter(boost::log::trivial::severity >= boost::log::trivial::debug);

        if (file_list.empty()) {
            LOGGER(error) << "No files to transfer.";
            throw std::runtime_error("ERROR");
        }
        std::filesystem::path paths_file = top_folder / PATHS_FILE_REL;
        LOGGER(info) << "paths_file(boost)=" << paths_file.string();
        LOGGER(info) << "paths_file=" << paths_file.string();
        paths = YAML::LoadFile(paths_file.string());
        std::string main_config = get_path("main_config").string();
        LOGGER(info) << "main_config={}" << main_config;
        config = YAML::LoadFile(main_config);
        arch_folder = get_path("sdk_root") / config["misc"]["system_type"].as<std::string>();
        LOGGER(info) << "arch_folder=" << arch_folder.string();
        for (const auto& one_file : file_list) {
            LOGGER(info) << "file: " << one_file;
        }
    }

    void start_daemon() {
        std::string sdk_url = config["misc"]["trsdk_url"].as<std::string>();
        LOGGER(info) << "sdk_url=" << sdk_url;
        auto parsed = urls::parse_uri(sdk_url);
        urls::url_view url_view = parsed.value();
        auto port_str = std::string(url_view.port());
        auto hostname = std::string(url_view.host());
        std::string channel_address = hostname + ":" + port_str;

        LOGGER(info) << "channel_address=" << channel_address;

        // create a connection to the faspmanager daemon
        auto channel = grpc::CreateChannel(channel_address, grpc::InsecureChannelCredentials());
        client = TransferService::NewStub(channel);
        std::this_thread::sleep_for(std::chrono::seconds(5));

        // Attempt to connect
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
                   {{"bin", arch_folder},
                    {"etc", get_path("trsdk_noarch")}}}}},
                {"log",
                 {{"dir", log_folder},
                  {"level", 2}}}};
            config_info.dump(4);

            // Prepare config
            auto conf_file = log_folder / "daemon.conf";
            auto daemon_path = arch_folder / TRANSFER_SDK_DAEMON;
            std::ofstream conf_stream(conf_file.string());
            conf_stream << config_info.dump(4);
            conf_stream.close();

            // Start daemon
            std::string command = daemon_path.string() + " --config " + conf_file.string();
            std::string out_file = log_folder / "daemon.out";
            std::string err_file = log_folder / "daemon.err";
            LOGGER(info) << "Starting: " << command;
            LOGGER(info) << "stderr: " << err_file;
            LOGGER(info) << "stdout: " << out_file;

            LOGGER(info) << "Starting daemon...";
            transfer_daemon = new boost::process::child(command, boost::process::std_out > out_file, boost::process::std_err > err_file);

            // Wait for the daemon to start
            std::this_thread::sleep_for(std::chrono::seconds(10));
        }

        if (!client) {
            LOGGER(error) << "daemon not started or cannot be started.\nCheck the logs: daemon.err and daemon.out (see paths above).";
            exit(1);
        }
        return;
    }

    inline void
    start_transfer_and_wait(const json& transferSpec) {
        LOGGER(info) << "ts=" << transferSpec.dump(4);
        if (client == nullptr) {
            start_daemon();
        }

        // create a transfer request
        TransferRequest transferRequest;
        transferRequest.set_transfertype(TransferType::FILE_REGULAR);
        auto* transferConfig = new TransferConfig;
        transferConfig->set_loglevel(2);
        transferRequest.set_allocated_config(transferConfig);
        transferRequest.set_transferspec(transferSpec.dump());

        // send start transfer request to the faspmanager daemon
        ClientContext startTransferContext;
        StartTransferResponse startTransferResponse;
        client->StartTransfer(&startTransferContext, transferRequest, &startTransferResponse);
        std::string transferId = startTransferResponse.transferid();
        LOGGER(info) << "transfer started with id " << transferId;

        bool finished = false;
        TransferStatus status;
        // wait until finished, check every second
        while (!finished) {
            TransferInfoRequest transferInfoRequest;
            transferInfoRequest.set_transferid(transferId);
            QueryTransferResponse queryTransferResponse;
            ClientContext queryTransferContext;
            client->QueryTransfer(&queryTransferContext, transferInfoRequest, &queryTransferResponse);
            status = queryTransferResponse.status();
            LOGGER(info) << "transfer info " << TransferStatusToString(status);
            finished = status == TransferStatus::COMPLETED ||
                       status == TransferStatus::FAILED ||
                       status == TransferStatus::UNKNOWN_STATUS;
            std::this_thread::sleep_for(std::chrono::seconds(1));
        }
        LOGGER(info) << "finished " << TransferStatusToString(status);
    }
    // add files to the transfer spec
    void add_files_to_ts(json& paths) {
        for (const auto& one_file : file_list) {
            paths.push_back({{"source", one_file}});
        }
    }

    // shutdown daemon
    void shutdown() {
        if (client != nullptr) {
            client = nullptr;
        }
        if (transfer_daemon != nullptr) {
            LOGGER(info) << "Shutting down daemon...";
            transfer_daemon->terminate();
            transfer_daemon->wait();
            delete transfer_daemon;
            transfer_daemon = nullptr;
        }
    }
};