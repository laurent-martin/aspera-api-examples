const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')
const grpc = require("@grpc/grpc-js")
const protoLoader = require("@grpc/proto-loader")
const assert = require('assert')
const os = require('os')

const top_folder = path.resolve(path.dirname(__filename), '..')
const paths = yaml.load(fs.readFileSync(path.join(top_folder, "config/paths.yaml"), 'utf8'))
function get_path(name) {
	return path.join(top_folder, paths[name])
}
// read config for examples
const yconf = yaml.load(fs.readFileSync(get_path("mainconfig"), 'utf8'))
// load definition for the aspera transfer sdk package
const packageDefinition = protoLoader.loadSync(
	get_path("proto"),
	{ keepCase: true, longs: String, enums: String, defaults: true, oneofs: true })
const transfersdk = grpc.loadPackageDefinition(packageDefinition).transfersdk
// create a connection to the transfer manager daemon
const grpc_url = new URL(yconf['misc']['trsdk_url'])
assert(grpc_url.protocol === 'grpc:', "Expecting gRPC protocol")

const client = new transfersdk.TransferService(grpc_url.hostname + ":" + grpc_url.port, grpc.credentials.createInsecure())

module.exports = {
	config: yconf,
	tmp_folder: os.tmpdir(),
	wait_for_server: (ready_cb) => {
		// try connection, allow 5 seconds
		client.waitForReady((new Date()).getTime() + 5000, (err) => {
			if (err) {
				console.log("No server found...")
				throw err
			}
			console.log("Connected...")
			ready_cb()
		})
	},
	// start a transfer , provide transfer_spec and optionally event callback
	start_transfer_and_wait: (transferSpec, success_cb) => {
		const startTransferRequest = {
			transferType: 'FILE_REGULAR',
			transferSpec: JSON.stringify(transferSpec)
		}
		const eventStream = client.startTransferWithMonitor(startTransferRequest, function (err, data) {
			console.log("error starting transfer " + err)
			throw err
		})
		eventStream.on('data', function (data) {
			console.log("Transfer %d Mbps/%d Mbps %s %s %s", data.transferInfo.averageRateKbps / 1000,
				data.transferInfo.targetRateKbps / 1000, data.transferEvent, data.status, data.transferType)
			if (data.transferEvent === 'SESSION_STOP' && data.status === 'COMPLETED')
				success_cb()
			if (data.transferEvent === 'SESSION_ERROR' && data.status === 'FAILED')
				throw "An error occured"
		})
	}
}
