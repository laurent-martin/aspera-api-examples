
# Samples for Csharp

## Get started

To run a sample manually (samples are `server`, `faspex5` and `aoc`):

```bash
dotnet run server 'faux:///test1?1k'
```

Execute: `make` to run all tests, or to test a single sample: `make .tested.server`

> **Note:** The `proto` file is used on the file by use of `<Protobuf>` tag in the `.csproj` file.
No need for `.cs` files provided in SDK: `../generated/trsdk/noarch/connectors/csharp/TransferService`.

## Environment

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
dotnet add package Grpc.Core
dotnet add package Grpc.Net.Client
dotnet add package Google.Protobuf
```
