
#include "utils/configuration.hpp"
#include "utils/rest.hpp"
#include "utils/transfer_client.hpp"

int main(int argc, char* argv[]) {
    utils::Configuration config(argc, argv);
    utils::TransferClient transfer_client(config);
    try {
        const std::string shares_api_url = config.param_str({"shares", "url"}) + "/node_api";
        utils::Rest shares_api(shares_api_url);
        shares_api.set_auth_basic(config.param_str({"shares", "username"}), config.param_str({"shares", "password"}));
        const std::string destination_folder_in_shares = config.param_str({"shares", "folder_upload"});
        // refer to:
        // https://developer.ibm.com/apis/catalog/aspera--aspera-node-api/api/API--aspera--ibm-aspera-node-api#post1924996167
        {
            LOGGER(info) << "Getting transfer spec";
            json::object transfer_setup_request = json::object{
                {"transfer_requests", json::array{json::object{{"transfer_request", json::object{{"paths", json::array{json::object{{"destination", destination_folder_in_shares}}}}}}}}}};
            json::value response_data = shares_api.create("files/upload_setup", transfer_setup_request);
            // extract the single transfer spec, or throw the error of the Node API
            json::object transfer_specification = utils::TransferClient::transfer_spec_from_setup(response_data);
            config.add_sources(transfer_specification, "paths");
            LOGGER(info) << "Uploading files";
            transfer_client.transfer_start_and_wait(transfer_specification);
        }
        {
            const std::string source_file_path_in_shares = destination_folder_in_shares + "/" + std::filesystem::path(argv[1]).filename().string();
            LOGGER(info) << "Getting transfer spec";
            json::object transfer_setup_request = json::object{
                {"transfer_requests", json::array{json::object{{"transfer_request", json::object{{"paths", json::array{json::object{{"source", source_file_path_in_shares}}}}}}}}}};
            json::value response_data = shares_api.create("files/download_setup", transfer_setup_request);
            // extract the single transfer spec, or throw the error of the Node API
            json::object transfer_specification = utils::TransferClient::transfer_spec_from_setup(response_data);
            transfer_specification.at("destination_root") = std::filesystem::temp_directory_path().string();
            LOGGER(info) << "Downloading file";
            transfer_client.transfer_start_and_wait(transfer_specification);
        }
        return 0;
    } catch (const std::exception& e) {
        LOGGER(error) << e.what();
        return 1;
    }
}
