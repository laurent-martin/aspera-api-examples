

#include "test_environment.hpp"

#undef LOGGER
#define LOGGER(level) BOOST_LOG_SEV(test_env.log, boost::log::trivial::level)

int main(int argc, char* argv[]) {
    TestEnvironment test_env(argc, argv);

    YAML::Node config = test_env.config["server"];
    std::string sdk_url = config["url"].as<std::string>();
    LOGGER(info) << "Server URL: " << sdk_url;

    auto server_url = urls::parse_uri(sdk_url).value();
    assert(server_url.scheme == "ssh");

    // create V2 transfer spec
    json transferSpec = {
        {"title", "test with tspec V2"},
        {"remote_host", std::string(server_url.host())},
        {"session_initiation",
         {{"ssh",
           {{"ssh_port", std::stoi(std::string(server_url.port()))},
            {"remote_user", config["user"].as<std::string>()},
            {"remote_password", config["pass"].as<std::string>()}}}}},
        {"direction", "send"},
        {"assets",
         {{"destination_root", "/Upload"},
          {"paths", json::array()}}}};
    test_env.add_files_to_ts(transferSpec["assets"]["paths"]);
    test_env.start_transfer_and_wait(transferSpec);
    test_env.shutdown();
    return 0;
}
