// Sample client web application

import {
    init,
    getInfo,
    startTransfer,
    showSelectFileDialog,
    showSelectFolderDialog,
    initDragDrop,
    createDropzone,
    registerActivityCallback,
    type DataTransferResponse,
    type TransferResponse,
    type TransferSpec
} from '@ibm-aspera/sdk';


interface ClientConfig {
    httpgw: { url: string };
    server: {
        url: string;
        username: string;
        password: string;
        file_download: string;
        folder_upload: string;
    };
}

const DROP_AREA_ID = 'drop_area';

// =====================
// Global client state
class ClientApp {
    private selectedUploadFiles: string[] = [];
    private config: ClientConfig;
    private currentClient: 'connect' | 'httpgw' | 'desktop' | null = null;

    constructor(config: ClientConfig) {
        this.config = config;
    }

    // =====================
    // Helper functions

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

    // =====================
    // Event handlers

    private handleTransferEvents(response: TransferResponse) {
        response.transfers.forEach(transfer => {
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

    private handleDropEvent(data: { event: DragEvent; files: DataTransferResponse }) {
        const event = data.event;
        console.log(`Drag event: ${event.type}`);
        event.preventDefault();
        const dropArea = document.getElementById(DROP_AREA_ID);
        if (!dropArea) return;

        switch (event.type) {
            case 'drop':
                dropArea.style.backgroundColor = '#3498db';
                // extract files and call storeFileNames
                if (event.dataTransfer?.files) {
                    this.storeFileNames(data.files);
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

    getTransferSpecSSH(params: { operation: 'upload' | 'download'; sources: string[]; destination?: string }): TransferSpec {
        const serverUrl = new URL((document.getElementById('server_url') as HTMLInputElement).value.replace(/^ssh:/, 'http://'));
        const transferSpec: TransferSpec = {
            remote_host: serverUrl.hostname,
            ssh_port: parseInt(serverUrl.port, 10),
            remote_user: (document.getElementById('server_user') as HTMLInputElement).value,
            remote_password: (document.getElementById('server_pass') as HTMLInputElement).value,
            paths: params.sources.map(file => ({ source: file }))
        };
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
        const response = await fetch(`${server_url}api/tspec`, {
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

    resetSelection() {
        this.selectedUploadFiles = [];
        this.updateUi();
    }

    /// Add selected files to selection
    storeFileNames(selection: DataTransferResponse) {
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

    async updateUi() {
        const uploadEl = document.getElementById('upload_files');
        if (uploadEl) uploadEl.innerHTML = this.selectedUploadFiles.join(', ');
        const selected = document.querySelector<HTMLInputElement>('input[name="client_select"]:checked')?.value;
        const direction = document.querySelector<HTMLInputElement>('input[name="op_select"]:checked')?.value;
        console.log(`Client selected: ${selected}, Direction: ${direction}`);
        // show/hide sections
        const connectInfo = document.getElementById('connect_info');
        const httpgwInfo = document.getElementById('httpgw_info');
        const desktopInfo = document.getElementById('desktop_info');
        const sshSelector = document.getElementById('div_ssh_creds_selector');
        const sshInfo = document.getElementById('hsts_ssh_info');
        if (connectInfo) connectInfo.style.display = selected == 'connect' ? 'block' : 'none';
        if (httpgwInfo) httpgwInfo.style.display = selected == 'httpgw' ? 'block' : 'none';
        if (desktopInfo) desktopInfo.style.display = selected == 'desktop' ? 'block' : 'none';
        if (sshSelector) sshSelector.style.display = selected == 'connect' || selected == 'desktop' ? 'block' : 'none';
        if (sshInfo) sshInfo.style.display = document.querySelector<HTMLInputElement>("input[name=transfer_auth]:checked")?.value === 'ssh_creds' ? 'block' : 'none';
        if (direction === 'upload') {
            document.getElementById('download_selection')?.setAttribute('hidden', 'true');
            document.getElementById('upload_selection')?.removeAttribute('hidden');
        } else {
            document.getElementById('download_selection')?.removeAttribute('hidden');
            document.getElementById('upload_selection')?.setAttribute('hidden', 'true');
        }
        if (selected && selected !== this.currentClient) {
            try {
                await init({
                    appId: "C81C7514-BAE4-44F7-83FB-7C4DC5BB0EE7",
                    supportMultipleUsers: false,
                    httpGatewaySettings: {
                        url: this.config.httpgw.url,
                        forceGateway: selected == 'httpgw'
                    },
                    connectSettings: {
                        useConnect: selected == 'connect',
                        dragDropEnabled: true
                    }
                });
                await initDragDrop();
                await createDropzone(this.handleDropEvent.bind(this), `#${DROP_AREA_ID}`, { drop: true, allowPropagation: true });

                registerActivityCallback(this.handleTransferEvents.bind(this));
            } catch (error) {
                console.error("Initialization sequence failed:", error);
                this.error(`Failed to start: ${JSON.stringify(error)}`);
            }
            this.currentClient = selected as any;
        }
        const info = await getInfo();
        const el = document.getElementById(`${selected}_info`);
        if (el)
            el.innerHTML = `Version ${JSON.stringify(info)}`;
    }

    // =====================
    // Public functions called from UI
    async initialize(): Promise<void> {
        if (document.location.protocol === 'file:') {
            this.error(`This page requires use of the nodejs server.`);
        }
        // For safety prevent at highest level drop default actions
        // This is useful to avoid browser opening file if not dropped in the Dropzone
        window.addEventListener('drop', event => {
            event.preventDefault();
        });
        window.addEventListener('dragover', event => {
            event.preventDefault();
        });
        // static values
        (document.getElementById('httpgw_url') as HTMLInputElement).value = this.config.httpgw.url;
        (document.getElementById('server_url') as HTMLInputElement).value = this.config.server.url;
        (document.getElementById('server_user') as HTMLInputElement).value = this.config.server.username;
        (document.getElementById('server_pass') as HTMLInputElement).value = this.config.server.password;
        (document.getElementById('file_to_download') as HTMLInputElement).value = this.config.server.file_download;
        (document.getElementById('folder_for_upload') as HTMLInputElement).value = this.config.server.folder_upload;
        document.querySelectorAll<HTMLInputElement>('input[type=radio]').forEach(item => item.addEventListener('change', this.updateUi.bind(this)));
        document.getElementById('btn_select_files')?.addEventListener('click', this.pickFiles.bind(this));
        document.getElementById('btn_start_transfer')?.addEventListener('click', this.startClientTransfer.bind(this));
        // TODO: change from previous version ?
        for (const eventName of ['dragenter', 'dragleave']) {
            document.getElementById(DROP_AREA_ID)?.addEventListener(eventName, (event) => {
                this.handleDropEvent({ event: event as DragEvent, files: {} as DataTransferResponse });
            });
        }
        await this.updateUi();
    }

    pickFiles() {
        this.resetSelection();
        var selectFolders = false;
        (selectFolders ? showSelectFolderDialog({ multiple: true }) : showSelectFileDialog({ multiple: true })).then((response) => {
            this.storeFileNames(response);
        }).catch((error) => { console.error("Selecting items failed", error); });
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

        const auth_type = document.querySelector<HTMLInputElement>("input[name=transfer_auth]:checked")?.value;
        if (auth_type === "ssh_creds") {
            startTransfer(this.getTransferSpecSSH(params), {});
        } else {
            params.basic_token = auth_type === "basic_token";
            this.getTransferSpecFromServer(params).then(ts => {
                ts.authentication = 'token';
                startTransfer(ts, {});
            }).catch((message: any) => this.error(message));
        }
    }
}

(async () => {
    try {
        const response = await fetch("/api/config");
        if (!response.ok) throw new Error("Failed to load config");
        await new ClientApp(await response.json()).initialize();
        console.log("Application started successfully.");
    } catch (err) {
        console.error("Startup failed:", err);
    }
})();