# JavaScript (Node.js) examples

Requirements: Node.js 20 or newer.

`make` installs the packages of [`package.json`](package.json) with `npm ci`.

The gRPC client is created at runtime from `transferd.proto` with `@grpc/proto-loader`:
no stub code is generated.

## Run a sample manually

To run a sample without `make`, for example in a debugger,
first run it once with `make` (for example `make .tested/faspex5`):
this downloads the SDK and installs the dependencies.
Then, in this folder:

```bash
node src/examples/faspex5.js /path/to/file
```

Arguments are the files to transfer.
The main folder of the repository is found from the current folder: to use another one, set the environment variable `DIR_TOP`.
