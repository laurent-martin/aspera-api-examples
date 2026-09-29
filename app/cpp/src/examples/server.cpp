#include "utils/configuration.hpp"
#include "utils/transfer_client.hpp"

int main(int argc, char* argv[]) {
    utils::Configuration config(argc, argv);
    utils::TransferClient transfer_client(config);
    try {
        std::string server_url = config.param_str({"server", "url"});
        auto server_uri = boost::urls::parse_uri(server_url).value();
        if (server_uri.scheme() != "ssh") {
            throw std::runtime_error("Expecting SSH URL: " + server_url);
        }
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
        LOGGER(info) << "Uploading files";
        transfer_client.transfer_start_and_wait(transfer_spec);
        return 0;
    } catch (const std::exception& e) {
        LOGGER(error) << e.what();
        return 1;
    }
}
