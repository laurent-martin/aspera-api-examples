
#include "test_environment.hpp"

#undef LOGGER
#define LOGGER(level) BOOST_LOG_SEV(test_env.log(), boost::log::trivial::level)

int main(int argc, char* argv[]) {
    TestEnvironment test_env(argc, argv);
    const std::string shares_api_url = test_env.conf_str({"shares", "url"}) + "/node_api";
    LOGGER(info) << "Shares API URL: " << shares_api_url;
    Rest shares_api(shares_api_url);
    shares_api.set_basic(test_env.conf_str({"shares", "user"}), test_env.conf_str({"shares", "pass"}));
    json::object upload_setup_request = json::object{
        {"transfer_requests", json::array{json::object{{"transfer_request", json::object{{"paths", json::array{json::object{{"destination", test_env.conf_str({"shares", "folder_upload"})}}}}}}}}}};
    json::object response_data = shares_api.post("files/upload_setup", upload_setup_request);
    json::object transfer_spec = response_data["transfer_specs"].as_array()[0].as_object()["transfer_spec"].as_object();
    test_env.add_files_to_ts(transfer_spec["paths"].as_array(), true);
    test_env.start_transfer_and_wait(transfer_spec);
    return 0;
}
