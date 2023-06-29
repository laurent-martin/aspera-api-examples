"use strict"
// sample server application
// provides one endpoint: /tspec
// called with two parameters: upload/download and file list
// returns an transfer spec suitable to start a transfer

const bodyParser = require('body-parser')
const express = require('express')
const https = require('https')
const yaml = require('js-yaml')
const fs = require('fs')

// command line arguments
const yamlConfFile = process.argv[2]
const port = Number(process.argv[3])
const staticFolder = process.argv[4]

// read config file (node credentials ...) 
const config = yaml.load(fs.readFileSync(yamlConfFile, 'utf8'))
// web server
const app = express()

// use this source folder to serve static content
app.use(express.static(staticFolder))

// allow parsing of JSON bodies
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())

// for demo, ignore self-signed cert on Node API
const ignoreCertAgent = new https.Agent({ rejectUnauthorized: false })

// expose API: get transfer authorization by calling node API
app.post('/tspec', (req, res) => {
  console.log('params:', req.body)
  // requested path for authorization, depends on transfer direction
  let request_paths = null
  const source_paths = []
  // build list of source files suitable for transfer spec
  for (const file of req.body.sources) {
    source_paths.push({ source: file })
  }
  if (req.body.operation === 'upload') {
    request_paths = [{ destination: req.body.destination }]
  } else if (req.body.operation === 'download') {
    request_paths = source_paths
  } else {
    return res.status(500).send(`Wrong operation parameter: ${req.body.operation}`)
  }
  // call HSTS node API (with a single transfer request)
  fetch(config.node.url + `/files/${req.body.operation}_setup`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa(config.node.user + ':' + config.node.pass) },
    body: JSON.stringify({ transfer_requests: [{ transfer_request: { paths: request_paths } }] }),
    agent: ignoreCertAgent
  }).then((response) => {
    if (!response.ok) {
      return res.status(500).send(`Node API: ${response.statusText}`)
    }
    return response.json()
  }).then((result) => {
    const result0 = result.transfer_specs[0]
    if (result0.error) {
      return res.status(500).send(result0.error.user_message)
    }
    // one request was made, so one answer is received (assume no error)
    const transferSpec = result0.transfer_spec
    // set paths of files to transfer
    transferSpec.paths = source_paths
    // add auth for HTTPGW or connect to use Aspera SSH keys
    transferSpec.authentication = 'token'
    console.log('result ts:', transferSpec)
    // call resolve callback with resulting transfer spec
    return res.send(transferSpec)
  })
})

// start web server
app.listen(port, () => {
  console.log(`Express server running at http://localhost:${port}`)
})
