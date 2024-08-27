#include "utils/test_environment.hpp"
#define LOG(level) LOGGER(test_env.log(), level)
int main(int argc, char* argv[]) {
    try {
        utils::TestEnvironment test_env(argc, argv);
        std::string server_url = test_env.conf_str({"server", "url"});
        LOG(info) << "Server URL: " << server_url;
        auto server_uri = boost::urls::parse_uri(server_url).value();
        assert(server_uri.scheme == "ssh");
        // create V2 transfer spec
        json::object transfer_spec = json::object{
            {"title", "test with transfer spec V2"},
            {"remote_host", std::string(server_uri.host())},
            {"session_initiation",
             json::object{{"ssh",
                           json::object{{"ssh_port", std::stoi(std::string(server_uri.port()))},
                                        {"remote_user", test_env.conf_str({"server", "user"})},
                                        {"remote_password", test_env.conf_str({"server", "pass"})}}}}},
            {"direction", "send"},
            {"assets",
             json::object{{"destination_root", test_env.conf_str({"server", "folder_upload"})},
                          {"paths", json::array()}}}};
        test_env.add_files_to_ts(transfer_spec["assets"].as_object()["paths"].as_array(), true);
        test_env.start_transfer_and_wait(transfer_spec);
        return 0;
    } catch (const std::exception& e) {
        std::clog << "Exception: " << e.what() << std::endl;
        return 1;
    }
}
