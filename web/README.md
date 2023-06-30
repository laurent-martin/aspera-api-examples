# Aspera transfers in web app using Connect or HTTP Gateway and Node API

This application shows how to start a file transfer in a web browser using either the Aspera Connect SDK or the Aspera HTTP Gateway SDK.

In both case, starting a transfer consists in building a **transfer spec**.

In this example, the transfer spec is build either:

- Using a broker app (server) which in turn calls the HSTS node API (and then uses a token)
- using SSH credentials (demo only, do not do that)

The application is split in two parts:

- <webroot/client.js> runs in the browser, started by <webroot/index.html>
- <src/server.js> runs in nodejs and is called by the client. It calls the Node API of HSTS.

![diagram](diagram.png)

## Configuration

Refer to [the configuration section of the upper README.md](../README.md#configuration-file) to create `../config.yaml`.

This sample app uses these values from the config file (`../config.yaml`):

```yaml
httpgw:
  url: https://mygw.example.com/aspera/http-gwy
node:
    url: https://server.example.com
    user: _node_user_here_
    pass: _node_pass_here_
server:
    url: ssh://eudemo.asperademo.com:33001
    user: _server_user_here_
    pass: _server_pass_here_
    download_file: /aspera-test-dir-small/10MB.1
    upload_folder: /Upload
```

## Environment Setup

The server uses [nodeJS](https://nodejs.org/) (v>=17, with `fetch`).
Install it.
Check version with:

```bash
node --version
```

## Execution of server, automated

For an automated run, using `make` and the `Makefile` (refer to it), do:

```bash
make
```

This will:
- install nodejs packages for the server
- download the http gateway client SDK
- generate the client config file `webroot/conf.js` from YAML
- run the express web server.

## Execution of server, manual

If you do not have `make`, you may refer to the Makefile for the command, which are as follows:

- install nodejs packages

  ```bash
  npm install
  ```

- start the server

  ```bash
  node --trace-warnings src/server.js ../config.yaml 3000 webroot/
  ```

## Using the client

Once the server is started, it shall display the address to open a browser to, which shall be: <http://localhost:3000>

The client app proposes various cases, using connect versus HTTP GW.
For those two it will try to connect and retrieve the version.

Select the direction of transfer, Download or Upload.

Select the type of authorization.
Typically, the "Aspera Transfer token" type is used.
But the sample app also shows how to use other types of transfer authorization.

For download, provide the path on server, for upload select local files and destination folder.

Then start the transfer.

The status of transfer can be followed on the web page.

## References

[Aspera Connect Sample code](https://github.com/IBM/aspera-connect-sdk-js)

[Aspera Connect API Reference](https://ibm.github.io/aspera-connect-sdk-js/)

[Aspera HTTP GW SDK documentation](https://developer.ibm.com/apis/catalog?search=%22aspera%20http%22)

[Aspera Connect SDK documentation](https://developer.ibm.com/apis/catalog?search=%22aspera%20connect%22)

[All Aspera APIs here](https://developer.ibm.com/apis/catalog?search=aspera)
