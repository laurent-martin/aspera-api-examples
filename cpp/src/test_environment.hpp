#pragma once

#include <grpcpp/create_channel.h>
#include <yaml-cpp/yaml.h>

#include <boost/asio.hpp>
#include <boost/asio/ssl.hpp>
#include <boost/beast.hpp>
#include <boost/core/detail/string_view.hpp>
#include <boost/json.hpp>
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
#include <thread>

#include "transfer.grpc.pb.h"

namespace json = boost::json;
namespace trsdk = transfersdk;

#define PATHS_FILE_REL "config/paths.yaml"
#define TRANSFER_SDK_DAEMON "asperatransferd"
#define SDK_LOG "asperatransferd.log"
#define XFER_LOG "aspera-scp-transfer.log"

#define ENUM_TO_STRING_BEGIN(enum_name, enum_ns)                \
    namespace enum_ns {                                         \
    inline std::string enum_name##_to_string(enum_name value) { \
        switch (value) {
#define ENUM_TO_STRING_VALUE(enum_name, enum_value) \
    case enum_name ::enum_value:                    \
        return #enum_value;
#define ENUM_TO_STRING_END(enum_name)                              \
    default:                                                       \
        return "Unknown " #enum_name ": " + std::to_string(value); \
        }                                                          \
        }                                                          \
        }
// define the enum to string conversion
ENUM_TO_STRING_BEGIN(TransferStatus, transfersdk)
ENUM_TO_STRING_VALUE(TransferStatus, UNKNOWN_STATUS)
ENUM_TO_STRING_VALUE(TransferStatus, QUEUED)
ENUM_TO_STRING_VALUE(TransferStatus, RUNNING)
ENUM_TO_STRING_VALUE(TransferStatus, COMPLETED)
ENUM_TO_STRING_VALUE(TransferStatus, FAILED)
ENUM_TO_STRING_VALUE(TransferStatus, CANCELED)
ENUM_TO_STRING_VALUE(TransferStatus, PAUSED)
ENUM_TO_STRING_VALUE(TransferStatus, ORPHANED)
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
        LOGGER(info) << name << "=" << path.string();
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
            LOGGER(error) << "No file(s) to transfer provided.";
            throw std::runtime_error("ERROR");
        }
        LOGGER(info) << "top_folder=" << _top_folder.string();
        LOGGER(info) << "arch_folder=" << _arch_folder.string();
        for (const auto& one_file : _file_list) {
            LOGGER(info) << "file: " << one_file;
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

    std::string conf_str(const std::vector<std::string>& keys) {
        return conf(keys).as<std::string>();
    }

    boost::log::sources::severity_logger<boost::log::trivial::severity_level>& log() {
        return _log;
    }

    // Start the transfer SDK daemon
    void start_daemon() {
        const std::string sdk_url = conf_str({"trsdk", "url"});
        LOGGER(info) << "sdk_url=" << sdk_url;
        const auto sdk_uri = boost::urls::parse_uri(sdk_url).value();
        const std::string server_port_str = sdk_uri.port();
        const std::string server_address = sdk_uri.host();
        const std::string channel_address = server_address + ":" + server_port_str;
        LOGGER(info) << "channel_address=" << channel_address;
        // create a connection to the daemon
        const auto channel = grpc::CreateChannel(channel_address, grpc::InsecureChannelCredentials());
        _transfer_service = trsdk::TransferService::NewStub(channel);
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
            LOGGER(info) << json::serialize(config_info);
            auto conf_file = log_folder / "daemon.conf";
            auto daemon_path = _arch_folder / TRANSFER_SDK_DAEMON;
            std::ofstream conf_stream(conf_file.string());
            conf_stream << json::serialize(config_info);
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
        LOGGER(error) << "daemon not started or cannot be started.";
        LOGGER(error) << "Check the logs: daemon.err and daemon.out (see paths above).";
        exit(1);
    }

    inline void
    start_transfer_and_wait(const json::object& transfer_spec) {
        LOGGER(info) << "ts=" << json::serialize(transfer_spec);
        if (_transfer_service == nullptr) {
            start_daemon();
        }

        // create a transfer request
        auto* transfer_config = new trsdk::TransferConfig;
        transfer_config->set_loglevel(2);  // levels: 0 1 2
        trsdk::TransferRequest transfer_request;
        transfer_request.set_transfertype(trsdk::TransferType::FILE_REGULAR);
        transfer_request.set_allocated_config(transfer_config);
        transfer_request.set_transferspec(json::serialize(transfer_spec));

        // send start transfer request to the transfer daemon
        grpc::ClientContext start_transfer_context;
        transfersdk::StartTransferResponse startTransferResponse;
        _transfer_service->StartTransfer(&start_transfer_context, transfer_request, &startTransferResponse);
        throw_on_error(startTransferResponse.status(), startTransferResponse.error());
        const std::string transfer_id = startTransferResponse.transferid();
        LOGGER(info) << "transfer id: " << transfer_id << ", status: " << TransferStatus_to_string(startTransferResponse.status());
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
            LOGGER(info) << "transfer status: " << TransferStatus_to_string(status);
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
            LOGGER(info) << "Shutting down daemon...";
            _transfer_daemon->terminate();
            _transfer_daemon->wait();
            delete _transfer_daemon;
            _transfer_daemon = nullptr;
        }
    }

    // Create a basic auth header
    static inline std::string basic_auth_header(const std::string& username, const std::string& password) {
        std::string credentials = username + ":" + password;
        std::string encoded_credentials;
        encoded_credentials.resize(boost::beast::detail::base64::encoded_size(credentials.size()));
        boost::beast::detail::base64::encode(encoded_credentials.data(), credentials.data(), credentials.size());
        return "Basic " + encoded_credentials;
    }

    static inline void throw_on_error(const trsdk::TransferStatus& status, const trsdk::Error& error) {
        if (status == trsdk::TransferStatus::FAILED) {
            throw std::runtime_error("transfer failed: " + error.description());
        }
        if (status == trsdk::TransferStatus::UNKNOWN_STATUS) {
            throw std::runtime_error("unknown transfer id: " + error.description());
        }
    }
};

