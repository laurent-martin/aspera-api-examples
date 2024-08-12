cmake_minimum_required(VERSION 3.8)

project(LaurentSample 
        LANGUAGES C CXX)

set(CXX_STANDARD 17)

# https://github.com/grpc/grpc/blob/master/examples/cpp/cmake/common.cmake
find_package(Threads REQUIRED)

# Find Protobuf installation
# Looks for protobuf-config.cmake file installed by Protobuf's cmake installation.
option(protobuf_MODULE_COMPATIBLE TRUE)
find_package(Protobuf CONFIG REQUIRED)
message(STATUS "Using protobuf ${Protobuf_VERSION}")

# Find gRPC installation
# Looks for gRPCConfig.cmake file installed by gRPC's cmake installation.
find_package(gRPC CONFIG REQUIRED)
message(STATUS "Using gRPC ${gRPC_VERSION}")

find_package(nlohmann_json CONFIG REQUIRED)
# Proto file
get_filename_component(hw_proto "../generated/trsdk/noarch/connectors/grpc/transfer.proto" ABSOLUTE)
get_filename_component(hw_proto_path "${hw_proto}" PATH)

# Generated sources
set(hw_proto_srcs "${CMAKE_CURRENT_BINARY_DIR}/transfer.pb.cc")
set(hw_proto_hdrs "${CMAKE_CURRENT_BINARY_DIR}/transfer.pb.h")
set(hw_grpc_srcs "${CMAKE_CURRENT_BINARY_DIR}/transfer.grpc.pb.cc")
set(hw_grpc_hdrs "${CMAKE_CURRENT_BINARY_DIR}/transfer.grpc.pb.h")
add_custom_command(
  OUTPUT "${hw_proto_srcs}" "${hw_proto_hdrs}" "${hw_grpc_srcs}" "${hw_grpc_hdrs}"
  COMMAND protoc
  ARGS --grpc_out "${CMAKE_CURRENT_BINARY_DIR}"
  --cpp_out "${CMAKE_CURRENT_BINARY_DIR}"
  -I "${hw_proto_path}"
  --plugin=protoc-gen-grpc=$<TARGET_FILE:gRPC::grpc_cpp_plugin>
  "${hw_proto}"
  DEPENDS "${hw_proto}")

# Include generated *.pb.h files
include_directories("${CMAKE_CURRENT_BINARY_DIR}")

# hw_grpc_proto
add_library(hw_grpc_proto
  ${hw_grpc_srcs}
  ${hw_grpc_hdrs}
  ${hw_proto_srcs}
  ${hw_proto_hdrs})
target_link_libraries(hw_grpc_proto
  absl::check
  gRPC::grpc++_reflection
  gRPC::grpc++
  protobuf::libprotobuf)
#    nlohmann_json::nlohmann_json

foreach(_target server)
  add_executable(${_target} "src/${_target}.cpp")
  target_link_libraries(${_target}
    nlohmann_json::nlohmann_json
    hw_grpc_proto
    absl::check
    absl::flags
    absl::flags_parse
    absl::log
    gRPC::grpc++_reflection
    gRPC::grpc++
    protobuf::libprotobuf)
endforeach()
