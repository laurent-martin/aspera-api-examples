cmake_minimum_required(VERSION 3.8)

project(LaurentSamples
  LANGUAGES C CXX
  )

set(CXX_STANDARD 17)

find_package(Boost REQUIRED)

include(FetchContent)

# BEGIN yaml-cpp
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
# END yaml-cpp

# BEGIN gRPC
# https://github.com/grpc/grpc/blob/master/examples/cpp/cmake/common.cmake
find_package(Threads REQUIRED)

# Find Protobuf installation
# Looks for protobuf-config.cmake file installed by Protobuf's cmake installation.
option(protobuf_MODULE_COMPATIBLE TRUE)
# include(FindProtobuf)
find_package(Protobuf CONFIG REQUIRED)
message(STATUS "Using protobuf ${Protobuf_VERSION}")

# Find gRPC installation
# Looks for gRPCConfig.cmake file installed by gRPC's cmake installation.
find_package(gRPC CONFIG REQUIRED)
message(STATUS "Using gRPC ${gRPC_VERSION}")

# Transfer SDK Proto file
get_filename_component(aspera_proto_file "../generated/trsdk/noarch/connectors/grpc/transfer.proto" ABSOLUTE)
get_filename_component(aspera_proto_dir "${aspera_proto_file}" DIRECTORY)
get_filename_component(aspera_proto_name "${aspera_proto_file}" NAME_WE)
set(generated_path "${CMAKE_CURRENT_BINARY_DIR}")

# Generated sources
set(aspera_proto_srcs "${generated_path}/${aspera_proto_name}.pb.cc")
set(aspera_proto_hdrs "${generated_path}/${aspera_proto_name}.pb.h")
set(aspera_grpc_srcs "${generated_path}/${aspera_proto_name}.grpc.pb.cc")
set(aspera_grpc_hdrs "${generated_path}/${aspera_proto_name}.grpc.pb.h")

# Generation command
add_custom_command(
  OUTPUT "${aspera_proto_srcs}" "${aspera_proto_hdrs}" "${aspera_grpc_srcs}" "${aspera_grpc_hdrs}"
  DEPENDS "${aspera_proto_file}"
  COMMAND protoc
  ARGS
  --plugin=protoc-gen-grpc=$<TARGET_FILE:gRPC::grpc_cpp_plugin>
  --grpc_out "${generated_path}"
  --cpp_out "${generated_path}"
  -I "${aspera_proto_dir}"
  "${aspera_proto_file}"
  )

# Location of generated *.pb.h files for includes
include_directories("${generated_path}")

add_library(aspera_grpc_library
  ${aspera_grpc_srcs}
  ${aspera_grpc_hdrs}
  ${aspera_proto_srcs}
  ${aspera_proto_hdrs}
  )
target_link_libraries(aspera_grpc_library
  absl::check
  protobuf::libprotobuf
  gRPC::grpc++
  gRPC::grpc++_reflection
  )
# END gRPC

foreach(_target server shares shares_v2)
  add_executable(${_target} "src/${_target}.cpp")
  target_link_libraries(${_target}
    aspera_grpc_library
    yaml-cpp::yaml-cpp
    boost::boost
    )
endforeach()
