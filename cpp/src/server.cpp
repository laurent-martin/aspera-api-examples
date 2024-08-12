

#include "test_environment.hpp"

#include <nlohmann/json.hpp>

int main() {
    // generate example file for transfer
    const std::string filePath = GenerateSourceFile();

    // create transfer spec string
    const std::string transferSpec =
        "{"
        "  \"session_initiation\": {"
        "    \"ssh\": {"
        "      \"ssh_port\": 33001,"
        "      \"remote_user\": \"aspera\","
        "      \"remote_password\": \"demoaspera\""
        "    }"
        "  },"
        "  \"direction\": \"send\","
        "  \"remote_host\": \"demo.asperasoft.com\","
        "  \"title\": \"strategic\","
        "  \"assets\": {"
        "    \"destination_root\": \"/Upload\","
        "    \"paths\": ["
        "      {"
        "        \"source\": \"" +
        filePath +
        "\""
        "      }"
        "    ]"
        "  }"
        "}";

    start_transfer_and_wait(transferSpec);

    return 0;
}
