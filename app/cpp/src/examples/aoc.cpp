#include <uuid/uuid.h>

#include <boost/beast.hpp>
#include <boost/json.hpp>
#include <iostream>
#include <stdexcept>
#include <string>

#include "utils/configuration.hpp"
#include "utils/rest.hpp"
#include "utils/transfer_client.hpp"

const std::string AOC_API_V1_BASE_URL = "https://api.ibmaspera.com/api/v1";
const std::string AOC_OAUTH_AUDIENCE = "https://api.asperafiles.com/api/v1/oauth2/token";
const std::string package_name = "sample package C++";
const int transfer_sessions = 1;

/// @brief Generate the transfer cookie of AoC, that identifies the application and the user.
/// @param app AoC application, e.g. `packages`
/// @param user_name name of the user
/// @param user_id identifier of the user: email
/// @return cookie
std::string generate_cookie(const std::string& app, const std::string& user_name, const std::string& user_id) {
    return "aspera.aoc:" + utils::base64_encode(app) + ":" + utils::base64_encode(user_name) + ":" + utils::base64_encode(user_id);
}

/// @brief Get the OAuth scope to access a node.
/// @param access_key access key of the node
/// @param scope scope on the node, e.g. `user:all`
/// @return OAuth scope
std::string node_scope(const std::string& access_key, const std::string& scope) {
    return std::string("node.") + access_key + ":" + scope;
}

int main(int argc, char* argv[]) {
    utils::Configuration config(argc, argv);
    utils::TransferClient transfer_client(config);
    try {
        utils::Rest aoc_api(AOC_API_V1_BASE_URL);
        aoc_api.set_auth_bearer(
            {{"token_url", AOC_API_V1_BASE_URL + "/oauth2/" + config.param_str({"aoc", "org"}) + "/token"},
             {"key_pem_path", config.param_str({"aoc", "private_key"})},
             {"client_id", config.param_str({"aoc", "client_id"})},
             {"client_secret", config.param_str({"aoc", "client_secret"})},
             {"iss", config.param_str({"aoc", "client_id"})},
             {"aud", AOC_OAUTH_AUDIENCE},
             {"sub", config.param_str({"aoc", "user_email"})},
             {"org", config.param_str({"aoc", "org"})}});
        aoc_api.set_default_scope("user:all");

        // Get user information
        LOGGER(info) << "Getting user information";
        json::object user_info = aoc_api.read("self").as_object();

        // Get workspace information
        std::string workspace_name = config.param_str({"aoc", "workspace"});
        LOGGER(info) << "Getting workspace: " << workspace_name;
        json::array response_data = aoc_api.read("workspaces", {{"q", workspace_name}}).as_array();
        if (response_data.size() != 1) {
            throw std::runtime_error("Found " + std::to_string(response_data.size()) + " workspaces for " + workspace_name);
        }
        json::object workspace_info = response_data[0].as_object();

        // Get dropbox (shared inbox) information
        std::string shared_inbox_name = config.param_str({"aoc", "shared_inbox"});
        LOGGER(info) << "Getting shared inbox: " << shared_inbox_name;
        response_data = aoc_api.read("dropboxes", {{"current_workspace_id", workspace_info["id"].as_string()}, {"q", shared_inbox_name}}).as_array();
        if (response_data.size() != 1) {
            throw std::runtime_error("Found " + std::to_string(response_data.size()) + " shared inboxes for " + shared_inbox_name);
        }
        json::object dropbox_info = response_data[0].as_object();

        // Create a new package
        LOGGER(info) << "Creating package";
        json::object package_info = aoc_api.create(
                                               "packages",
                                               {{"workspace_id", workspace_info["id"]},
                                                {"recipients", json::array{json::object{{"id", dropbox_info["id"]}, {"type", "dropbox"}}}},
                                                {"name", package_name},
                                                {"note", "My package note"}})
                                        .as_object();

        // Get node information
        LOGGER(info) << "Getting node information";
        json::object node_info = aoc_api.read("nodes/" + utils::attribute_str(package_info, "node_id")).as_object();

        // Set transfer expectations
        LOGGER(info) << "Setting expected transfers";
        aoc_api.update("packages/" + utils::attribute_str(package_info, "id"), {{"sent", true}, {"transfers_expected", transfer_sessions}});

        // Generate transfer spec
        json::object t_spec = {
            {"direction", "send"},
            {"token", aoc_api.get_bearer_token(node_scope(utils::attribute_str(node_info, "access_key"), "user:all"))},
            {"tags", json::object{
                         {"aspera", json::object{
                                        {"app", "packages"},
                                        {"files", json::object{
                                                      {"node_id", node_info["id"]},
                                                      {"package_id", package_info["id"]},
                                                      {"package_name", package_info["name"]},
                                                      {"package_operation", "upload"},
                                                      {"files_transfer_action", "upload_package"},
                                                      {"workspace_name", workspace_info["name"]},
                                                      {"workspace_id", workspace_info["id"]}}},
                                        {"node", json::object{{"access_key", node_info["access_key"]}, {"file_id", package_info["contents_file_id"]}}},
                                        {"usage_id", "aspera.files.workspace." + utils::attribute_str(workspace_info, "id")},
                                        {"xfer_id", utils::uuid_random()},
                                        {"xfer_retry", 3600}}}}},
            {"remote_host", node_info["host"]},
            {"remote_user", "xfer"},
            {"ssh_port", 33001},
            {"fasp_port", 33001},
            {"cookie", generate_cookie("packages", utils::attribute_str(user_info, "name"), utils::attribute_str(user_info, "email"))},
            {"create_dir", true},
            {"target_rate_kbps", 2000000},
            {"paths", json::array{}}};

        if (transfer_sessions != 1) {
            t_spec["multi_session"] = transfer_sessions;
            t_spec["multi_session_threshold"] = 500000;
        }

        // Add files to the transfer spec
        config.add_sources(t_spec, "paths");

        // Start the transfer
        LOGGER(info) << "Uploading files";
        transfer_client.transfer_start_and_wait(t_spec);
    } catch (const std::exception& e) {
        LOGGER(error) << e.what();
        return 1;
    }
    return 0;
}
