
#include "utils/configuration.hpp"
#include "utils/rest.hpp"
#include "utils/transfer_client.hpp"

int main(int argc, char* argv[]) {
    utils::Configuration config(argc, argv);
    utils::TransferClient transfer_client(config);
    try {
        const std::string shares_api_url = config.param_str({"shares", "url"}) + "/node_api";
        LOG(info) << "Shares API URL: " << shares_api_url;
        utils::Rest shares_api(shares_api_url);
        shares_api.set_auth_basic(config.param_str({"shares", "username"}), config.param_str({"shares", "password"}));
        const std::string destination_folder_in_shares = config.param_str({"shares", "folder_upload"});
        // refer to:
        // https://developer.ibm.com/apis/catalog/aspera--aspera-node-api/api/API--aspera--ibm-aspera-node-api#post1924996167
        {
            LOG(info) << "=============== Shares Upload";
            json::object transfer_setup_request = json::object{
                {"transfer_requests", json::array{json::object{{"transfer_request", json::object{{"paths", json::array{json::object{{"destination", destination_folder_in_shares}}}}}}}}}};
            json::object response_data = shares_api.create("files/upload_setup", transfer_setup_request).as_object();
            json::object transfer_specification = response_data.at("transfer_specs").as_array()[0].as_object().at("transfer_spec").as_object();
            config.add_sources(transfer_specification, "paths");
            transfer_client.transfer_start_and_wait(transfer_specification);
        }
        {
            const std::string source_file_path_in_shares = destination_folder_in_shares + "/" + std::filesystem::path(argv[1]).filename().string();
            LOG(info) << "=============== Shares Download: " << source_file_path_in_shares;
            json::object transfer_setup_request = json::object{
                {"transfer_requests", json::array{json::object{{"transfer_request", json::object{{"paths", json::array{json::object{{"source", source_file_path_in_shares}}}}}}}}}};
            json::object response_data = shares_api.create("files/download_setup", transfer_setup_request).as_object();
            json::object transfer_specification = response_data.at("transfer_specs").as_array()[0].as_object().at("transfer_spec").as_object();
            transfer_specification.at("destination_root") = std::filesystem::temp_directory_path().string();
            transfer_client.transfer_start_and_wait(transfer_specification);
        }
        return 0;
    } catch (const std::exception& e) {
        std::clog << "Exception: " << e.what() << std::endl;
        return 1;
    }
}
