// sample client web application
// See reference: https://ibm.github.io/aspera-connect-sdk-js/
// functions starting with "my_" are used locally only
// functions starting with "client_" are called by the UI

// Global values:
// this.connectClient: object to interact with Aspera Connect
// this.connectInstaller: object to propose installation of Connect, in case it is not detected
// this.selectedUploadFiles: files selected by user for upload
// this.httpGwMonitorId: identifier of activity monitor for HTTP Gateway transfers

// identifier used by HTTPGW SDK
const HTTPGW_FORM_ID = 'send-panel'
const desktop_init_url = 'aspera://'
const desktop_base_url = 'http://127.0.0.1:33024'
// =================================================================================================
// private functions


// UI display error
function my_error(message) {
    console.error(`ERROR: ${message}`)
    alert(`ERROR: ${message}`)
}

// @return the provided number with magnitude qualifier
function my_readableBytes(bytes) {
    const magnitude = Math.floor(Math.log(bytes) / Math.log(1024))
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
    return `${(bytes / Math.pow(1024, magnitude)).toFixed(2) * 1} ${sizes[magnitude]}`
}

// callback for connect client initialization progress
function my_handleStatusEvents(eventInfo) {
    console.log(`Connect Event: STATUS: ${eventInfo}`)
    if (!this.connectInstaller) {
        // object to propose installation of Connect, in case it is not detected
        this.connectInstaller = new AW4.ConnectInstaller({
            style: 'carbon',
            correlationId: 'testapp'
        })
    }
    if (eventInfo == AW4.Connect.STATUS.INITIALIZING) {
        this.connectInstaller.showLaunching()
    } else if (eventInfo == AW4.Connect.STATUS.EXTENSION_INSTALL) {
        this.connectInstaller.showExtensionInstall()
    } else if (eventInfo == AW4.Connect.STATUS.FAILED) {
        this.connectInstaller.showDownload()
    } else if (eventInfo == AW4.Connect.STATUS.OUTDATED) {
        this.connectInstaller.showUpdate()
    } else if (eventInfo == AW4.Connect.STATUS.RUNNING) {
        this.connectInstaller.connected()
        // (optional) Update UI with Connect version, that also validates that communication works
        this.connectClient.version({
            success: (info) => { document.getElementById('connect_info').innerHTML = `Connect Version ${info.version}` },
            error: () => { document.getElementById('connect_info').innerHTML = 'Cannot get connect version' }
        })
    }
}

// callback for feedback on transfer (Connect or HTTPGW)
function my_handleTransferEvents(transfers) {
    transfers.forEach(transfer => {
        const status = `Event:
    - Id:         ${transfer.uuid},
    - Status:     ${transfer.status},
    - Percent:    ${(transfer.percentage * 100).toFixed(2)}%,
    - Data Sent:  ${my_readableBytes(transfer.bytes_written)},
    - Data Total: ${my_readableBytes(transfer.bytes_expected)}`
        console.log(status)
        document.getElementById('status').innerHTML = status
    })
    my_updateUi()
}

// call when mouse is over the drop zone, or when files are dropped
function my_handleDragEvent(data) {
    console.log('Drag event', data)
    switch (data.event.type) {
        case 'drop':
            my_storeFileNames(data.files)
            document.getElementById('drop_area').style.backgroundColor = '#3498db';
            break;
        case 'dragenter':
            document.getElementById('drop_area').style.backgroundColor = 'red';
            break;
        case 'dragleave':
            document.getElementById('drop_area').style.backgroundColor = 'green';
            break;
    }
}

// initializes Aspera Connect SDK:
// - create the Connect object
// - check if aspera browser extension is installed, and if not: popup window to propose to install it
// - check if aspera connect client is installed, and if not: popup window to propose to install it
function my_initialize_connect() {
    // object to interact with Aspera Connect
    this.connectClient = new AW4.Connect({
        minVersion: '4.2.0',
        connectMethod: 'extension',
        dragDropEnabled: true
    })
    // See event types: https://ibm.github.io/aspera-connect-sdk-js/global.html#EVENT
    // we could also register type ALL, and check eventType value, but my_handleTransferEvents is used by both Connect and HTTPGW
    // Get notification on Connect Client status changes (eventType is STATUS), propose install if necessary
    this.connectClient.addEventListener(AW4.Connect.EVENT.STATUS, (eventType, eventInfo) => { my_handleStatusEvents(eventInfo) })
    // Get notification on transfer progress (eventType is TRANSFER), show UI feedback
    this.connectClient.addEventListener(AW4.Connect.EVENT.TRANSFER, (eventType, eventInfo) => { my_handleTransferEvents(eventInfo.transfers) })
    // add file drop zone
    this.connectClient.setDragDropTargets('#drop_area', { dragEnter: true, dragLeave: true, drop: true }, my_handleDragEvent)
    // Establish communication with Connect Client
    // status change will be notified by callback: my_handleStatusEvents, which triggers installer if necessary
    var my_info = this.connectClient.initSession()
    console.log('app info=', my_info)
}

