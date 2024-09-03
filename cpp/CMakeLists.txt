# cspell:ignore protoc absl libprotobuf protobuf
cmake_minimum_required(VERSION 3.28)

project(LaurentSamples
  LANGUAGES
    C CXX
  )

set(CXX_STANDARD 17)

find_package(Boost CONFIG REQUIRED)
message(STATUS "Using Boost ${Boost_VERSION}")
find_package(magic_enum CONFIG REQUIRED)
message(STATUS "Using magic_enum ${magic_enum_VERSION}")
find_package(yaml-cpp CONFIG REQUIRED)
message(STATUS "Using yaml-cpp ${yaml-cpp_VERSION}")

include(${CMAKE_SOURCE_DIR}/BuildGrpc.cmake)
build_grpc_library("${aspera_proto_file}" aspera_client)

foreach(_target ${test_cases})
  add_executable(${_target} "src/${_target}.cpp")
  target_link_libraries(${_target} aspera_client yaml-cpp::yaml-cpp magic_enum::magic_enum ${Boost_LIBRARIES})
endforeach()
