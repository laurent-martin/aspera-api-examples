# Laurent's API examples for Aspera using Python

Tested with Python 3 on macOS.

This project provides code examples to use some IBM Aspera APIs
and transfer files for various IBM Aspera products using Python.

The sample code in `src` shows how to transfer files using:

- IBM Aspera HSTS using SSH credentials
- IBM Aspera HSTS or Shares using Node credentials, using transfer spec v1 or v2
- IBM Cloud Object Storage (COS) using IBM Cloud service credentials
- IBM Aspera Faspex 4 and 5
- IBM Aspera on Cloud using JWT and a private key

## Requirements

### Unix-like

- GNU make
- Python 3.11+

### Windows

Install Python 3.11 or newer: <https://www.python.org/downloads/windows/>

## Quick start

To run all Python sample programs at once, execute in this folder:

```bash
make
```

This will run sample programs with sample files using servers as configured in the config file.

If you prefer to test a single application, you may configure only the appropriate section in the config file.
Have a look at the [`Makefile`](Makefile) to check how the example is invoked.
Then run only that example, for example to test `node`:

```bash
make .tested/node
```

> [!NOTE]
> If the daemon does not start, a previous instance may still be running: stop it with `make clean_daemon`,
> and then run the sample again.

By default, the gRPC client source files `transferd_pb2.py` and `transferd_pb2_grpc.py` are generated from `transferd.proto`.
Alternatively, it is possible to use those files from the SDK: edit the `Makefile` and comment out the line `PY_GRPC_SDK_DIR=`.

## Run a sample manually

To run a sample without `make`, for example in a debugger,
first run it once with `make` (for example `make .tested/faspex5`):
this downloads the SDK, installs the dependencies, and generates the gRPC stub code.
Then, in this folder:

```bash
source .venv/bin/activate
PYTHONPATH=.venv/grpc_aspera:src python3 src/examples/faspex5.py /path/to/file
```

Arguments are the files to transfer.
The main folder of the repository is found from the current folder: to use another one, set the environment variable `DIR_TOP`.

In VS Code, the file [`.env`](../../.env) of the main folder sets the same variables.

## Required external components

When `make` is invoked (see [Quick start](#quick-start)), it creates a Python virtual environment in `.venv`
and installs the required Python modules listed in [`src/requirements.txt`](src/requirements.txt).

Check the [`Makefile`](Makefile) for details.

## SDK Selection

The examples use the current Aspera SDK: [Transfer SDK](https://developer.ibm.com/apis/catalog?search=%22aspera%20transfer%20sdk%22).
It **shall be used** for new developments.

The legacy [FASPManager API](https://developer.ibm.com/apis/catalog?search=%22fasp%20manager%20sdk%22) (`faspmanager`)
is now deprecated and shall not be used for new developments.

## Structure of examples

Each sample program is structured like this:

- read the configuration file and set up logging: `config = utils.configuration.Configuration()` (`src/utils/configuration.py`)
- start the Transfer Daemon and connect to it:
  `transfer_client = utils.transfer_client.TransferClient(config).startup()` (`src/utils/transfer_client.py`)
- get URLs, credentials, and other parameters from the configuration file: `config.param('<section>', '<parameter>')`
- call the application API to build a **transfer spec**: `utils.rest.Rest` (`src/utils/rest.py`)
- start the transfer and wait for its completion: `transfer_client.start_transfer_and_wait(transfer_spec)`
- stop the daemon: `transfer_client.shutdown()`

## Known Transfer SDK Issues

Transfer fails if `http_fallback` is `True`.

## COS official documentation for Aspera SDK

<https://cloud.ibm.com/docs/cloud-object-storage?topic=cloud-object-storage-aspera>

Uncomment lines in `cos.py` to use a service credential file (section `coscreds`)
instead of individual parameters (section `cos`).
