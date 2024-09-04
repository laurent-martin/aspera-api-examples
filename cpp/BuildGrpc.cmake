# BuildGrpc.make
# https://github.com/grpc/grpc/blob/master/examples/cpp/cmake/common.cmake

# Function to build a gRPC library
# @param proto_file: Path to the Proto file
# @param target_library: Name of the target library
# @param generate: Generate the sources
# @param src_dir: Source directory where already generated sources are located
function(build_grpc_library target_library proto_file generate src_dir)
    message(STATUS "target_library: ${target_library}")
    message(STATUS "proto_file: ${proto_file}")
    message(STATUS "generate: ${generate}")
    message(STATUS "src_dir: ${src_dir}")

    # Get Proto file path and name
    get_filename_component(proto_dir "${proto_file}" DIRECTORY)
    get_filename_component(proto_name "${proto_file}" NAME_WE)

    if(${generate})
        message(STATUS "Generating sources for ${proto_file}")
        # Create the source directory where files will be generated
        set(src_dir "${CMAKE_CURRENT_BINARY_DIR}/grpc_gen_src")
        file(MAKE_DIRECTORY "${src_dir}")
    else()
        message(STATUS "Usingprovided sources in ${src_dir}")
    endif()

    # Generated sources paths
    set(protobuf_source "${src_dir}/${proto_name}.pb.cc")
    set(protobuf_header "${src_dir}/${proto_name}.pb.h")
    set(grpc_source "${src_dir}/${proto_name}.grpc.pb.cc")
    set(grpc_header "${src_dir}/${proto_name}.grpc.pb.h")

    # Find *.pb.h files generated from proto file
    include_directories("${src_dir}")

    if(${generate})
        # Generation command
        add_custom_command(
        COMMAND
            protoc
        ARGS
            --plugin=protoc-gen-grpc=$<TARGET_FILE:gRPC::grpc_cpp_plugin>
            --grpc_out "${src_dir}"
            --cpp_out "${src_dir}"
            --proto_path "${proto_dir}"
            "${proto_file}"
        OUTPUT
            "${protobuf_source}" "${protobuf_header}" "${grpc_source}" "${grpc_header}"
        DEPENDS
            "${proto_file}"
        )
    endif()

    # Create the client library
    add_library(${target_library} ${grpc_source} ${protobuf_source})
    target_link_libraries(${target_library} protobuf::libprotobuf gRPC::grpc++)
endfunction()
