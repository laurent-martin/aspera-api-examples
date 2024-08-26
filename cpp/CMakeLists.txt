cmake_minimum_required(VERSION 3.30)

project(LaurentSamples
  LANGUAGES C CXX
  )

set(CXX_STANDARD 17)

find_package(Boost CONFIG REQUIRED system log json)
message(STATUS "Using Boost ${Boost_VERSION}")
message(STATUS ">>Boost_INCLUDE_DIRS: ${Boost_INCLUDE_DIRS}")
message(STATUS ">>Boost_LIBRARIES: ${Boost_LIBRARIES}")

# BEGIN yaml-cpp
include(FetchContent)
FetchContent_Declare(
  yaml-cpp
  GIT_REPOSITORY https://github.com/jbeder/yaml-cpp.git
  GIT_TAG yaml-cpp-0.7.0
  )
FetchContent_MakeAvailable(yaml-cpp)
# END yaml-cpp

# BEGIN gRPC
# https://github.com/grpc/grpc/blob/master/examples/cpp/cmake/common.cmake
find_package(Threads REQUIRED)

# Find Protobuf installation
option(protobuf_MODULE_COMPATIBLE TRUE)
find_package(Protobuf CONFIG REQUIRED)
message(STATUS "Using protobuf ${Protobuf_VERSION}")

# Find gRPC installation
# Looks for gRPCConfig.cmake file installed by gRPC's cmake installation.
find_package(gRPC CONFIG REQUIRED)
message(STATUS "Using gRPC ${gRPC_VERSION}")

# Transfer SDK Proto file
get_filename_component(aspera_proto_dir "${aspera_proto_file}" DIRECTORY)
get_filename_component(aspera_proto_name "${aspera_proto_file}" NAME_WE)
set(grpc_gen_path "${CMAKE_CURRENT_BINARY_DIR}")

# Generated sources
set(aspera_proto_srcs "${grpc_gen_path}/${aspera_proto_name}.pb.cc")
set(aspera_proto_hdrs "${grpc_gen_path}/${aspera_proto_name}.pb.h")
set(aspera_grpc_srcs "${grpc_gen_path}/${aspera_proto_name}.grpc.pb.cc")
set(aspera_grpc_hdrs "${grpc_gen_path}/${aspera_proto_name}.grpc.pb.h")

# Generation command
add_custom_command(
  OUTPUT "${aspera_proto_srcs}" "${aspera_proto_hdrs}" "${aspera_grpc_srcs}" "${aspera_grpc_hdrs}"
  DEPENDS "${aspera_proto_file}"
  COMMAND protoc
  ARGS
  --plugin=protoc-gen-grpc=$<TARGET_FILE:gRPC::grpc_cpp_plugin>
  --grpc_out "${grpc_gen_path}"
  --cpp_out "${grpc_gen_path}"
  -I "${aspera_proto_dir}"
  "${aspera_proto_file}"
  )

# Location of *.pb.h files for includes, generated from proto file
include_directories("${grpc_gen_path}")

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

foreach(_target ${test_cases})
  add_executable(${_target} "src/${_target}.cpp")
  target_link_libraries(${_target}
    aspera_grpc_library
    yaml-cpp::yaml-cpp
    ${Boost_LIBRARIES}
    )
endforeach()
#    ${Boost_LIBRARIES}
