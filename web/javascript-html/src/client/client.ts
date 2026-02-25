// Sample client web application
// See reference: https://ibm.github.io/aspera-sdk-js

// functions starting with "my_" are used locally only
// functions starting with "client_" are called by the UI

// Global values:
// this.connectClient: object to interact with Aspera Connect
// this.connectInstaller: object to propose installation of Connect, in case it is not detected
// this.selectedUploadFiles: files selected by user for upload
// this.httpGwMonitorId: identifier of activity monitor for HTTP Gateway transfers
// client.ts
// sample client web application
// Typescript version for browser

import { init } from '@ibm-aspera/sdk';
import { startTransfer } from '@ibm-aspera/sdk';

interface Window {
    config: {
        httpgw: { url: string };
        server: {
            url: string;
            username: string;
            password: string;
            file_download: string;
            folder_upload: string;
        };
    };
}
const HTTPGW_FORM_ID = 'send-panel';

interface TransferSpecPath {
    source?: string;
    destination?: string;
}

interface TransferSpec {
    remote_host?: string;
    ssh_port?: string | number;
    remote_user?: string;
    remote_password?: string;
    paths: TransferSpecPath[];
    direction?: 'send' | 'receive';
    destination_root?: string;
    authentication?: 'token';
    token?: string;
}

// =====================
// Global client state
class ClientApp {
    connectClient: any;
    connectInstaller: any;
    selectedUploadFiles: string[] = [];
    httpGwMonitorId?: number;

    // =====================
    // Private functions

    private error(message: string) {
        console.error(`ERROR: ${message}`);
        alert(`ERROR: ${message}`);
    }

    private readableBytes(bytes: number): string {
        if (bytes === 0) return '0 B';
        const magnitude = Math.floor(Math.log(bytes) / Math.log(1024));
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
        return `${(bytes / Math.pow(1024, magnitude)).toFixed(2)} ${sizes[magnitude]}`;
    }

    private handleStatusEvents(eventInfo: any) {
        console.log(`Connect Event: STATUS: ${eventInfo}`);
        if (!this.connectInstaller) {
            this.connectInstaller = new AW4.ConnectInstaller({
                style: 'carbon',
                correlationId: 'testapp'
            });
        }
        switch (eventInfo) {
            case AW4.Connect.STATUS.INITIALIZING:
                this.connectInstaller.showLaunching();
                break;
            case AW4.Connect.STATUS.EXTENSION_INSTALL:
                this.connectInstaller.showExtensionInstall();
                break;
            case AW4.Connect.STATUS.FAILED:
                this.connectInstaller.showDownload();
                break;
            case AW4.Connect.STATUS.OUTDATED:
                this.connectInstaller.showUpdate();
                break;
            case AW4.Connect.STATUS.RUNNING:
                this.connectInstaller.connected();
                this.connectClient.version({
                    success: (info: any) => {
                        const el = document.getElementById('connect_info');
                        if (el) el.innerHTML = `Connect Version ${info.version}`;
                    },
                    error: () => {
                        const el = document.getElementById('connect_info');
                        if (el) el.innerHTML = 'Cannot get connect version';
                    }
                });
                break;
        }
    }

    private handleTransferEvents(transfers: any[]) {
        transfers.forEach(transfer => {
            const status = `Event:
- Id:         ${transfer.uuid},
- Status:     ${transfer.status},
- Percent:    ${(transfer.percentage * 100).toFixed(2)}%,
- Data Sent:  ${this.readableBytes(transfer.bytes_written)},
- Data Total: ${this.readableBytes(transfer.bytes_expected)}`;
            console.log(status);
            const el = document.getElementById('status');
            if (el) el.innerHTML = status;
        });
        this.updateUi();
    }

    private handleDragEvent = (event: DragEvent) => {
        event.preventDefault();
        const dropArea = document.getElementById('drop_area');
        if (!dropArea) return;

        switch (event.type) {
            case 'drop':
                dropArea.style.backgroundColor = '#3498db';
                // extract files and call storeFileNames
                if (event.dataTransfer?.files) {
                    this.storeFileNames({ files: event.dataTransfer.files });
                }
                break;
            case 'dragenter':
                dropArea.style.backgroundColor = 'red';
                break;
            case 'dragleave':
                dropArea.style.backgroundColor = 'green';
                break;
        }
    };

    // =====================
    // Initialization functions

