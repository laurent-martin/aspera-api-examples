# Aspera SDK sample apps

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

This public repository provides code examples to transfer files using some of the IBM Aspera APIs for various IBM Aspera products using some languages.

[General access to all IBM Aspera APIs here](https://developer.ibm.com/apis/catalog/?search=aspera) or [here](https://developer.ibm.com/?q=aspera&dwcontenttype[0]=APIs)

See [Aspera transfer SDK on IBM site](https://developer.ibm.com/apis/catalog?search=%22aspera%20transfer%20sdk%22)

Other code examples are provided as part of the Transfer SDK itself.

[Video about Transfer SDK](https://higherlogicstream.s3.amazonaws.com/IMWUC/d5b91301-6aa1-5741-e083-2a9121d9d8a7_file.mp4)

## Overview

This repository is structured like this:

- `web` : this folder contains an example that shows the use of both the **Aspera Connect SDK** and **Aspera HTTP Gateway SDK**
- other folders show samples in various languages using the **Aspera Transfer SDK** and **Aspera Applications APIs**

The address of servers and credentials are needed to run the samples.
The configuration information is centralized in the file `private/config.yaml`.
Sample programs will use the information from this YAML file.

Once the configuration file is created, sample programs can be run directly.

Sample programs use a common library: "test environment" which takes care of starting the API daemon and creating its configuration file.
Nevertheless, developers may choose another method for daemon startup.

Unix-like systems: Linux, macOS... `Makefile` is provided to run the samples.

Windows: Refer to the Quick start for Windows below as `make` is not available, and use the `Makefile` as a reference to execute the commands manually.

This repo was tested on macOS ARM.

## Quick start (Unix-like systems)

If you use macOS, or Linux, AIX, etc...

1. Initialize the main folder:

    ```bash
    make
    ```

    This will:

    - create an empty configuration file from the template
    - download the Aspera Transfer SDK
    - extract the SDK to the expected folder.

    > **Note:** If you don't have internet access on the system, download the Transfer SDK with a system with internet from: <https://ibm.biz/aspera_transfer_sdk> and place the file here: `<main folder>/sdk/trsdk/transfer_sdk.zip`

2. Refer to [Configuration File](#config): Edit the file `private/config.yaml` and fill values.

    ```bash
    vi private/config.yaml
    ```

3. Run the samples: see next section.

## Quick start (Windows)

1. Refer to [Configuration File](#config): Copy the file `config/config.tmpl` into `private/config.yaml` and fill values.

    ```dos
    md private
    copy config\config.tmpl private\config.yaml
    ```

   Set the parameter `misc.system_type` to `windows-x86_64`

   Edit required parameters in `private/config.yaml`, for example Faspex connection information.

   > **Note:** Yes, you can also drap and drop, and click, and copy/paste, and edit the file with Notepad, etc...

2. Prepare the SDK folder

    ```dos
    md generated
    md generated\trsdk
    mklink /D generated\trsdk\etc noarch
    ```

    > **Note:** Creation of the link is due to a limitation in `asperatransferd` which does not use the `etc` parameter from its config file.

3. Download [sdk.zip](https://ibm.biz/aspera_transfer_sdk) and extract its contents to `generated/trsdk`

4. Run the samples: see next section.

## Running sample programs

Samples rely on relative paths defined in [`config/paths.yaml`](config/paths.yaml) and the main configuration file: [`private/config.yaml`](private/config.yaml).

For example to execute an individual script:

```bash
echo hello > datafile
python python/src/cos.py datafile
```

## <a id="config"></a>Configuration file

A template configuration file is provided: [`config/config.tmpl`](config/config.tmpl).

Copy the file `config/config.tmpl` into `private/config.yaml` and fill with your own server addresses, credentials and parameters.

```bash
cp config/config.tmpl private/config.yaml
vi private/config.yaml
```

Set the parameter `misc.system_type` to the architecture used:

- `windows-x86_64`
- `osx-x86_64`
- `linux-x86_64`
- `linux-ppc64le`
- `linux-s390`
- `aix-ppc64`

> **Note:** for macOS ARM, use `osx-x86_64`

The parameter `misc.trsdk_url` can be set to `grpc://127.0.0.1:55002` (specify the local port that sdk will use).

Section `httpgw` is used by the `web` example only.

Other sections are used by the various examples.
For example, if you want to test only COS transfer with transfer SDK you can set the section `cos` only and leave the other sections empty.

Example (with random credentials):

```yaml
---
  misc:
    system_type: osx-x86_64
    trsdk_url: grpc://127.0.0.1:55002
  web:
    port: 9080
  httpgw:
    url: https://1.2.3.4/aspera/http-gwy
  server:
    user: aspera
    pass: demoaspera
    url: ssh://demo.asperasoft.com:33001
  server_paths:
    file_download: /aspera-test-dir-small/10MB.1
    folder_upload: /Upload
  node:
    url: https://node.example.com:9092
    verify: false
    user: node_user
    pass: _the_password_here_
  faspex:
    url: https://faspex.example.com/aspera/faspex
    user: faxpex_user
    pass: _the_password_here_
  cos:
    endpoint: https://s3.eu-de.cloud-object-storage.appdomain.cloud
    bucket: mybucket
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

> **Note:** Faspex and node sections have a parameter `verify`: set to `false` to disable certificate verification.

## HSTS Node API credentials

Refer to the [HSTS documentation](https://www.ibm.com/docs/en/ahts/4.4?topic=linux-set-up-hsts-node-api) to create a user and get the credentials.

Typically, a node api user is created like this:

```bash
/opt/aspera/bin/asnodeadmin -a -u my_node_username -p my_node_password -x my_transfer_user
```

> **Note:** Access key credentials (id and secret) can also be used for the node api user.

## Aspera on Cloud

For Aspera on Cloud, several items are required:

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
- crn
- auth endpoint

This is the default in the example.

Or it is also possible to use:

- bucket name
- region
- service credentials: create the file `private/service_creds.json`, follow: [get service credentials](https://www.rubydoc.info/gems/aspera-cli#using-service-credential-file)
