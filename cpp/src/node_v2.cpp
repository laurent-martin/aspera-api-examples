#include "utils/rest.hpp"
#include "utils/test_environment.hpp"

int main(const int argc, const char* const argv[]) {
    try {
        utils::TestEnvironment test_env(argc, argv);
        const std::string node_api_url = test_env.conf_str({"node", "url"});
        json::object transfer_spec_v2 = json::object{
            {"title", "send using Node API and ts v2"},
            {"session_initiation", json::object{
                                       {"node_api",
                                        {{"url", node_api_url},
                                         {
                                             "headers",
                                             json::array{{{"key", "Authorization"},
                                                          {"value", utils::Rest::basic_auth_header(test_env.conf_str({"node", "user"}), test_env.conf_str({"node", "pass"}))}}},
                                         }}}}},
            {"direction", "send"},
            {"assets", json::object{{"destination_root", test_env.conf_str({"node", "folder_upload"})}, {"paths", json::array()}}}};
        test_env.add_files_to_ts(transfer_spec_v2["assets"].as_object()["paths"].as_array(), false);
        test_env.start_transfer_and_wait(transfer_spec_v2);
        return 0;
    } catch (const std::exception& e) {
        std::clog << "Exception: " << e.what() << std::endl;
        return 1;
    }
}
