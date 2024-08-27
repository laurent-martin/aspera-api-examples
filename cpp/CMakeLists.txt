# cspell:ignore protoc absl libprotobuf protobuf
cmake_minimum_required(VERSION 3.30)

project(LaurentSamples
  LANGUAGES
    C CXX
  )

set(CXX_STANDARD 17)

find_package(yaml-cpp CONFIG REQUIRED)
message(STATUS "Using yaml-cpp ${yaml-cpp_VERSION}")
find_package(Boost CONFIG REQUIRED)
message(STATUS "Using Boost ${Boost_VERSION}")
find_package(Protobuf CONFIG REQUIRED)
message(STATUS "Using protobuf ${Protobuf_VERSION}")
find_package(gRPC CONFIG REQUIRED)
message(STATUS "Using gRPC ${gRPC_VERSION}")
find_package(magic_enum CONFIG REQUIRED)
# BEGIN Aspera Transfer SDK Daemon Client Library
# https://github.com/grpc/grpc/blob/master/examples/cpp/cmake/common.cmake

# Get path and name from Aspera Transfer SDK Proto file
get_filename_component(aspera_proto_dir "${aspera_proto_file}" DIRECTORY)
get_filename_component(aspera_proto_name "${aspera_proto_file}" NAME_WE)

# Generated sources
set(grpc_gen_path "${CMAKE_CURRENT_BINARY_DIR}/aspera_client")
file(MAKE_DIRECTORY ${grpc_gen_path})
set(aspera_proto_sources "${grpc_gen_path}/${aspera_proto_name}.pb.cc")
set(aspera_proto_headers "${grpc_gen_path}/${aspera_proto_name}.pb.h")
set(aspera_grpc_sources "${grpc_gen_path}/${aspera_proto_name}.grpc.pb.cc")
set(aspera_grpc_headers "${grpc_gen_path}/${aspera_proto_name}.grpc.pb.h")

# Find *.pb.h files generated from proto file
include_directories("${grpc_gen_path}")

# Generation command
add_custom_command(
  COMMAND
    protoc
  ARGS
    --plugin=protoc-gen-grpc=$<TARGET_FILE:gRPC::grpc_cpp_plugin>
    --grpc_out "${grpc_gen_path}"
    --cpp_out "${grpc_gen_path}"
    --proto_path "${aspera_proto_dir}"
    "${aspera_proto_file}"
  OUTPUT
    "${aspera_proto_sources}" "${aspera_proto_headers}" "${aspera_grpc_sources}" "${aspera_grpc_headers}"
  DEPENDS
    "${aspera_proto_file}"
  )

# Create the client library
add_library(aspera_grpc_library ${aspera_grpc_sources} ${aspera_proto_sources})
target_link_libraries(aspera_grpc_library protobuf::libprotobuf gRPC::grpc++)
# END Aspera Transfer SDK Daemon Client Library

foreach(_target ${test_cases})
  add_executable(${_target} "src/${_target}.cpp")
  target_link_libraries(${_target} aspera_grpc_library yaml-cpp::yaml-cpp magic_enum::magic_enum ${Boost_LIBRARIES})
endforeach()
