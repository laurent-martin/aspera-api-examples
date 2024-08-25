#include "test_environment.hpp"
#undef LOGGER
#define LOGGER(level) BOOST_LOG_SEV(test_env.log(), boost::log::trivial::level)
int main(int argc, char* argv[]) {
    TestEnvironment test_env(argc, argv);
    const std::string shares_api_url = test_env.conf_str({"shares", "url"}) + "/node_api";
    LOGGER(info) << "Shares API URL: " << shares_api_url;
    // create V2 transfer spec
    json::object transfer_spec = json::object{
        {"title", "send using Node API and ts v2"},
        {"session_initiation", json::object{{"node_api",
                                             {{"url", shares_api_url},
                                              {
                                                  "headers",
                                                  json::array{{{"key", "Authorization"},
                                                               {"value", TestEnvironment::basic_auth_header(test_env.conf_str({"shares", "user"}), test_env.conf_str({"shares", "pass"}))}}},
                                              }}}}},
        {"direction", "send"},
        {"assets", json::object{{"destination_root", test_env.conf_str({"shares", "folder_upload"})},
                                {"paths", json::array()}}}};
    test_env.add_files_to_ts(transfer_spec["assets"].as_object()["paths"].as_array(), true);
    test_env.start_transfer_and_wait(transfer_spec);
    return 0;
}
