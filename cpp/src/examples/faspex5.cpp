#include <iostream>
#include <stdexcept>
#include <string>

#include "utils/configuration.hpp"
#include "utils/rest.hpp"
#include "utils/transfer_client.hpp"

const std::string F5_API_PATH_V5 = "/api/v5";
const std::string F5_API_PATH_TOKEN = "/auth/token";
const std::string package_name = "sample package";
const int transfer_sessions = 1;  // Typically, 1

int main(const int argc, const char* const argv[]) {
    utils::Configuration config(argc, argv);
    utils::TransferClient transfer_client(config);
    try {
        // Create the REST client for the Faspex 5 API
        std::string faspex_url = config.param_str({"faspex5", "url"}) + F5_API_PATH_V5;
        utils::Rest f5_api(faspex_url);
        f5_api.set_verify(config.param_bool({"faspex5", "verify"}, true));

        // Set up bearer token authentication
        f5_api.set_auth_bearer(  //
            {{"token_url", config.param_str({"faspex5", "url"}) + F5_API_PATH_TOKEN},
             {"key_pem_path", config.param_str({"faspex5", "private_key"})},
             {"client_id", config.param_str({"faspex5", "client_id"})},
             {"client_secret", config.param_str({"faspex5", "client_secret"})},
             {"iss", config.param_str({"faspex5", "client_id"})},
             {"aud", config.param_str({"faspex5", "client_id"})},
             {"sub", "user:" + config.param_str({"faspex5", "username"})}});

        f5_api.set_default_scope("");

        // Create a new package with Faspex 5 API
        LOG(info) << "Creating package: " << package_name;
        json::object package_info = f5_api.create(
            "packages",
            {{"title", package_name},
             {"recipients", json::array{
                                json::object{
                                    {"name", config.param_str({"faspex5", "username"})}}}}}).as_object();
        LOG(debug) << package_info;

        // Build payload to specify files to send
        json::object upload_request = json::object{};
        config.add_sources(upload_request, "paths");

        LOG(info) << "Getting transfer spec";
        std::ostringstream endpoint;
        endpoint << "packages/" << package_info.at("id").as_string().c_str() << "/transfer_spec/upload";
        LOG(info) << ">>>>>>" << endpoint.str();
        json::object t_spec = f5_api.create(endpoint.str(), upload_request, {{"transfer_type", "connect"}}).as_object();

        // Optional: Multi session
        if (transfer_sessions != 1) {
            t_spec.at("multi_session") = transfer_sessions;
            t_spec.at("multi_session_threshold") = 500000;
        }

        // Add file list in transfer spec
        config.add_sources(t_spec, "paths");

        // Not used in transfer sdk
        t_spec.erase("authentication");

        // Finally, send files to package folder on server
        transfer_client.transfer_start_and_wait(t_spec);
        return 0;
    } catch (const std::exception& e) {
        std::clog << "Exception: " << e.what() << std::endl;
        return 1;
    }
}
