#include "test_environment.hpp"
#undef LOGGER
#define LOGGER(level) BOOST_LOG_SEV(test_env.log(), boost::log::trivial::level)
int main(int argc, char* argv[]) {
    TestEnvironment test_env(argc, argv);
    std::string shares_api_url = test_env.conf_str({"shares", "url"}) + "/node_api";
    LOGGER(info) << "Shares API URL: " << shares_api_url;
    auto shares_uri = boost::urls::parse_uri(shares_api_url).value();
    // create V2 transfer spec
    json transferSpec = {
        {"title", "send using Node API and ts v2"},
        {"session_initiation",
         {{"node_api",
           {{"url", shares_api_url},
            {
                "headers",
                json::array({{
                    {"key", "Authorization"},
                    {"value", TestEnvironment::basic_auth_header(test_env.conf_str({"shares", "user"}), test_env.conf_str({"shares", "pass"}))}  //
                }}),
            }}}}},
        {"direction", "send"},
        {"assets",
         {{"destination_root", test_env.conf_str({"shares", "share"})},
          {"paths", json::array()}}}};
    test_env.add_files_to_ts(transferSpec["assets"]["paths"], true);
    test_env.start_transfer_and_wait(transferSpec);
    return 0;
}
