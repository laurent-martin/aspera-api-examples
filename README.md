# Aspera API use examples

This public repository provides code examples to transfer files using some of the IBM Aspera APIs for various IBM Aspera products using some languages.

[General access to all IBM Aspera APIs here](https://developer.ibm.com/apis/catalog/?search=aspera) or [here](https://developer.ibm.com/?q=aspera&dwcontenttype[0]=APIs)

See [Aspera transfer SDK on IBM site](https://developer.ibm.com/apis/catalog?search=%22aspera%20transfer%20sdk%22)

Code examples are provided as part of the SDK itself.

[Video about Transfer SDK](https://higherlogicstream.s3.amazonaws.com/IMWUC/d5b91301-6aa1-5741-e083-2a9121d9d8a7_file.mp4)

## Overview

This repository is structured like this:

- `web` : this folder contains an example that shows the use of both the **Aspera Connect SDK** and **Aspera HTTP Gateway SDK**
- other folders show samples in various languages using the **Aspera Transfer SDK** and **Aspera Applications APIs**

The address of servers and credentials are needed to run the samples.
The configuration information is centralized in the file `private/config.yaml`.
Sample programs will use the information from this YAML file.
This avoid having to duplicate the information in each sample folders.

`Makefile`s are made for Unix-like systems: Linux, macOS, ...

This repo was tested on macOS ARM.

Windows users without `make` can use the `Makefile` as a reference to execute the commands manually.

## Quick start

1. Copy the file `config/config.tmpl` into `private/config.yaml` and fill, refer to [Configuration File](#config)

1. Initialize the main folder:

```bash
make
```

This downloads the Aspera Transfer SDK.

> **Note:** If you don't have internet access on the system, download the Transfer SDK with a system with internet from:
>
> <https://ibm.biz/aspera_transfer_sdk>
>
> and place the file here: `<main folder>/sdk/trsdk/transfer_sdk.zip`

For Windows users, the main manual configuration steps are:

- create `private/config.yaml` from the template `config/config.tmpl` and fill with valid server addresses and credentials, refer to [Configuration File](#config)
- java and nodejs (but not python, nor ruby) rely on `generated/trsdk/config.conf` created from `config/sdkconf.tmpl`, refer to `Makefile` for details
- nodejs relies on starting the daemon manually, refer to `Makefile` for details
- download [the SDK zip](https://ibm.biz/aspera_transfer_sdk) and extract to `generated/trsdk`

## Testing individual programs

Scripts rely on relative paths defined in [`config/paths.yaml`](config/paths.yaml) and the main configuration file: [`private/config.yaml`](private/config.yaml).

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
    private_key_path: /path/to/my_aoc_key
    client_id: aspera.global-cli-client
    client_secret: frpmsRsG4mjZ0PlxCgdJlvONqBg4Vlpz_IX7gXmBMAfsgMLy2FO6CXLodKfKAuhqnCqSptLbe_wdmnm9JRuEPO-PpFqpq_Kb
    workspace: Default
    shared_inbox: TheSharedInbox
```

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
- `private_key_path` : The path to the PEM file containing the user's private key. The user configured the associated public key in his AoC User's profile.
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