    initializeConnect() {
        this.connectClient = new AW4.Connect({
            minVersion: '4.2.0',
            connectMethod: 'extension',
            dragDropEnabled: true
        });

        this.connectClient.addEventListener(AW4.Connect.EVENT.STATUS, (eventType: any, eventInfo: any) => {
            this.handleStatusEvents(eventInfo);
        });

        this.connectClient.addEventListener(AW4.Connect.EVENT.TRANSFER, (eventType: any, eventInfo: any) => {
            this.handleTransferEvents(eventInfo.transfers);
        });

        this.connectClient.setDragDropTargets('#drop_area', { dragEnter: true, dragLeave: true, drop: true }, this.handleDragEvent);

        const info = this.connectClient.initSession();
        console.log('app info=', info);
    }

    async initializeHttpGw() {
        try {
            const response = await asperaHttpGateway.initHttpGateway((document.getElementById('httpgw_url') as HTMLInputElement).value + '/v1');
            console.log('HTTP Gateway SDK started', response);
            const el = document.getElementById('httpgw_version');
            if (el) el.innerHTML = `HTTP GW v${response.version}`;
            this.httpGwMonitorId = asperaHttpGateway.registerActivityCallback((result: any) => {
                this.handleTransferEvents(result.transfers);
            });
        } catch (error: any) {
            const el = document.getElementById('httpgw_version');
            if (el) el.innerHTML = `HTTP GW ${error.message}`;
            this.error(`Problem with HTTPGW: ${error.message}`);
        }
    }

    getTransferSpecSSH(params: { operation: 'upload' | 'download'; sources: string[]; destination?: string }): TransferSpec {
        const serverUrl = new URL((document.getElementById('server_url') as HTMLInputElement).value.replace(/^ssh:/, 'http://'));
        const transferSpec: TransferSpec = { remote_host: serverUrl.hostname, ssh_port: serverUrl.port, remote_user: (document.getElementById('server_user') as HTMLInputElement).value, remote_password: (document.getElementById('server_pass') as HTMLInputElement).value, paths: [] };
        params.sources.forEach(file => transferSpec.paths.push({ source: file }));
        if (params.operation === 'upload') {
            transferSpec.direction = 'send';
            transferSpec.destination_root = params.destination;
        } else {
            transferSpec.direction = 'receive';
        }
        return transferSpec;
    }

