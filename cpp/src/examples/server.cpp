#include "utils/configuration.hpp"
#include "utils/transfer_client.hpp"

int main(int argc, char* argv[]) {
    utils::Configuration config(argc, argv);
    utils::TransferClient transfer_client(config);
    try {
        std::string server_url = config.param_str({"server", "url"});
        LOG(info) << LOG_ITEM("Server URL") << server_url;
        auto server_uri = boost::urls::parse_uri(server_url).value();
        assert(server_uri.scheme == "ssh");
        // create V2 transfer spec
        json::object transfer_spec = {
            {"title", "test with transfer spec V2"},
            {"remote_host", std::string(server_uri.host())},
            {"session_initiation",
             {{"ssh",
               {{"ssh_port", std::stoi(std::string(server_uri.port()))},
                {"remote_user", config.param_str({"server", "username"})},
                {"remote_password", config.param_str({"server", "password"})}}}}},
            {"direction", "send"},
            {"assets",
             {{"destination_root", config.param_str({"server", "folder_upload"})},
              {"paths", json::array()}}}};
        config.add_sources(transfer_spec, "assets.paths", true);
        transfer_client.transfer_start_and_wait(transfer_spec);
        return 0;
    } catch (const std::exception& e) {
        std::clog << "Exception: " << e.what() << std::endl;
        return 1;
    }
}
