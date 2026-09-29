# Samples for C# (.NET)

## Get started

Execute `make` to run all samples, or `make .tested/server` to run a single sample.

## Run a sample manually

To run a sample without `make`, for example in a debugger,
first run it once with `make` (for example `make .tested/faspex5`):
this downloads the SDK, installs the dependencies, and generates the gRPC stub code.
Then, in this folder:

```bash
dotnet run -p:Proto_File=$PWD/../../tmp/transfer_sdk/api/transferd.proto faspex5 /path/to/file
```

The first argument is the name of the sample (`server`, `faspex5` or `aoc`), the next ones are the files to transfer.
The main folder of the repository is found from the current folder: to use another one, set the environment variable `DIR_TOP`.

> [!NOTE]
> The `proto` file is specified with tag `<Protobuf>`
> (from package [Grpc.Tools](https://www.nuget.org/packages/Grpc.Tools/)) in the `.csproj` file.
>
> Alternatively, one could use the pre-generated `.cs` files provided in the SDK:
> `tmp/transfer_sdk/api/csharp/TransferService` or use `protoc` to compile the proto file to source stubs.

## Environment

The project targets .NET 10 (`net10.0`).

Install the .NET SDK, which includes the `dotnet` CLI,
following the [Microsoft manual](https://learn.microsoft.com/en-us/dotnet/core/install/).

For example, on macOS, add the following to `~/.profile` or equivalent:

```bash
export PATH="$PATH:/usr/local/share/dotnet"
```

## Project creation

For reference, the project was initialized with:

```bash
dotnet new console
```

and then packages were added:

```bash
dotnet add package Grpc.Tools
dotnet add package Grpc.Net.Client
dotnet add package Google.Protobuf
```

## Package versions

Versions of NuGet packages are defined in [`Directory.Packages.props`](Directory.Packages.props)
([Central Package Management](https://learn.microsoft.com/nuget/consume-packages/central-package-management)):
the project file only lists the packages.

Resolved versions, including transitive dependencies, are recorded in `packages.lock.json`.
After changing a version, run `dotnet restore` to update the lock file, and commit both files.

To check for updates and known vulnerabilities:

```bash
dotnet list package --outdated
dotnet list package --vulnerable --include-transitive
```