function my_initialize_httpgw() {
    asperaHttpGateway.initHttpGateway(document.getElementById('httpgw_url').value + '/v1')
        .then(response => {
            console.log('HTTP Gateway SDK started', response)
            document.getElementById('httpgw_version').innerHTML = `HTTP GW v${response.version}`
            // register a transfer monitor
            this.httpGwMonitorId = asperaHttpGateway.registerActivityCallback((result) => { my_handleTransferEvents(result.transfers) })
        })
        .catch(error => {
            document.getElementById('httpgw_version').innerHTML = `HTTP GW ${error.message}`
            my_error(`Problem with HTTPGW: ${error.message}`)
        })
}

function my_initialize_desktop() {
    fetch(`${desktop_init_url}`, {
        method: 'GET'
    })
        .then((response) => { console.log(response) })
}

// Generates a transfer spec without calling node API: authorization with bare SSH credentials
// this is for demo only, usually it would not be the case: a token would be used for authorization
function my_getTransferSpecSSH(params) {
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
// by calling the app server who will forward to node
// @return transfer spec with token
function my_getTransferSpecFromServer(params) {
    console.log(`Transfer requested: ${params.operation}`)
    const server_url = window.location.href
    return new Promise((resolve) => {
        // get transfer spec from REST call to from express server
        fetch(`${server_url}tspec`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        })
            .then((response) => {
                return response.json()
            })
            .then((ts) => {
                if (ts.error) {
                    my_error(`Problem with server: ${ts.error}`)
                }
                return resolve(ts)
            })
            .catch((error) => { my_error(`Problem with server: ${error.message}`)})
    })
}

// start transfer for specified transfer type and files
// using either Connect SDK or HTTPGW SDK
function my_startTransfer(transferSpec) {
    console.log('startTransfer ts=', transferSpec)
    if (document.getElementById('use_connect').checked) {
        // https://ibm.github.io/aspera-connect-sdk-js/AW4.Connect.html#startTransfer
        // https://ibm.github.io/aspera-connect-sdk-js/global.html#ConnectSpec
        // allow_dialogs=false : hide connect client, we will follow the transfer progress in the web UI
        this.connectClient.startTransfer(transferSpec, { "allow_dialogs": false })
    } else if (document.getElementById('use_httpgw').checked) {
        // transfer spec specific to http gw:
        //transferSpec.download_name='project_files'
        //transferSpec.zip_required=true
        if (transferSpec.direction === 'receive') {
            asperaHttpGateway.download(transferSpec)
                .then(response => { })
                .catch(error => { my_error(`Problem with HTTPGW: ${error.message}`) })
        } else {
            asperaHttpGateway.upload(transferSpec, HTTPGW_FORM_ID)
                .then(response => { console.log('Upload started', response) })
                .catch(error => { my_error(`Problem with HTTPGW: ${error.message}`) })
        }
    } else if (document.getElementById('use_desktop').checked) {
        my_error('Desktop not yet implemented')
    }
}

// reset file selection for upload to empty file list
function my_resetSelection() {
    this.selectedUploadFiles = []
    my_updateUi()
}

