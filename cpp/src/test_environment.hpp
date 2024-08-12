#include <grpcpp/create_channel.h>

#include <chrono>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <nlohmann/json.hpp>
#include <thread>

#include "transfer.grpc.pb.h"
using json = nlohmann::json;

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

inline std::string GenerateSourceFile() {
    filesystem::path path = filesystem::current_path().append("file");
    std::ofstream file;
    file.open(path);
    file << "Hello World!";
    file.close();
    return path;
}

inline std::string statusToString(int status) {
    switch (status) {
        default:
            return "Unknown: " + std::to_string(status);
        case TransferStatus::UNKNOWN_STATUS:
            return "UNKNOWN_STATUS";
        case TransferStatus::QUEUED:
            return "QUEUED";
        case TransferStatus::RUNNING:
            return "RUNNING";
        case TransferStatus::COMPLETED:
            return "COMPLETED";
        case TransferStatus::FAILED:
            return "FAILED";
        case TransferStatus::CANCELED:
            return "CANCELED";
        case TransferStatus::PAUSED:
            return "PAUSED";
        case TransferStatus::ORPHANED:
            return "ORPHANED";
    }
}

inline void start_transfer_and_wait(const json &transferSpec) {
    std::cout << "ts=" << transferSpec.dump(4) << std::endl;
    // create a connection to the faspmanager daemon
    std::unique_ptr<TransferService::Stub> client = TransferService::NewStub(
        grpc::CreateChannel("localhost:55002", grpc::InsecureChannelCredentials()));
    // create a transfer request
    TransferRequest transferRequest;
    transferRequest.set_transfertype(TransferType::FILE_REGULAR);
    auto *transferConfig = new TransferConfig;
    transferConfig->set_loglevel(2);
    transferRequest.set_allocated_config(transferConfig);
    transferRequest.set_transferspec(transferSpec.dump());

    // send start transfer request to the faspmanager daemon
    ClientContext startTransferContext;
    StartTransferResponse startTransferResponse;
    client->StartTransfer(&startTransferContext, transferRequest, &startTransferResponse);
    std::string transferId = startTransferResponse.transferid();
    std::cout << "transfer started with id " << transferId << std::endl;

    bool finished = false;
    TransferStatus status;
    while (!finished) {
        TransferInfoRequest transferInfoRequest;
        transferInfoRequest.set_transferid(transferId);
        QueryTransferResponse queryTransferResponse;
        ClientContext queryTransferContext;
        client->QueryTransfer(&queryTransferContext, transferInfoRequest, &queryTransferResponse);
        // check transfer status in response and exit if it's done
        status = queryTransferResponse.status();
        std::cout << "transfer info " << statusToString(status) << std::endl;

        finished = status == TransferStatus::COMPLETED ||
                   status == TransferStatus::FAILED ||
                   status == TransferStatus::UNKNOWN_STATUS;

        // wait a second before checking again
        std::this_thread::sleep_for(std::chrono::seconds(1));
    }

    std::cout << "finished " << statusToString(status) << std::endl;
}
