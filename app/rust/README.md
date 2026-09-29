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
