# C++ Examples

Tool chain uses `cmake` and `conan`.

Several C++ libraries are used:

- jwt-cpp
- cpp-httplib
- nlohmann_json
- boost
- cppcodec

Nevertheless, those libraries are used only for the examples and are not required to use the Aspera Transfer SDK.

## Requirements

The following tools are used.

## `protoc` and `grpc_cpp_plugin`

[web site](https://grpc.io/docs/languages/cpp/quickstart/).

Linux install:

```console
ubuntu$ sudo apt-get install protobuf-compiler
redhat$ sudo dnf install -y protobuf-compiler protobuf-devel
```

## `cmake`

[web site](https://cmake.org/)

```console
redhat$ sudo dnf install cmake
```

## `conan`

[web site](https://conan.io/)

```console
redhat$ sudo dnf install -y python3-pip
linux$ sudo pip install conan
```

## Build and Run

```bash
make
```

## Known issues

on macos:

```text
ld: archive member '/' not a mach-o file in ...
```

This is because GNU ar is used from `/opt/homebrew/opt/binutils/bin/ar`.
To fix this, ensure to use the system ar: `/usr/bin/ar`.
