# Aspera API sample apps

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

Sample code using IBM Aspera APIs for various IBM Aspera products and SDKs:

- Aspera Transfer daemon: transfer files in an application
- Aspera Applications APIs: interact with Aspera applications (Faspex, AoC, Node API, COS, etc...)
- Aspera Connect SDK and HTTPGW SDK: transfer files in a web browser

![Component APIs](doc/api_components.png)

Various programming languages are proposed.

> [!NOTE]
> This repo uses Aspera transferd v1.1.5+

## Other resources

[IBM Aspera API documentation](https://developer.ibm.com/apis/catalog/?search=aspera) (select 24 items per page on bottom).

[Aspera Transfer Daemon documentation](https://developer.ibm.com/apis/catalog?search=%22aspera%20transfer%20sdk%22)
 contains code samples.

[Video about Transfer Daemon SDK](https://higherlogicstream.s3.amazonaws.com/IMWUC/d5b91301-6aa1-5741-e083-2a9121d9d8a7_file.mp4)

The [IBM Aspera Connect SDK github site](https://github.com/IBM/aspera-connect-sdk-js) contains examples about using the Aspera Connect SDK.

## Introduction

IBM Aspera provides two types of APIs:

- Client APIs:

  SDKs include **libraries** to be used in applications to transfer files

  - **Aspera Transfer Daemon SDK**: (gRPC with multi language) transfer files in an application
  - web SDKs:
    - **Aspera Connect SDK**: (web js) transfer files in a web browser
    - **Aspera HTTP Gateway SDK**: (web js) transfer files in a web browser using HTTPS
    - **Aspera for Desktop SDK**: (web js) transfer files in a web browser

- Server APIs:

  **REST** APIs (with OpenAPI spec) interact with Aspera applications (Faspex, AoC, Node API, COS, etc...)

Depending on the use case, one might use one or (often) several of those APIs.

## Repository structure

This repository is structured like this:

- `app` : examples in various languages using the **Aspera Transfer Daemon** and **Aspera Applications REST APIs**

- `web` : an example that shows the use of web SDKs: both the **Aspera Connect SDK** and **Aspera HTTP Gateway SDK** (Aspera for Desktop is coming), in javascript.

In `app`, you'll find one folder per programming language and, in each of them :

- `README.md` : a specific README for the language
- `Makefile` : a makefile to run samples
- `src` : source code
- `src/examples` : sample programs
- `src/utils` : helper classes

Sample programs use addresses and credentials from a common YAML configuration file.
Once the configuration file is created, see below on how to run them.

**Unix-like systems** (Linux, macOS...): a `Makefile` is provided to run the samples.

**Windows**: Refer to [Quick start (Windows)](#quick-start-windows) below. `make` might not be available. Use the `Makefile` as a reference to execute the commands manually.

## Quick start (Unix-like systems)

See [Running sample programs](#running-sample-programs).

On the first execution of `make`: the Transfer Daemon SDK will be automatically downloaded.

To download the SDK only, execute: `make sdk`.

## Quick start (Windows)

1. Refer to [Configuration File](#configuration-file): Copy the file `config/config.tmpl` into `private/config.yaml` and fill values.

    ```dos
    md private
    copy config\config.tmpl private\config.yaml
    ```

   Set the parameter `misc.platform` to `windows-x86_64`

   Edit required parameters in `private/config.yaml`, for example Faspex connection information.

> [!NOTE]
> Yes, you can also drag and drop, and click, and copy/paste, and edit the file with Notepad, etc...

2. Prepare the SDK folder

    ```dos
    md tmp
    ```

3. Download the Aspera Transfer Daemon SDK ([here](https://developer.ibm.com/apis/catalog/aspera--aspera-transfer-sdk/downloads/downloads.json)) and extract its contents to the folder identified by `sdk_dir` in `config/paths.yaml` : `<main folder>/tmp/transfer_sdk`

> [!NOTE]
> Make sure that files identified in `config/paths.yaml` are in the extracted folder as expected. For example, the following file must exist: `<main folder>/tmp/transfer_sdk/sbin/transferd`

4. Run the samples: see [Running sample programs](#running-sample-programs)

## Running sample programs

Create a configuration file as specified in [Configuration file](#configuration-file).
Not all values are required, only those needed for the examples you want to run.

For example to execute an individual sample, use `make .tested/<sample name here>`:

```console
$ cd app/python
$ make list
server aoc faspex faspex5 node shares node_v2
$ make .tested/faspex5
```

Running examples requires the Aspera Transfer daemon `transferd` to be downloaded and some tools to compile the proto file. See [Transfer Daemon SDK](#transfer-daemon).

For details, refer to the recipe in the `Makefile` of each language.

## Configuration file

A template configuration file is provided: [`config/config.tmpl`](config/config.tmpl).

Copy the file `config/config.tmpl` into `private/config.yaml` and fill with your own server addresses, credentials and parameters.

```bash
cp config/config.tmpl private/config.yaml
vi private/config.yaml
```

> [!NOTE]
> Although the format may look like the configuration file for `ascli`, a configuration file for `ascli` is not compatible with this one. You must create a new one.

Set the parameter `misc.platform` to the architecture used:

- `osx-arm64`
- `osx-x86_64`
- `windows-x86_64`
- `linux-x86_64`
- `linux-s390`
- `linux-arm64`
- `linux-ppc64le`
- `aix-ppc64`

The parameter `trsdk.url` can be set to `grpc://127.0.0.1:55002` (specify the local port that SDK will use).
If port zero (0) is used, then a port is dynamically chosen in some examples.

Section `httpgw` is used by the `web` example only.

Other sections are used by the various examples.
For example, if you want to test only the COS transfer using the Transfer Daemon, you can fill the `cos` section only and leave other sections empty.

Example (with random credentials):

```yaml
misc:
  platform: osx-x86_64
  level: debug
  transfer_regular: true
trsdk:
  url: grpc://127.0.0.1:55002
  level: trace
  ascp_level: trace
web:
  port: 9080
httpgw:
  url: https://1.2.3.4/aspera/http-gwy
server:
  user: aspera
  pass: demoaspera
  url: ssh://demo.asperasoft.com:33001
  file_download: /aspera-test-dir-small/10MB.1
  folder_upload: /Upload
node:
  url: https://node.example.com:9092
  verify: false
  user: node_user
  pass: _the_password_here_
  folder_upload: /Upload
faspex:
  url: https://faspex.example.com/aspera/faspex
  user: faspex_user
  pass: _the_password_here_
cos:
  endpoint: https://s3.eu-de.cloud-object-storage.appdomain.cloud
  bucket: my_bucket
  key: _the_key_here_
  crn: 'crn:v1:bluemix:public:cloud-object-storage:global:_the_crn_::'
  auth: https://iam.cloud.ibm.com/identity/token
coscreds:
  bucket: mybucket
  service_credential_file: ./service_creds.json
  region: eu-de
aoc:
  org: acme
  user_email: john@example.com
  private_key: /path/to/my_aoc_key
  client_id: aspera.global-cli-client
  client_secret: frpmsRsG4mjZ0PlxCgdJlvONqBg4Vlpz_IX7gXmBMAfsgMLy2FO6CXLodKfKAuhqnCqSptLbe_wdmnm9JRuEPO-PpFqpq_Kb
  workspace: Default
  shared_inbox: TheSharedInbox
```

> [!NOTE]
> Sections with HTTPS URLs have a parameter `verify`.
> Set it to `false` to disable server certificate validation for development environments.

Some relative paths are defined in [`config/paths.yaml`](config/paths.yaml) (keep those values intact).

The following log levels can be set:

- `misc.level`: sample code log level: `debug` `info` `warning` `error`
- `trsdk.level`: `transferd` log level: `trace` `debug` `info` `warning` `error` `fatal` `panic`
- `trsdk.ascp_level`: `ascp` log level: `trace` `debug` `info`

Some examples support setting port to `0` (zero) in `trsdk.url` to use a random port.

Sample application generate a file `transferd.conf` provided to the transfer daemon, log level there are taken from the general YAML config file.

## Transfer Daemon

The Transfer Daemon is a **gRPC** service that allows you to transfer files in an application.
It is a client API that can be used in various languages.

The file `transfer.proto` describes in the remote procedure call interface provided by the daemon `transferd`.

```text
 +----------------+
 + transfer.proto +
 +----------------+
         |
     [protoc]
         |
         v
+----------------------+        +------------+
+ generated stub code  +        + your code  +
+----------------------+        +------------+
          | [combine]                  |
          +-----+----------------------+
                |
                v
          +------------+                      +---------------------+
          | client app |-----[connect to]---->|   Transfer daemon   |
          +------------+                      +---------------------+
                |                                       ^      | [executes]
                +-------------[executes]----------------+      v
                                                        |   +------+
[or other method, systemd, or manual]---[executes]------+   | ascp |
                                                            +------+
```

### Generated client source files

Client applications must use the client source files generated from the `transfer.proto` file.

Generated (stub) code is provided for convenience in the Transfer Daemon SDK for several languages.
It can be used directly, or the developer may choose to generate them from the `transfer.proto` file.
For production and future compatibility it is recommended to generate the stub code from the `transfer.proto` file.
If you generate stub code yourself, then you can benefit from support to latest platforms and versions.

Most samples here generate the stub code from the `transfer.proto` file.

Refer to [GRPC web site](https://grpc.io/) for instructions on how to generate the code.

### Helper classes

Sample programs use helper classes located in package `utils`:

- `Configuration` reads configuration parameters from `config.yaml` so that it is easier to run any samples.
- `TransferClient` creates a configuration file and starting the Transfer daemon: `transferd`
- `Rest` for simple API calls on Rest APIs.

### Runtime files

The Transfer Daemon requires the following runtime files:

- `transferd` : executable that provides the **gRPC** service
- `ascp` : executable that actually transfers the files
- `ascp4` : another version of `ascp`
- `async` : executable for `async` operations
- `libafwsfeed` : a library for `ascp` for web sockets
- `aspera-license` : the license file for `ascp` (free use)

Optional files:

- `aspera.conf` : the configuration file for `ascp`
- `product-info.mf` : XML file with information on SDK version

### `aspera.conf`

This file is optional for `ascp` when used in client mode.

The very minimum content is:

```xml
<CONF/>
```

It is possible to set some client parameters, like:

```xml
<?xml version='1.0' encoding='UTF-8'?>
<CONF version="2">
<default>
    <file_system>
        <storage_rc><adaptive>true</adaptive></storage_rc>
        <resume_suffix>.aspera-ckpt</resume_suffix>
        <partial_file_suffix>.partial</partial_file_suffix>
        <replace_illegal_chars>_</replace_illegal_chars>
    </file_system>
</default>
</CONF>
```

### Daemon startup

`transferd` is a daemon that must be started before using its API.
It drives the transfer of files between two endpoints using embedded `ascp`.
The client app will connect to it using gRPC on the port specified.

The way to start the daemon is not specified in the SDK.
Developers have the choice to start it manually in a separate terminal, or to create a static configuration file and start it using another method (for example, a systemd service).

Examples provided here start the daemon using the `TransferClient` class.

When `transferd` starts, if no configuration file is provided with option `--config`, then it expects to find `ascp`, `ascp4`, `async`, `libafwsfeed`, `aspera-license` in specific folders.
In order to place all file in the same folder, then the configuration file must be provided and folders must be set.

The Makefile provided in the samples downloads the SDK and extracts it in a single folder, then the examples generate the configuration file accordingly.

## HSTS Node API credentials

Refer to the [HSTS documentation](https://www.ibm.com/docs/en/ahts/4.4?topic=linux-set-up-hsts-node-api) to create a user and get the credentials.

Typically, a Node API user is created like this:

```bash
/opt/aspera/bin/asnodeadmin -a -u my_node_username -p my_node_password -x my_transfer_user
```

> [!NOTE]
> Access key credentials (id and secret) can also be used for the Node API user.

## Shares

Shares provides the following APIs:

- Transfer related APIs: It is identical to the **Node API**. The root of Shares API for transfers is `<shares url>/node_api`.
- Admin APIs (manage users , etc...)

The same examples as for **Node API** can be used for **Shares**.

## Aspera on Cloud

For Aspera on Cloud, several configuration items are required:

- `org` : The AoC Organization, i.e. the name before `.ibmaspera.com` in the URL
- `user_email` : The user's IBMid
- `private_key` : The path to the PEM file containing the user's private key. The user configured the associated public key in his AoC User's profile.
- `client_id` : (see below) The client app identifier
- `client_secret` : (see below) The client app secret

`client_id` and `client_secret` can be:

- either a specific application credential created in the admin interface of AoC (Integrations)
- or one of the two global client id : the one of aspera connect/drive or the one of the legacy `aspera` CLI :
  - `aspera.global-cli-client`
  - `frpmsRsG4mjZ0PlxCgdJlvONqBg4Vlpz_IX7gXmBMAfsgMLy2FO6CXLodKfKAuhqnCqSptLbe_wdmnm9JRuEPO-PpFqpq_Kb`

For example to extract the ones of Aspera Connect (Drive): `strings asperaconnect|grep -B1 '^aspera\.drive$'`

## COS service credentials

To test transfers to COS, you will need:

- bucket name
- storage endpoint
- api key
- resource instance id (crn)
- authentication endpoint (optional)

This is the default in the example.

Or it is also possible to use:

- bucket name
- region
- service credentials: create the file `private/service_creds.json`, follow: [get service credentials](https://www.rubydoc.info/gems/aspera-cli#using-service-credential-file)
