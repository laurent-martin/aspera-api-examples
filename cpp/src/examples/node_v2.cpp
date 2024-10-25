#include "utils/configuration.hpp"
#include "utils/rest.hpp"
#include "utils/transfer_client.hpp"

int main(const int argc, const char* const argv[]) {
    utils::Configuration config(argc, argv);
    utils::TransferClient transfer_client(config);
    try {
        const std::string node_api_url = config.param_str({"node", "url"});
        LOG(info) << LOG_ITEM("Node URL") << node_api_url;
        const std::string header_authorization = utils::Rest::basic_auth_header(config.param_str({"node", "username"}), config.param_str({"node", "password"}));
        json::object transfer_spec_v2 = {
            {"title", "send using Node API and ts v2"},
            {"session_initiation",
             {{"node_api",
               {{"url", node_api_url},
                {"headers",
                 json::array{
                     {{"key", "Authorization"},
                      {"value", header_authorization}}}}}}}},
            {"direction", "send"},
            {"assets",
             {{"destination_root", config.param_str({"node", "folder_upload"})},
              {"paths", json::array()}}}};
        config.add_sources(transfer_spec_v2, "assets.paths");
        transfer_client.transfer_start_and_wait(transfer_spec_v2);
        return 0;
    } catch (const std::exception& e) {
        std::clog << "Exception: " << e.what() << std::endl;
        return 1;
    }
}
