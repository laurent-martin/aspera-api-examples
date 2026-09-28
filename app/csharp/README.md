
# Samples for Csharp

## Get started

To run a sample manually (samples are `server`, `faspex5` and `aoc`):

```bash
dotnet run -p:Proto_File=/path/to/transferd.proto server 'faux:///test1?1k'
```

Execute: `make` to run all tests, or to test a single sample: `make .tested/server`

> [!NOTE]
> The `proto` file is specified with tag `<Protobuf>` (from package [Grpc.Tools](https://www.nuget.org/packages/Grpc.Tools/)) in the `.csproj` file.

> [!NOTE]
> Alternatively, one could use pre-generated `.cs` files provided in SDK: `tmp/transfer_sdk/api/csharp/TransferService` or use `protoc` to compile the proto file to source stubs.

## Environment

The project targets .NET 10 (`net10.0`).

Install [dotnet CLI](https://learn.microsoft.com/en-us/nuget/reference/cli-reference/cli-ref-install) following [Microsoft manual](https://learn.microsoft.com/en-us/dotnet/core/install/).

For example, on macOS, add the following to `~/.profile` or equivalent:

```bash
export PATH="$PATH:/usr/local/share/dotnet"
```

## Project creation

For reference:

Project initialized with:

```bash
dotnet new console
```

and then packages were added:

```bash
dotnet add package Grpc.Tools
dotnet add package Grpc.Net.Client
dotnet add package Google.Protobuf
```
