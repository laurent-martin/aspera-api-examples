cmake_minimum_required(VERSION 3.8)

project(LaurentSamples
        LANGUAGES C CXX)

set(CXX_STANDARD 17)

include(FetchContent)

FetchContent_Declare(
  yaml-cpp
  GIT_REPOSITORY https://github.com/jbeder/yaml-cpp.git
  GIT_TAG yaml-cpp-0.7.0
)
FetchContent_GetProperties(yaml-cpp)

if(NOT yaml-cpp_POPULATED)
  message(STATUS "Fetching yaml-cpp...")
  FetchContent_Populate(yaml-cpp)
  add_subdirectory(${yaml-cpp_SOURCE_DIR} ${yaml-cpp_BINARY_DIR})
endif()


find_package(Boost REQUIRED)

# BEGIN gRPC
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
get_filename_component(aspera_proto "../generated/trsdk/noarch/connectors/grpc/transfer.proto" ABSOLUTE)
get_filename_component(aspera_proto_path "${aspera_proto}" PATH)

# Generated sources
set(aspera_proto_srcs "${CMAKE_CURRENT_BINARY_DIR}/transfer.pb.cc")
set(aspera_proto_hdrs "${CMAKE_CURRENT_BINARY_DIR}/transfer.pb.h")
set(aspera_grpc_srcs "${CMAKE_CURRENT_BINARY_DIR}/transfer.grpc.pb.cc")
set(aspera_grpc_hdrs "${CMAKE_CURRENT_BINARY_DIR}/transfer.grpc.pb.h")
add_custom_command(
  OUTPUT "${aspera_proto_srcs}" "${aspera_proto_hdrs}" "${aspera_grpc_srcs}" "${aspera_grpc_hdrs}"
  COMMAND protoc
  ARGS --grpc_out "${CMAKE_CURRENT_BINARY_DIR}"
  --cpp_out "${CMAKE_CURRENT_BINARY_DIR}"
  -I "${aspera_proto_path}"
  --plugin=protoc-gen-grpc=$<TARGET_FILE:gRPC::grpc_cpp_plugin>
  "${aspera_proto}"
  DEPENDS "${aspera_proto}")

# Include generated *.pb.h files
include_directories("${CMAKE_CURRENT_BINARY_DIR}")

add_library(aspera_grpc_library
  ${aspera_grpc_srcs}
  ${aspera_grpc_hdrs}
  ${aspera_proto_srcs}
  ${aspera_proto_hdrs})
target_link_libraries(aspera_grpc_library
  absl::check
  gRPC::grpc++_reflection
  gRPC::grpc++
  protobuf::libprotobuf)
# END gRPC

foreach(_target server)
  add_executable(${_target} "src/${_target}.cpp")
  target_link_libraries(${_target}
    nlohmann_json::nlohmann_json
    yaml-cpp::yaml-cpp
    aspera_grpc_library
    boost::boost
    )
endforeach()
