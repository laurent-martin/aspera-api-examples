'use strict'
// sample server application
// provides one endpoint: /tspec
// called with two parameters: upload/download and file list
// returns an transfer spec suitable to start a transfer

const bodyParser = require('body-parser')
const express = require('express')
const https = require('https')
const yaml = require('js-yaml')
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const dirTop = process.env.DIR_TOP;
if (!dirTop) {
  throw new Error("Environment variable DIR_TOP is not set.");
}
const top_folder = path.resolve(dirTop);
if (!fs.existsSync(top_folder) || !fs.lstatSync(top_folder).isDirectory()) {
  throw new Error(`The folder specified by DIR_TOP does not exist or is not a directory: ${top_folder}`);
}
const paths = yaml.load(fs.readFileSync(path.join(top_folder, 'config/paths.yaml'), 'utf8'));
function get_path(name) {
  return path.join(top_folder, paths[name]);
}
// read config for examples
const config = yaml.load(fs.readFileSync(get_path('main_config'), 'utf8'));

const http_port = config['web']['port']

const staticFolder = process.argv[2]

assert(fs.statSync(staticFolder).isDirectory(), 'parameter is not a folder: ' + staticFolder)

// web server
const app = express()

// generate configuration for web client
fs.writeFile(path.join(staticFolder, 'conf.js'), 'config=' + JSON.stringify(config), err => { if (err) { console.error(err) } })

// use this source folder to serve static content
app.use(express.static(staticFolder))

// allow parsing of JSON bodies
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())

// ignore self-signed cert on Node API if required for tests
// alternatively, set env var: NODE_TLS_REJECT_UNAUTHORIZED=0
if (!config.node.verify) {
  const { Agent, setGlobalDispatcher } = require('undici');
  setGlobalDispatcher(new Agent({
    connect: {
      rejectUnauthorized: false
    }
  }))
}

// expose API: /tspec
// get transfer specification by calling node API
// @param operation: upload or download
// @param sources: list of files to transfer
// @param destination: destination path (upload only)
app.post('/tspec', (req, res) => {
  // retrieve parameters sent by client
  const params = req.body
  console.log('params:', params)
  // build list of source files suitable for transfer spec
  const ts_source_paths = []
  for (const file of params.sources) {
    ts_source_paths.push({ source: file })
  }
  // requested transfer spec for authorization, depends on transfer direction
  const request_ts = { paths: null }
  if (params.operation === 'upload') {
    // for upload, authorization is on upload target folder
    // we may alternatively set field "destination_root"
    request_ts['paths'] = [{ destination: params.destination }]
  } else if (params.operation === 'download') {
    // for download, authorization is on download source files
    request_ts['paths'] = ts_source_paths
  } else {
    return res.status(500).send(`Wrong operation parameter: ${params.operation}`)
  }
  const basic_auth = 'Basic ' + btoa(config.node.username + ':' + config.node.password)
  // call HSTS Node API (with a single transfer request)
  fetch(config.node.url + `/files/${params.operation}_setup`, {
    method: 'POST',
    headers: { Authorization: basic_auth },
    body: JSON.stringify({ transfer_requests: [{ transfer_request: request_ts }] })
  }).then((response) => {
    if (!response.ok) {
      console.log(`ERROR: Node API: ${response.statusText}`)
      res.status(500).send({error: `Node API: ${response.statusText}`})
      return
    }
    // if OK, then parse the JSON for next step
    return response.json()
  }).then((result) => {
    if (!result) { return }
    // we posted a single transfer request, so we shall get a single result
    const result0 = result.transfer_specs[0]
    // error occurred ?
    if (result0.error) {
      console.log(`ERROR: ${result0.error.user_message}`)
      return res.status(500).send({error: result0.error.user_message})
    }
    // no error, so we have the transfer spec
    const transferSpec = result0.transfer_spec
    // set paths of files to transfer (for upload, we did not set the paths, so it's not in the generated ts)
    transferSpec.paths = ts_source_paths
    // this is for demo only, do not use basic token in production
    // for basic token, we could just build a transfer spec ourselves without getting parameters from node api
    // but that is safer to get actual transfer addresses and a pre-filled transfer spec
    if (params['basic_token']) { transferSpec.token = basic_auth }
    // send result
    console.log('result:', transferSpec)
    return res.send(transferSpec)
  }).catch((error) => {
    console.error('Fetch error:', error);
    res.status(500).send('Internal server error');
  });
})

// start web server
app.listen(http_port, () => {
  console.log(`Express web server running at http://localhost:${http_port}`)
})
