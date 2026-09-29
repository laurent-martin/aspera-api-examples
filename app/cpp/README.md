# C++ Examples

The toolchain uses `cmake` and `conan`, with C++17.

The following C++ libraries are used:

- boost
- yaml-cpp
- magic_enum
- openssl

These libraries are used only by the examples: they are not required to use the Aspera Transfer Daemon SDK.

## Requirements

The following tools are used.

### `gcc`

```console
ubuntu$ sudo apt-get install build-essential
redhat$ sudo dnf install gcc-c++
```

### `cmake`

[Website](https://cmake.org/)

```console
redhat$ sudo dnf install cmake
```

### `conan`

[Website](https://conan.io/)

```console
redhat$ sudo dnf install -y python3-pip
linux$ sudo pip install conan
```

### `protoc` and `grpc_cpp_plugin`

[gRPC C++ Quickstart](https://grpc.io/docs/languages/cpp/quickstart/).

Linux install:

```console
redhat$ sudo dnf install -y protobuf-compiler protobuf-devel
ubuntu$ sudo apt-get install protobuf-compiler
```

## Build and Run

```bash
make
```

## Known issues

On macOS:

```text
ld: archive member '/' not a mach-o file in ...
```

This happens when GNU `ar` is used from `/opt/homebrew/opt/binutils/bin/ar`.
To fix this, make sure that the system `ar` is used: `/usr/bin/ar`.

```bash
export PATH=/usr/bin:$PATH
```
