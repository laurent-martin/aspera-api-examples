# Build samples
# @param sdk_cpp_dir: Path to the SDK source directory
# @param aspera_proto_file: Path to the Aspera Proto file
# @param test_cases: List of test cases

# cspell:ignore protoc absl libprotobuf protobuf
cmake_minimum_required(VERSION 3.28)

project(LaurentSamples LANGUAGES C CXX)

set(CXX_STANDARD 17)

find_package(Boost CONFIG REQUIRED json beast asio uuid)
message(STATUS "Using Boost ${Boost_VERSION}")
find_package(magic_enum CONFIG REQUIRED)
message(STATUS "Using magic_enum ${magic_enum_VERSION}")
find_package(yaml-cpp CONFIG REQUIRED)
message(STATUS "Using yaml-cpp ${yaml-cpp_VERSION}")
find_package(Protobuf CONFIG REQUIRED)
message(STATUS "Using protobuf ${Protobuf_VERSION}")
find_package(gRPC CONFIG REQUIRED)
message(STATUS "Using gRPC ${gRPC_VERSION}")
find_package(openssl CONFIG REQUIRED)
message(STATUS "Using openssl ${openssl_VERSION}")

# Create the source directory where files will be gen_out
set(gen_src_dir "${CMAKE_CURRENT_BINARY_DIR}/grpc_gen_src")
file(MAKE_DIRECTORY "${gen_src_dir}")

# Find *.pb.h files generated from proto file
include_directories("${gen_src_dir}")

include(${CMAKE_SOURCE_DIR}/BuildGrpc.cmake)

# if variable sdk_cpp_dir is set, use the sources provided in the SDK source directory
# otherwise, generate the sources
if(${sdk_cpp_dir})
  message(STATUS "Using sources provided in ${sdk_cpp_dir}")
  get_grpc_file_lists(sdk "${aspera_proto_file}" "${sdk_cpp_dir}")
  # Copy the sources from the SDK source directory
  foreach(_file ${sdk_files})
    message(STATUS "Copying ${_file} to ${gen_src_dir}")
    file(COPY ${_file} DESTINATION ${gen_src_dir})
  endforeach()
  get_grpc_file_lists(gen_out "${aspera_proto_file}" "${gen_src_dir}")
else()
  message(STATUS "Generating sources for ${aspera_proto_file}")
  target_grpc_library(gen_out "${aspera_proto_file}" ${gen_src_dir})
endif()

# Create the client library
add_library(aspera_client ${gen_out_sources})
target_link_libraries(aspera_client protobuf::libprotobuf gRPC::grpc++)

include_directories("src")

foreach(_target ${test_cases})
  add_executable(${_target} "${examples_dir}${_target}.cpp")
  target_link_libraries(${_target}
    aspera_client
    ${yaml-cpp_LIBRARIES}
    ${magic_enum_LIBRARIES}
    ${openssl_LIBRARIES}
    ${Boost_LIBRARIES}
    )
endforeach()
# 