
#include "utils/tools.hpp"
#include "utils/transfer_client.hpp"
#include "utils/rest_client.hpp"

#define LOG(level) LOGGER(tools.log(), level)

int main(int argc, char* argv[]) {
    try {
        utils::Tools tools(argc, argv);
        utils::TransferClient transfer_client(tools);
        const std::string shares_api_url = tools.conf_str({"shares", "url"}) + "/node_api";
        LOG(info) << "Shares API URL: " << shares_api_url;
        utils::RestClient shares_api(shares_api_url);
        shares_api.set_basic(tools.conf_str({"shares", "user"}), tools.conf_str({"shares", "pass"}));
        const std::string destination_folder_in_shares = tools.conf_str({"shares", "folder_upload"});
        // refer to:
        // https://developer.ibm.com/apis/catalog/aspera--aspera-node-api/api/API--aspera--ibm-aspera-node-api#post1924996167
        {
            LOG(info) << "=============== Shares Upload";
            json::object transfer_setup_request = json::object{
                {"transfer_requests", json::array{json::object{{"transfer_request", json::object{{"paths", json::array{json::object{{"destination", destination_folder_in_shares}}}}}}}}}};
            json::object response_data = shares_api.post("files/upload_setup", transfer_setup_request);
            json::object transfer_specification = response_data["transfer_specs"].as_array()[0].as_object()["transfer_spec"].as_object();
            tools.add_files_to_ts(transfer_specification["paths"].as_array());
            transfer_client.start_transfer_and_wait(transfer_specification);
        }
        {
            const std::string source_file_path_in_shares = destination_folder_in_shares + "/" + std::filesystem::path(argv[1]).filename().string();
            LOG(info) << "=============== Shares Download: " << source_file_path_in_shares;
            json::object transfer_setup_request = json::object{
                {"transfer_requests", json::array{json::object{{"transfer_request", json::object{{"paths", json::array{json::object{{"source", source_file_path_in_shares}}}}}}}}}};
            json::object response_data = shares_api.post("files/download_setup", transfer_setup_request);
            json::object transfer_specification = response_data["transfer_specs"].as_array()[0].as_object()["transfer_spec"].as_object();
            transfer_specification["destination_root"] = std::filesystem::temp_directory_path().string();
            transfer_client.start_transfer_and_wait(transfer_specification);
        }
        return 0;
    } catch (const std::exception& e) {
        std::clog << "Exception: " << e.what() << std::endl;
        return 1;
    }
}
