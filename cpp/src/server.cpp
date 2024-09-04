#include "utils/tools.hpp"
#include "utils/transfer_client.hpp"

#define LOG(level) LOGGER(tools.log(), level)

int main(int argc, char* argv[]) {
    try {
        utils::Tools tools(argc, argv);
        utils::TransferClient transfer_client(tools);
        std::string server_url = tools.conf_str({"server", "url"});
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
                {"remote_user", tools.conf_str({"server", "user"})},
                {"remote_password", tools.conf_str({"server", "pass"})}}}}},
            {"direction", "send"},
            {"assets",
             {{"destination_root", tools.conf_str({"server", "folder_upload"})},
              {"paths", json::array()}}}};
        tools.add_files_to_ts(transfer_spec["assets"].as_object()["paths"].as_array(), true);
        transfer_client.start_transfer_and_wait(transfer_spec);
        return 0;
    } catch (const std::exception& e) {
        std::clog << "Exception: " << e.what() << std::endl;
        return 1;
    }
}
