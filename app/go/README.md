# Go Language

Work in progress.

The `Makefile` generates the gRPC stub code from the proto file with `protoc` and the Go plugins, installed with:

```bash
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
```

## Run a sample manually

To run a sample without `make`, for example in a debugger,
first run it once with `make` (for example `make .tested/faspex5`):
this downloads the SDK, installs the dependencies, and generates the gRPC stub code.
Then, in this folder:

```bash
DIR_TOP=$PWD/../.. go run src/examples/faspex5.go /path/to/file
```

`DIR_TOP` is the main folder of the repository. Arguments are the files to transfer.
