#include "test_environment.hpp"
#undef LOGGER
#define LOGGER(level) BOOST_LOG_SEV(test_env.log(), boost::log::trivial::level)
int main(int argc, char* argv[]) {
    TestEnvironment test_env(argc, argv);
    const std::string node_api_url = test_env.conf_str({"node", "url"});
    json::object transfer_spec_v2 = json::object{
        {"title", "send using Node API and ts v2"},
        {"session_initiation", json::object{{"node_api",
                                             {{"url", node_api_url},
                                              {
                                                  "headers",
                                                  json::array{{{"key", "Authorization"},
                                                               {"value", TestEnvironment::basic_auth_header(test_env.conf_str({"node", "user"}), test_env.conf_str({"node", "pass"}))}}},
                                              }}}}},
        {"direction", "send"},
        {"assets", json::object{{"destination_root", test_env.conf_str({"node", "folder_upload"})},
                                {"paths", json::array()}}}};
    test_env.add_files_to_ts(transfer_spec_v2["assets"].as_object()["paths"].as_array(), true);
    test_env.start_transfer_and_wait(transfer_spec_v2);
    return 0;
}
