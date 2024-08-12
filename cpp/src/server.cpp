

#include "test_environment.hpp"

int main(int argc, char* argv[]) {
    // generate example file for transfer
    const std::string filePath = GenerateSourceFile();

    // create transfer spec object
    json transferSpec = {
        {"title", "strategic"},
        {"session_initiation",
         {{"ssh",
           {{"ssh_port", 33001},
            {"remote_user", "aspera"},
            {"remote_password", "demoaspera"}}}}},
        {"direction", "send"},
        {"remote_host", "demo.asperasoft.com"},
        {"assets",  //
         {
             {"destination_root", "/Upload"},
             {"paths", json::array({{{"source", filePath}}})}}}};

    start_transfer_and_wait(transferSpec);

    return 0;
}
