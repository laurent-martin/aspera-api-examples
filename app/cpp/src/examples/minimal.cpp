// Upload files to an HSTS with SSH credentials, with the Transfer Daemon API only (gRPC).
// Read this sample first: the other samples use the helper class TransferClient, which does the same steps.
// The class Configuration only reads the parameters of the test environment: replace config.param_str(...) with your values.
#include <grpcpp/create_channel.h>

#include <boost/algorithm/string/trim.hpp>
#include <boost/asio/io_context.hpp>
#include <boost/json.hpp>
#include <boost/process.hpp>
#include <boost/url/parse.hpp>
#include <chrono>
#include <cstdio>
#include <filesystem>

#include "utils/configuration.hpp"
// stub code generated from transferd.proto
#include "transferd.grpc.pb.h"

namespace json = boost::json;
namespace trapi = transferd::api;
namespace bp2 = boost::process;

// address of the gRPC API, set in the default configuration file of the SDK: etc/transferd.json
const std::string DAEMON_ADDRESS = "127.0.0.1:55002";

/// @brief Connect to the daemon, start the transfer, and follow it until its end.
/// @param config configuration of the samples
/// @param files files to transfer
/// @param daemon_out output file of the daemon
void transfer(utils::Configuration& config, const std::vector<std::string>& files, const std::string& daemon_out) {
    // 2. Connect to the gRPC API of the daemon
    const auto channel = grpc::CreateChannel(DAEMON_ADDRESS, grpc::InsecureChannelCredentials());
    if (!channel->WaitForConnected(std::chrono::system_clock::now() + std::chrono::seconds(10))) {
        throw std::runtime_error("Failed to connect to daemon: " + DAEMON_ADDRESS + ", see: " + daemon_out);
    }
    const auto client = trapi::TransferService::NewStub(channel);
    LOGGER(info) << "Connected to daemon: " << DAEMON_ADDRESS;

    // 3. Build the transfer spec: upload (send) with SSH credentials
    // the parsed URL is a view: the string must stay alive while it is used
    const std::string server_url_string = config.param_str({"server", "url"});
    const auto server_url = boost::urls::parse_uri(server_url_string).value();
    json::array paths;
    for (const auto& file : files) {
        paths.push_back(json::object{{"source", file}});
    }
    const json::object transfer_spec = {
        {"direction", "send"},
        {"remote_host", std::string(server_url.host())},
        {"ssh_port", std::stoi(std::string(server_url.port()))},
        {"remote_user", config.param_str({"server", "username"})},
        {"remote_password", config.param_str({"server", "password"})},
        {"destination_root", config.param_str({"server", "folder_upload"})},
        {"paths", paths}};

    // 4. Start the transfer and follow it: the daemon sends an event on each change, until the end of the transfer
    LOGGER(info) << "Uploading files";
    trapi::TransferRequest request;
    request.set_transfertype(trapi::TransferType::FILE_REGULAR);
    request.mutable_config();
    request.set_transferspec(json::serialize(transfer_spec));
    grpc::ClientContext context;
    const auto events = client->StartTransferWithMonitor(&context, request);
    trapi::TransferResponse event;
    while (events->Read(&event)) {
        LOGGER(info) << "Transfer: " << trapi::TransferStatus_Name(event.status()) << " "
                     << event.transferinfo().bytestransferred() << " bytes";
        // the cause of an error is in error, or else in transferInfo
        std::string description =
            event.error().description().empty() ? event.transferinfo().errordescription() : event.error().description();
        boost::algorithm::trim(description);
        if (event.status() == trapi::TransferStatus::FAILED || event.status() == trapi::TransferStatus::CANCELED) {
            context.TryCancel();
            throw std::runtime_error("Transfer failed: " + description);
        }
        if (event.status() == trapi::TransferStatus::UNKNOWN_STATUS) {
            context.TryCancel();
            throw std::runtime_error("Transfer status unknown: " + description);
        }
        if (event.status() == trapi::TransferStatus::COMPLETED) {
            // stop following the transfer
            context.TryCancel();
            return;
        }
    }
    // the stream ended before the end of the transfer: the cause is in the status of the call
    const grpc::Status status = events->Finish();
    if (!status.ok()) {
        throw std::runtime_error("Transfer monitoring failed: " + status.error_message());
    }
    throw std::runtime_error("Transfer monitoring ended before transfer completion");
}

int main(int argc, char* argv[]) {
    utils::Configuration config(argc, argv);

    // 1. Start the Transfer Daemon. Without option, transferd reads etc/transferd.json of the SDK.
    //    In production, the daemon can also run as a service, started separately.
    const std::string daemon_out = (std::filesystem::temp_directory_path() / "transferd_minimal.out").string();
    FILE* out = std::fopen(daemon_out.c_str(), "w");
    if (out == nullptr) {
        LOGGER(error) << "Failed to open: " << daemon_out;
        return 1;
    }
    LOGGER(info) << "Starting daemon";
    boost::asio::io_context ioc;
    bp2::process daemon(ioc, boost::filesystem::path(config.get_path("sdk_daemon")), std::vector<std::string>{},
                        bp2::process_stdio{{}, out, out});
    std::fclose(out);

    int exit_code = 0;
    try {
        // files to transfer: arguments of the command line
        transfer(config, std::vector<std::string>(argv + 1, argv + argc), daemon_out);
    } catch (const std::exception& e) {
        LOGGER(error) << e.what();
        exit_code = 1;
    }

    // 5. Stop the daemon: transferd stops cleanly on SIGINT
    LOGGER(info) << "Stopping daemon";
    boost::system::error_code ec;
    daemon.interrupt(ec);
    daemon.wait(ec);
    return exit_code;
}
