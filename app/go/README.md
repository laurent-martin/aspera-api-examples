# Go Language

Work in progress.

The `Makefile` generates the gRPC stub code from the proto file with `protoc` and the Go plugins, installed with:

```bash
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
```
