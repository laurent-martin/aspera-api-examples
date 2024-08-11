cmake_minimum_required(VERSION 3.8)

project(LaurentSample 
        LANGUAGES C CXX)

set(CXX_STANDARD 17)

include(grpc_common.cmake)

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
      COMMAND ${_PROTOBUF_PROTOC}
      ARGS --grpc_out "${CMAKE_CURRENT_BINARY_DIR}"
        --cpp_out "${CMAKE_CURRENT_BINARY_DIR}"
        -I "${hw_proto_path}"
        --plugin=protoc-gen-grpc="${_GRPC_CPP_PLUGIN_EXECUTABLE}"
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
  ${_REFLECTION}
  ${_GRPC_GRPCPP}
  ${_PROTOBUF_LIBPROTOBUF})

#    nlohmann_json::nlohmann_json
# Targets greeter_[async_](client|server)
foreach(_target regular_file_example)
  add_executable(${_target} "src/${_target}.cpp")
  target_link_libraries(${_target}
    hw_grpc_proto
    absl::check
    absl::flags
    absl::flags_parse
    absl::log
    ${_REFLECTION}
    ${_GRPC_GRPCPP}
    ${_PROTOBUF_LIBPROTOBUF})
endforeach()
