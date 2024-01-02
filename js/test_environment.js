const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')
const grpc = require("@grpc/grpc-js")
const protoLoader = require("@grpc/proto-loader")
const assert = require('assert')
const os = require('os')
const { spawn } = require('child_process')

const top_folder = path.resolve(path.dirname(__filename), '..')
const paths_file = "config/paths.yaml"
const paths = yaml.load(fs.readFileSync(path.join(top_folder, paths_file), 'utf8'))
function get_path(name) {
	return path.join(top_folder, paths[name])
}
// read config for examples
const config = yaml.load(fs.readFileSync(get_path("mainconfig"), 'utf8'))
const arch_folder = path.join(get_path("sdk_root"), config["misc"]["system_type"])
const daemon_name = "asperatransferd"
const daemon_exe = path.join(arch_folder, daemon_name)

// load gRPC package definition for aspera transfer sdk
const packageDefinition = protoLoader.loadSync(
	get_path("proto"),
	{ keepCase: true, longs: String, enums: String, defaults: true, oneofs: true })
// get stubs for transfer sdk
const transfersdk = grpc.loadPackageDefinition(packageDefinition).transfersdk

var client = null
var sdk_process = null


module.exports = {
	config: config,
	tmp_folder: os.tmpdir(),
	connect_to_api: (ready_rb) => {
		const grpc_url = new URL(config['misc']['trsdk_url'])
		assert(grpc_url.protocol === 'grpc:', "Expecting gRPC protocol")
		const daemon_conf = {
			address: grpc_url.hostname,
			port: parseInt(grpc_url.port),
			log_directory: os.tmpdir(),
			log_level: 'debug',
			fasp_runtime: {
				use_embedded: false,
				user_defined: {
					bin: arch_folder,
					etc: get_path('trsdk_noarch'),
				},
				log: {
					dir: os.tmpdir(),
					level: 0,
				},
			},
		};
		const tmp_file_base = path.join(os.tmpdir(), 'daemon');
		const conf_file = path.join(get_path("tmpgen"),'daemon.json');
		fs.writeFileSync(conf_file, JSON.stringify(daemon_conf));
		const args = ['-c', conf_file]
		out_file = tmp_file_base + '.out'
		err_file = tmp_file_base + '.err'
		console.log(`Starting: ${daemon_exe} ${args.join(' ')}`)
		console.log(`stderr: ${err_file}`)
		console.log(`stdout: ${out_file}`)
		console.log(`ascp log: ${daemon_conf['log_directory']}/aspera-scp-transfer.log`)
		sdk_process = spawn(daemon_exe, args, {
			stdio: ['ignore', fs.openSync(out_file, 'w'), fs.openSync(err_file, 'w')],
		})
		sdk_process.on('error', (error) => { console.error(`Error starting the child process: ${error.message}`) })
		sdk_process.on('exit', (code, signal) => {
			console.log(`transferd exited (${code})`)
			if (code != 0) {
				throw "transferd exited abnormally"
			}
		})
		console.log(`Started ${daemon_name} with pid ${sdk_process.pid}`)
		// create a connection to the transfer manager daemon
		setTimeout(() => {
			client = new transfersdk.TransferService(grpc_url.hostname + ":" + grpc_url.port, grpc.credentials.createInsecure())
			// try connection, allow 5 seconds
			client.waitForReady((new Date()).getTime() + 5000, (err) => {
				if (err) {
					console.log("No server found...")
					throw err
				}
				console.log("Connected...")
			})
			ready_rb()
		}, 5000)
	},
	shutdown_api: (ok_cb) => {
		console.log("Stopping transferd...")
		sdk_process.on('exit', (code, signal) => { ok_cb() })
		sdk_process.kill(2)
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
				throw "ERROR: An error occurred during transfer session"
		})
	}
}
