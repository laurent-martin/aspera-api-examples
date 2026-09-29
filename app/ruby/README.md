# Ruby examples

Examples use the `rest-client` gem for REST calls, and the `grpc` gem for the Transfer Daemon:
refer to the [`Gemfile`](Gemfile).

## Run a sample manually

To run a sample without `make`, for example in a debugger,
first run it once with `make` (for example `make .tested/faspex5`):
this downloads the SDK, installs the dependencies, and generates the gRPC stub code.
Then, in this folder:

```bash
bundle exec src/examples/faspex5.rb /path/to/file
```

Arguments are the files to transfer.
The main folder of the repository is found from the current folder: to use another one, set the environment variable `DIR_TOP`.