    async getTransferSpecFromServer(params: { operation: 'upload' | 'download'; sources: string[]; destination?: string; basic_token?: boolean }): Promise<TransferSpec> {
        console.log(`Transfer requested: ${params.operation}`);
        const server_url = window.location.href;
        const response = await fetch(`${server_url}tspec`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        });
        const ts = await response.json();
        if (ts.error) {
            this.error(`Problem with server: ${ts.error}`);
        }
        return ts;
    }

    startTransfer(transferSpec: TransferSpec) {
        console.log('startTransfer ts=', transferSpec);
        if ((document.getElementById('use_connect') as HTMLInputElement).checked) {
            this.connectClient.startTransfer(transferSpec, { allow_dialogs: false });
        } else if ((document.getElementById('use_httpgw') as HTMLInputElement).checked) {
            if (transferSpec.direction === 'receive') {
                asperaHttpGateway.download(transferSpec).catch((error: any) => this.error(`Problem with HTTPGW: ${error.message}`));
            } else {
                asperaHttpGateway.upload(transferSpec, HTTPGW_FORM_ID)
                    .then(async (response: Response) => {
                        const data = await response.json();
                        console.log('Upload started', data);
                    })
                    .catch((error: any) => this.error(`Problem with HTTPGW: ${error.message}`));
            }
        } else if ((document.getElementById('use_desktop') as HTMLInputElement).checked) {
            this.error('Desktop not yet implemented');
        }
    }

    resetSelection() {
        this.selectedUploadFiles = [];
        this.updateUi();
    }

    storeFileNames(selection: { dataTransfer: { files: FileList } }) {
        const files = selection.dataTransfer?.files;
        if (files) {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                if (!this.selectedUploadFiles.includes(file.name)) {
                    this.selectedUploadFiles.push(file.name);
                }
            }
        }
        console.log('Files picked', this.selectedUploadFiles);
        this.updateUi();
    }

    updateUi() {
        const uploadEl = document.getElementById('upload_files');
        if (uploadEl) uploadEl.innerHTML = this.selectedUploadFiles.join(', ');

        const useConnect = (document.getElementById('use_connect') as HTMLInputElement).checked;
        const useHttpGw = (document.getElementById('use_httpgw') as HTMLInputElement).checked;
        const useDesktop = (document.getElementById('use_desktop') as HTMLInputElement).checked;

        // show/hide sections
        const connectInfo = document.getElementById('connect_info');
        const httpgwInfo = document.getElementById('httpgw_info');
        const desktopInfo = document.getElementById('desktop_info');
        const sshSelector = document.getElementById('div_ssh_creds_selector');
        const sshInfo = document.getElementById('hsts_ssh_info');
        if (connectInfo) connectInfo.style.display = useConnect ? 'block' : 'none';
        if (httpgwInfo) httpgwInfo.style.display = useHttpGw ? 'block' : 'none';
        if (desktopInfo) desktopInfo.style.display = useDesktop ? 'block' : 'none';
        if (sshSelector) sshSelector.style.display = useConnect || useDesktop ? 'block' : 'none';
        if (sshInfo) sshInfo.style.display = document.querySelector<HTMLInputElement>("input[name=transfer_auth]:checked")?.value === 'ssh_creds' ? 'block' : 'none';
    }

    // =====================
    // Public functions called from UI
    initialize() {
        this.selectedUploadFiles = [];
        if (document.location.protocol === 'file:') {
            this.error(`This page requires use of the nodejs server.`);
        }
        (document.getElementById('httpgw_url') as HTMLInputElement).value = windows.config.httpgw.url;
        (document.getElementById('server_url') as HTMLInputElement).value = windows.config.server.url;
        (document.getElementById('server_user') as HTMLInputElement).value = windows.config.server.username;
        (document.getElementById('server_pass') as HTMLInputElement).value = windows.config.server.password;
        (document.getElementById('file_to_download') as HTMLInputElement).value = windows.config.server.file_download;
        (document.getElementById('folder_for_upload') as HTMLInputElement).value = windows.config.server.folder_upload;

        document.querySelectorAll<HTMLInputElement>('input[type=radio]').forEach(item => item.addEventListener('change', () => this.updateUi()));
        this.updateUi();
    }

    pickFiles() {
        this.resetSelection();
        if ((document.getElementById('use_connect') as HTMLInputElement).checked) {
            this.connectClient.showSelectFileDialogPromise({ allowMultipleSelection: false })
                .then((selection: any) => this.storeFileNames(selection))
                .catch(() => console.error('Unable to select files'));
        } else if ((document.getElementById('use_httpgw') as HTMLInputElement).checked) {
            asperaHttpGateway.getFilesForUpload((selection: any) => this.storeFileNames(selection), HTTPGW_FORM_ID);
        } else if ((document.getElementById('use_desktop') as HTMLInputElement).checked) {
            this.error('Desktop not yet implemented');
        }
    }

    startClientTransfer() {
        let params: any = null;
        if ((document.getElementById('action_download') as HTMLInputElement).checked) {
            params = { operation: 'download', sources: [(document.getElementById('file_to_download') as HTMLInputElement).value] };
        } else {
            params = {
                operation: 'upload',
                sources: this.selectedUploadFiles,
                destination: (document.getElementById('folder_for_upload') as HTMLInputElement).value
            };
            this.resetSelection();
        }

        const download_type = document.querySelector<HTMLInputElement>("input[name=transfer_auth]:checked")?.value;
        if (download_type === "ssh_creds") {
            this.startTransfer(this.getTransferSpecSSH(params));
        } else {
            params.basic_token = download_type === "basic_token";
            this.getTransferSpecFromServer(params).then(ts => {
                ts.authentication = 'token';
                this.startTransfer(ts);
            }).catch((message: any) => this.error(message));
        }
    }
}

// Create the client instance
const clientApp = new ClientApp();

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
    clientApp.initialize();
    document.querySelectorAll<HTMLInputElement>("input[name='client_select']").forEach(radio => {
        radio.addEventListener('change', () => {
            clientApp.updateUi(); // refresh UI based on selected radio
        });
    });
    document.getElementById('btn_select_files')?.addEventListener('click', () => {
        clientApp.pickFiles();
    });
    document.getElementById('btn_start_transfer')?.addEventListener('click', () => {
        clientApp.startClientTransfer();
    });
});
