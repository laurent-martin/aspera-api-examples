# BuildGrpc.make
# https://github.com/grpc/grpc/blob/master/examples/cpp/cmake/common.cmake

# Function to get generated file lists for a gRPC library
# @param base_name: Base name for variables
# @param proto_file: Path to the Proto file
# @param folder: Folder where the generated files are
function(get_grpc_file_lists base_name proto_file folder)
    get_filename_component(proto_name "${proto_file}" NAME_WE)
    set(sources
        "${folder}/${proto_name}.pb.cc"
        "${folder}/${proto_name}.grpc.pb.cc"
    )
    set(headers
        "${folder}/${proto_name}.pb.h"
        "${folder}/${proto_name}.grpc.pb.h"
    )
    set(${base_name}_sources ${sources} PARENT_SCOPE)
    set(${base_name}_headers ${headers} PARENT_SCOPE)
    set(${base_name}_files ${sources} ${headers} PARENT_SCOPE)
endfunction()

# Function to build a gRPC library
# @param base_name: Base name for variables
# @param proto_file: Path to the Proto file
# @param target_folder: Destination folder where to generate sources
function(target_grpc_library base_name proto_file target_folder)
    message(STATUS "   proto_file: ${proto_file}")
    message(STATUS "target_folder: ${target_folder}")

    # Get Proto file path and name
    get_filename_component(proto_dir "${proto_file}" DIRECTORY)

    get_grpc_file_lists(generated "${proto_file}" ${target_folder})

    # Generation command
    add_custom_command(
    COMMAND
        protoc
    ARGS
        --plugin=protoc-gen-grpc=$<TARGET_FILE:gRPC::grpc_cpp_plugin>
        --grpc_out "${target_folder}"
        --cpp_out "${target_folder}"
        --proto_path "${proto_dir}"
        "${proto_file}"
    OUTPUT
        ${generated_files}
    DEPENDS
        "${proto_file}"
    )

    # return the list of generated sources
    set(${base_name}_sources ${generated_sources} PARENT_SCOPE)
    set(${base_name}_headers ${generated_headers} PARENT_SCOPE)
    set(${base_name}_files   ${generated_files}   PARENT_SCOPE)
endfunction()
