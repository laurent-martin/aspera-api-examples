# Rust

<https://www.rust-lang.org/tools/install>

## macOS

Install `rust`, and `protoc` (required to compile the proto file):

```bash
brew install rust protobuf
```

For reference, the project was initialized with:

```bash
cargo init
```

## gRPC

Samples use the `tonic` crate for gRPC and the `tokio` crate for the async runtime.

## Run a sample manually

To run a sample without `make`, for example in a debugger,
first run it once with `make` (for example `make .tested/faspex5`):
this downloads the SDK, installs the dependencies, and generates the gRPC stub code.
Then, in this folder:

```bash
DIR_TOP=$PWD/../.. SDK_FILE_PROTO=$PWD/../../tmp/transfer_sdk/api/transferd.proto cargo run --bin faspex5 /path/to/file
```

`DIR_TOP` is the main folder of the repository. Arguments are the files to transfer.

`SDK_FILE_PROTO` is used by [`build.rs`](build.rs) to compile the proto file.