#define HTTP_1_1 11

// simple REST client
class Rest {
   public:
    const std::string _base_url;
    std::string _authorization;
    Rest(std::string base_url) : _base_url(base_url), _authorization("") {}

    void set_basic(const std::string& user, const std::string& pass) {
        _authorization = TestEnvironment::basic_auth_header(user, pass);
    }

    inline json::object post(std::string subpath, json::object payload) {
        const std::string json_body = json::serialize(payload);
        const auto base_uri = boost::urls::parse_uri(_base_url).value();
        const std::string host = base_uri.host();
        std::string port = base_uri.port();
        if (port.empty()) {
            if (base_uri.scheme() == "https")
                port = "443";
        }
        const std::string path = base_uri.path() + "/" + subpath;
        boost::asio::io_service io_svc;
        boost::asio::ssl::context ssl_ctx(boost::asio::ssl::context::sslv23_client);
        boost::asio::ssl::stream<boost::asio::ip::tcp::socket> sock_stream = {io_svc, ssl_ctx};
        boost::asio::ip::tcp::resolver resolver(io_svc);
        auto it = resolver.resolve(host, port);
        connect(sock_stream.lowest_layer(), it);
        sock_stream.handshake(boost::asio::ssl::stream_base::handshake_type::client);
        boost::beast::http::request<boost::beast::http::string_body> request{boost::beast::http::verb::post, path, HTTP_1_1};
        request.set(boost::beast::http::field::host, host);
        request.set(boost::beast::http::field::user_agent, BOOST_BEAST_VERSION_STRING);
        request.set(boost::beast::http::field::authorization, _authorization);
        request.set(boost::beast::http::field::content_type, "application/json");
        request.set(boost::beast::http::field::accept, "application/json");
        request.set(boost::beast::http::field::content_length, std::to_string(json_body.size()));
        request.body() = json_body;
        boost::beast::http::write(sock_stream, request);
        boost::beast::http::response<boost::beast::http::string_body> response;
        boost::beast::flat_buffer buffer;
        boost::beast::http::read(sock_stream, buffer, response);
        boost::system::error_code ec;
        sock_stream.shutdown(ec);
        if (ec == boost::asio::error::eof || ec == boost::asio::ssl::error::stream_truncated) {
            ec.assign(0, ec.category());
        }
        if (ec)
            throw boost::system::system_error{ec};
        return json::parse(response.body()).as_object();
    }
};
