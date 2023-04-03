# Aspera transfers in web app using Connect and HTTP Gateway

This application shows how to start a file transfer in a web browser using both the Aspera Connect SDK and Aspera HTTP Gateway SDK.

In both case, starting a transfer consists in building a "transfer spec".

In this example, the transfer spec is build either for a direct transfer to a server or using node API.

This sample application gives the choice to contact the node api either directly from the browser or through a local web server (express).

## References

[Aspera Connect Sample code](https://github.com/IBM/aspera-connect-sdk-js)

[Aspera Connect API Reference](https://ibm.github.io/aspera-connect-sdk-js/)

[Aspera HTTP GW SDK documentation](https://developer.ibm.com/apis/catalog?search=%22aspera%20http%22)

[Aspera Connect SDK documentation](https://developer.ibm.com/apis/catalog?search=%22aspera%20connect%22)

[All Aspera APIs here](https://developer.ibm.com/apis/catalog?search=aspera)

## Configuration

The example use these values from the config file (`../config.yaml`):

```yaml
httpgw:
  url: https://mygw.example.com/aspera/http-gwy
server:
    url: ssh://eudemo.asperademo.com:33001
    user: _server_user_here_
    pass: _server_pass_here_
    download_file: /aspera-test-dir-small/10MB.1
    upload_folder: /Upload
node:
    url: https://server.example.com
    user: _node_user_here_
    pass: _node_pass_here_
```

This YAML will generate the equivalent file <conf.js> which is used by the server and to populate the client default values.

## Setup and Run

Install nodeJS (v>=17, with `fetch`), and then install packages and run the server with:

```bash
make
```

Then open a browser to:

<http://localhost:3000>

The application can also be used as opened as file in browser, in that case simply open the file [index.html](index.html) located in your local clone of this repo in a browser.
