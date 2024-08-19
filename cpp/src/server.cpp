#include "test_environment.hpp"
#undef LOGGER
#define LOGGER(level) BOOST_LOG_SEV(test_env.log(), boost::log::trivial::level)
int main(int argc, char* argv[]) {
    TestEnvironment test_env(argc, argv);
    std::string sdk_url = test_env.conf_str({"server","url"});
    LOGGER(info) << "Server URL: " << sdk_url;
    auto server_uri = boost::urls::parse_uri(sdk_url).value();
    assert(server_uri.scheme == "ssh");
    // create V2 transfer spec
    json transferSpec = {
        {"title", "test with transfer spec V2"},
        {"remote_host", std::string(server_uri.host())},
        {"session_initiation",
         {{"ssh",
           {{"ssh_port", std::stoi(std::string(server_uri.port()))},
            {"remote_user", test_env.conf_str({"server","user"})},
            {"remote_password", test_env.conf_str({"server","pass"})}}}}},
        {"direction", "send"},
        {"assets",
         {{"destination_root", test_env.conf_str({"server","folder_upload"})},
          {"paths", json::array()}}}};
    test_env.add_files_to_ts(transferSpec["assets"]["paths"]);
    test_env.start_transfer_and_wait(transferSpec);
    test_env.shutdown();
    return 0;
}
