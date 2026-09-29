# Go Language

Examples use the standard library `net/http` for REST calls, and `grpc` for the Transfer Daemon:
refer to [`go.mod`](go.mod).

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
go run src/examples/faspex5.go /path/to/file
```

Arguments are the files to transfer.
The main folder of the repository is found from the current folder: to use another one, set the environment variable `DIR_TOP`.
