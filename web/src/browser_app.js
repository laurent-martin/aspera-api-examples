// sample client web application
// See reference: https://ibm.github.io/aspera-connect-sdk-js/

// files selected by user for upload
var selected_upload_files = []
// HTTPGW upload monitor, initialized when HTTPGW is accessible
var httpGwMonitorId
// identifier used by HTTPGW SDK
const HTTPGW_FORM_ID = 'send-panel'
// location of Connect SDK in CDN
const CONNECT_SDK_CDN_LOCATION = '//d3gcli72yxqn2z.cloudfront.net/downloads/connect/latest'

// UI feedback on error
function app_error(message) {
    console.error(`ERROR: ${message}`)
    alert(`ERROR: ${message}`)
}

// @return the provided number with magnitude qualifier
function app_readableBytes(bytes) {
    const magnitude = Math.floor(Math.log(bytes) / Math.log(1024))
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
    return `${(bytes / Math.pow(1024, magnitude)).toFixed(2) * 1} ${sizes[magnitude]}`
}

// Called after page full download
function app_initialize() {
    if (document.location.protocol === 'file:') {
        app_error(`ERROR: This page requires use of the nodejs server.`)
    }
    // initialize values in UI from config file
    document.getElementById('httpgw_url').value = config.httpgw.url
    document.getElementById('server_url').value = config.server.url
    document.getElementById('server_user').value = config.server.user
    document.getElementById('server_pass').value = config.server.pass
    document.getElementById('download_file').value = config.server.download_file
    document.getElementById('upload_folder').value = config.server.upload_folder
    // Event listener when user click on UI
    document.querySelectorAll('input[type=radio]').forEach(item => item.addEventListener('change', () => app_updateUi()))
    document.querySelectorAll('input[type=checkbox]').forEach(item => item.addEventListener('change', () => app_updateUi()))
    document.getElementById('use_connect').addEventListener('click', () => { app_updateUi() })
    document.getElementById('action_download').addEventListener('click', () => { app_updateUi() })
    app_updateUi()
}

// initializes Aspera Connect: check if extension and client are installed, else ask to install
function app_initialize_connect() {
    // object to interact with connect
    var connect_object = new AW4.Connect({
        minVersion: '4.2.0',
        connectMethod: 'extension'
    })
    // object to propose installation of Connect, in case it is not detected
    var connect_installer = new AW4.ConnectInstaller({
        sdkLocation: CONNECT_SDK_CDN_LOCATION,
        style: 'carbon',
        correlationId: 'testapp'
    })
    // register callback when connect changes status, and trigger installer if necessary
    connect_object.addEventListener(AW4.Connect.EVENT.STATUS, (eventType, eventInfo) => {
        console.log(`Connect Event: ${eventInfo}`)
        if (eventInfo == AW4.Connect.STATUS.INITIALIZING) {
            connect_installer.showLaunching()
        } else if (eventInfo == AW4.Connect.STATUS.EXTENSION_INSTALL) {
            connect_installer.showExtensionInstall()
        } else if (eventInfo == AW4.Connect.STATUS.FAILED) {
            connect_installer.showDownload()
        } else if (eventInfo == AW4.Connect.STATUS.OUTDATED) {
            connect_installer.showUpdate()
        } else if (eventInfo == AW4.Connect.STATUS.RUNNING) {
            connect_installer.connected()
            // (optional) Update UI with Connect version, that also validates that communication works
            connect_object.version({
                success: (info) => { document.getElementById('connect_info').innerHTML = `Connect Version ${info.version}` },
                error: () => { document.getElementById('connect_info').innerHTML = 'Cannot get connect version' }
            })
        }
    })
    // try to start connect, else trigger installer
    var my_info = connect_object.initSession()
    console.log('app info=', my_info)
    return connect_object
}

// Generates a transfer spec without calling node API: authorization with bare SSH credentials
// this is for demo only, usually it would not be the case
function app_getTransferSpecSSH(params) {
    // replace ssh, as browser will not parse ssh as scheme
    const serverUrl = new URL(document.getElementById('server_url').value.replace(/^ssh:/g, 'http://'))
    const transferSpec = {
        remote_host: serverUrl.hostname,
        ssh_port: serverUrl.port,
        remote_user: document.getElementById('server_user').value,
        remote_password: document.getElementById('server_pass').value,
        paths: []
    }
    // build list of source files suitable for transfer spec
    for (const file of params.sources) {
        transferSpec['paths'].push({ source: file })
    }
    if (params.operation === 'upload') {
        transferSpec['direction'] = 'send'
        transferSpec['destination_root'] = params.destination
    } else {
        transferSpec['direction'] = 'receive'
    }
    return transferSpec
}

// Generate transfer spec for specified transfer operation (upload/download) and files
// call the app server who will forward to node
// @return transfer spec with token by calling the local express server
function app_getTransferSpecFromServer(params) {
    console.log(`Transfer requested: ${params.operation}`)
    const app_server_url = window.location.href
    return new Promise((resolve) => {
        // get transfer spec from server
        fetch(`${app_server_url}tspec`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        })
            .then((response) => { return response.json() })
            .then((ts) => { return resolve(ts) })
    })
}