// update dynamic elements in UI
// initialize selected SDK for transfer: Connect or HTTPGW
function my_updateUi() {
    console.log('update UI')
    document.getElementById('upload_files').innerHTML = this.selectedUploadFiles.join(', ')
    // init client app
    if (document.getElementById('use_connect').checked) {
        // Connect
        document.getElementById('connect_info').style.display = 'block'
        document.getElementById('httpgw_info').style.display = 'none'
        document.getElementById('desktop_info').style.display = 'none'
        document.getElementById('div_ssh_creds_selector').style.display = 'block'
        if (!this.connectClient) {
            my_initialize_connect()
        }
    } else if (document.getElementById('use_httpgw').checked) {
        // HTTPGW
        document.getElementById('connect_info').style.display = 'none'
        document.getElementById('httpgw_info').style.display = 'block'
        document.getElementById('desktop_info').style.display = 'none'
        document.getElementById('div_ssh_creds_selector').style.display = 'none'
        // SSH creds are not supported by HTTPGW
        if (document.querySelector("input[type='radio'][name=transfer_auth]:checked").value === "ssh_creds") {
            document.getElementById('ssh_creds_radio').checked = false
            document.getElementById('aspera_token_radio').checked = true
        }
        if (!this.httpGwMonitorId) {
            my_initialize_httpgw()
        }
    } else if (document.getElementById('use_desktop').checked) {
        document.getElementById('connect_info').style.display = 'none'
        document.getElementById('httpgw_info').style.display = 'none'
        document.getElementById('desktop_info').style.display = 'block'
        document.getElementById('div_ssh_creds_selector').style.display = 'block'
        my_initialize_desktop()
    }
    // update UI for transfer auth type
    if (document.querySelector("input[type='radio'][name=transfer_auth]:checked").value === "ssh_creds") {
        document.getElementById('hsts_ssh_info').style.display = 'block'
    } else {
        document.getElementById('hsts_ssh_info').style.display = 'none'
    }
    // update UI for transfer type
    if (document.getElementById('action_download').checked) {
        document.getElementById('download_selection').style.display = 'block'
        document.getElementById('upload_selection').style.display = 'none'
    } else {
        document.getElementById('download_selection').style.display = 'none'
        document.getElementById('upload_selection').style.display = 'block'
    }
}


// callback after files are selected
function my_storeFileNames(selection) {
    for (const file of selection.dataTransfer.files) {
        // don't duplicate sources
        if (!this.selectedUploadFiles.includes(file.name)) {
            this.selectedUploadFiles.push(file.name)
        }
    }
    console.log('Files picked', this.selectedUploadFiles)
    my_updateUi()
}

// =====================
// public functions

// Called on page load
function client_initialize() {
    this.selectedUploadFiles = []
    if (document.location.protocol === 'file:') {
        my_error(`ERROR: This page requires use of the nodejs server.`)
    }
    // initialize values in UI from config file
    document.getElementById('httpgw_url').value = config.httpgw.url
    document.getElementById('server_url').value = config.server.url
    document.getElementById('server_user').value = config.server.username
    document.getElementById('server_pass').value = config.server.password
    document.getElementById('file_to_download').value = config.server.file_download
    document.getElementById('folder_for_upload').value = config.server.folder_upload
    // Event listener when user click on UI
    document.querySelectorAll('input[type=radio]').forEach(item => item.addEventListener('change', () => my_updateUi()))
    my_updateUi()
}
// Button: Select files for upload
function client_pick_files() {
    // for the sample: a new select deletes already selected files
    my_resetSelection()
    if (document.getElementById('use_connect').checked) {
        this.connectClient.showSelectFileDialogPromise({ allowMultipleSelection: false })
            .then((selection) => { my_storeFileNames(selection) })
            .catch(() => { console.error('Unable to select files') })
    } else if (document.getElementById('use_httpgw').checked) {
        asperaHttpGateway.getFilesForUpload((selection) => { my_storeFileNames(selection) }, HTTPGW_FORM_ID)
    } else if (document.getElementById('use_desktop').checked) {
        my_error('Desktop not yet implemented')
    }
}
// Button: Start transfer
function client_start_transfer() {
    var params = null
    if (document.getElementById('action_download').checked) {
        params = { operation: 'download', sources: [document.getElementById('file_to_download').value] }
    } else {
        params = { operation: 'upload', sources: this.selectedUploadFiles, destination: document.getElementById('folder_for_upload').value }
        my_resetSelection()
    }
    var download_type = document.querySelector("input[type='radio'][name=transfer_auth]:checked").value
    if (download_type === "ssh_creds") {
        my_startTransfer(my_getTransferSpecSSH(params))
    } else {
        // this is for demo only, do not use basic token in production
        params["basic_token"] = (download_type === "basic_token")
        // this calls the nodejs server which calls the node api
        my_getTransferSpecFromServer(params)
            .then((transferSpec) => {
                // for HTTPGW or Connect SDK to use Aspera SSH keys for token, specify this in transfer spec
                transferSpec.authentication = 'token'
                my_startTransfer(transferSpec)
            }).catch((message) => { my_error(message) })
    }
}

