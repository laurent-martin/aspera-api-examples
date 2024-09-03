# BuildGrpc.make
# https://github.com/grpc/grpc/blob/master/examples/cpp/cmake/common.cmake

find_package(Protobuf CONFIG REQUIRED)
message(STATUS "Using protobuf ${Protobuf_VERSION}")
find_package(gRPC CONFIG REQUIRED)
message(STATUS "Using gRPC ${gRPC_VERSION}")

function(build_grpc_library proto_file target_library)
    # Get path and name from Aspera Transfer SDK Proto file
    get_filename_component(proto_dir "${proto_file}" DIRECTORY)
    get_filename_component(proto_name "${proto_file}" NAME_WE)

    # Generated sources
    set(grpc_gen_path "${CMAKE_CURRENT_BINARY_DIR}/grpc_gen_src")
    file(MAKE_DIRECTORY ${grpc_gen_path})
    set(proto_sources "${grpc_gen_path}/${proto_name}.pb.cc")
    set(proto_headers "${grpc_gen_path}/${proto_name}.pb.h")
    set(grpc_sources "${grpc_gen_path}/${proto_name}.grpc.pb.cc")
    set(grpc_headers "${grpc_gen_path}/${proto_name}.grpc.pb.h")

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
        --proto_path "${proto_dir}"
        "${proto_file}"
    OUTPUT
        "${proto_sources}" "${proto_headers}" "${grpc_sources}" "${grpc_headers}"
    DEPENDS
        "${proto_file}"
    )

    # Create the client library
    add_library(${target_library} ${grpc_sources} ${proto_sources})
    target_link_libraries(${target_library} protobuf::libprotobuf gRPC::grpc++)
endfunction()