// start transfer for specified transfer type and files
// using either connect SDK or HTTP HW SDK
function app_startTransfer(transferSpec) {
    console.log('With ts=', transferSpec)
    if (document.getElementById('use_connect').checked) {
        this.client.startTransfer(transferSpec)
    } else {
        // transfer spec specific to http gw:
        //transferSpec.download_name='project_files'
        //transferSpec.zip_required=true
        if (transferSpec.direction === 'receive') {
            asperaHttpGateway.download(transferSpec).then(response => {
            }).catch(error => { app_error(`Problem with HTTPGW: ${error.message}`) })
        } else {
            asperaHttpGateway.upload(transferSpec, HTTPGW_FORM_ID)
                .then(response => { console.log('Upload started', response) })
                .catch(error => { app_error(`Problem with HTTPGW: ${error.message}`) })
        }
    }
}

// reset file selection for upload to empty file list
function app_resetSelection() {
    selected_upload_files = []
    app_updateUi()
}

// callback for feedback on transfer (Connect or HTTPGW)
function handleTransferEvents(transfers) {
    transfers.forEach(transfer => {
        const status = `Event:
    - Id:         ${transfer.uuid},
    - Status:     ${transfer.status},
    - Percent:    ${(transfer.percentage * 100).toFixed(2)}%,
    - Data Sent:  ${app_readableBytes(transfer.bytes_written)},
    - Data Total: ${app_readableBytes(transfer.bytes_expected)}`
        console.log(status)
        document.getElementById('status').innerHTML = status
    })
    app_updateUi()
}

// update dynamic elements in UI
// initialize selected SDK for transfer: Connect or HTTPGW
function app_updateUi() {
    console.log('update UI')
    document.getElementById('upload_files').innerHTML = selected_upload_files.join(', ')
    if (document.getElementById('use_connect').checked) {
        // Connect
        document.getElementById('connect_info').style.display = 'block'
        document.getElementById('httpgw_info').style.display = 'none'
        document.getElementById('div_ssh_creds_selector').style.display = 'block'
        if (!this.client) {
            this.client = app_initialize_connect()
            // optionally for the sample: follow transfer progress in page
            this.client.addEventListener(AW4.Connect.EVENT.TRANSFER, (eventType, eventInfo) => { handleTransferEvents(eventInfo.transfers) })
        }
    } else {
        // HTTPGW
        document.getElementById('connect_info').style.display = 'none'
        document.getElementById('httpgw_info').style.display = 'block'
        document.getElementById('div_ssh_creds_selector').style.display = 'none'
        // SSH creds are not supported by HTTPGW
        if (document.querySelector("input[type='radio'][name=transfer_auth]:checked").value === "ssh_creds") {
            document.getElementById('ssh_creds_radio').checked = false
            document.getElementById('aspera_token_radio').checked = true
        }
        if (!httpGwMonitorId) {
            asperaHttpGateway.initHttpGateway(document.getElementById('httpgw_url').value + '/v1')
                .then(response => {
                    console.log('HTTP Gateway SDK started', response)
                    document.getElementById('httpgw_version').innerHTML = `HTTP GW v${response.version}`
                    // register a transfer monitor
                    httpGwMonitorId = asperaHttpGateway.registerActivityCallback((result) => { handleTransferEvents(result.transfers) })
                })
                .catch(error => {
                    document.getElementById('httpgw_version').innerHTML = `HTTP GW ${error.message}`
                    app_error(`Problem with HTTPGW: ${error.message}`)
                })
        }
    }
    if (document.querySelector("input[type='radio'][name=transfer_auth]:checked").value === "ssh_creds") {
        document.getElementById('hsts_ssh_info').style.display = 'block'
    } else {
        document.getElementById('hsts_ssh_info').style.display = 'none'
    }
    if (document.getElementById('action_download').checked) {
        document.getElementById('download_selection').style.display = 'block'
        document.getElementById('upload_selection').style.display = 'none'
    } else {
        document.getElementById('download_selection').style.display = 'none'
        document.getElementById('upload_selection').style.display = 'block'
    }
}

function app_start_transfer() {
    var params = null
    if (document.getElementById('action_download').checked) {
        params = { operation: 'download', sources: [document.getElementById('download_file').value] }
    } else {
        params = { operation: 'upload', sources: selected_upload_files, destination: document.getElementById('upload_folder').value }
        app_resetSelection()
    }
    var download_type = document.querySelector("input[type='radio'][name=transfer_auth]:checked").value
    if (download_type === "ssh_creds") {
        app_startTransfer(app_getTransferSpecSSH(params))
    } else {
        // this calls the nodejs server which calls the node api
        app_getTransferSpecFromServer(params)
            .then((transferSpec) => {
                // for basic token, we normally do not need to call the node api, but that is safer to get actual transfer addresses and a pre-filled transfer spec
                if (download_type === "basic_token") { transferSpec.token = 'Basic ' + btoa(document.getElementById('node_user').value + ':' + document.getElementById('node_pass').value) }
                // for HTTPGW or Connect SDK to use Aspera SSH keys for token, specify this in transfer spec
                transferSpec.authentication = 'token'
                app_startTransfer(transferSpec)
            }).catch((message) => { app_error(message) })
    }
}


// callback after files are selected
function app_storeFileNames(selection) {
    for (const file of selection.dataTransfer.files) {
        selected_upload_files.push(file.name)
    }
    console.log('Files picked', selected_upload_files)
    app_updateUi()
}

// Button: Select files for upload
function app_pick_files() {
    // for the sample: a new select deletes already selected files
    app_resetSelection()
    if (document.getElementById('use_connect').checked) {
        this.client.showSelectFileDialogPromise({ allowMultipleSelection: false })
            .then((selection) => { app_storeFileNames(selection) })
            .catch(() => { console.error('Unable to select files') })
    } else {
        asperaHttpGateway.getFilesForUpload((selection) => { app_storeFileNames(selection) }, HTTPGW_FORM_ID)
    }
}
