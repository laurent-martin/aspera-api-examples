# Laurent's API examples for Aspera using Python

Tested with Python3 on macOS.

This project provides code examples to use some IBM Aspera APIs and transfer files for various IBM Aspera products using python.

The sample code in `src` shows how to transfer files using:

* IBM Aspera HSTS using SSH credentials
* IBM Aspera HSTS or Shares using Node credentials
* IBM Cloud Object Storage (COS) using IBM Cloud service credentials
* IBM Aspera Faspex
* IBM Aspera on Cloud using JWT and a private key

## Quick start

First, initialize the main folder: execute `make` in the top folder of this repository.
Follow the main Readme to install the required components.

Then, initialize the python folder:

```bash
cd python

make
```

This will run sample programs with sample files using servers as configured in the config file.

If you prefer to test a single application, you may configure only the appropriate section in the config file, have a look to the [`Makefile`](Makefile) to check how the example is invoked and execute just the example relevant to you.
Then run only one example:

```bash
make cos2
```

> **Note:** If the daemon does not start, you make first try to stop it: `make stop`, and then run the sample again.

## Required external components

When `make` is invoked (Quick Start), it will check and install required python modules.

Check the [`Makefile`](Makefile) for details.

## SDK Selection

The examples use the current Aspera SDK: [Transfer SDK](https://developer.ibm.com/apis/catalog?search=%22aspera%20transfer%20sdk%22).
It **shall be used** for new developments.

The legacy [FASPManager API](https://developer.ibm.com/apis/catalog?search=%22fasp%20manager%20sdk%22) is now deprecated and shall not be used for new developments. (`faspmanager`)
An adapter is kept for reference, but should not be used.

## Structure of examples

Each of the sample programs are structured like this:

* `import test_environment` : `test_environment.py` is located in the same folder as the example :
  * it reads the configuration file
  * setup debug logging
  * defines the method: `start_transfer_and_wait` which takes a **transfer_spec** as argument to start a transfer.
* get configuration, urls, username, credentials, secrets, from test_environment.CONFIG
* call application API to build a **transfer_spec**
* call `start_transfer_and_wait` with this **transfer_spec** to start a transfer

## Known Transfer SDK Issues

Even if property `etc` is set to other folder, it looks for `aspera-license` file in `etc` folder (will be fixed in next release).

Transfer fails if `http_fallback` is `True`.

## COS official documentation for Aspera SDK

<https://cloud.ibm.com/docs/cloud-object-storage?topic=cloud-object-storage-aspera>

Uncomment lines in `cos.py` to use service credential file instead of bare API key.

## Windows

Install python 3.11: <https://www.python.org/downloads/windows/>
