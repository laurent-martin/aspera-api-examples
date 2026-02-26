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
    type TransferSpec,
    type FileDialogOptions,
    type FolderDialogOptions
} from '@ibm-aspera/sdk';

/**
 * Unified options type for both file and folder selection dialogs.
 */
type SelectDialogOptions =
    | ({ select: 'folder' } & FolderDialogOptions)
    | ({ select?: 'file' } & FileDialogOptions);

/**
 * Unified function to show either file or folder selection dialog based on options.
 */
async function showSelectDialog(options: SelectDialogOptions = {}): Promise<DataTransferResponse> {
    return options.select === 'folder' ? showSelectFolderDialog(options) : showSelectFileDialog(options);
}

/**
 * Formatter for human-readable file sizes using Intl.NumberFormat with unit style.
 */
const bytesFormatter = new Intl.NumberFormat('en', {
    style: 'unit',
    unit: 'byte',
    notation: 'compact',
    unitDisplay: 'short',
    maximumFractionDigits: 2
});

const getVal = (id: string) => (document.getElementById(id) as HTMLInputElement)?.value;
const getChecked = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value;

function handleError(title: string, err: any) {
    const msg = err?.message || JSON.stringify(err);
    console.error(`${title}:`, err);
    alert(`${title}\n${msg}`);
}

class ClientApp {
    /**
     * STATE: Centralized state for selected files and current client type.
     */
    private selectedUploadFiles: string[] = [];
    private currentClient: 'desktop' | 'connect' | 'httpgw' = 'httpgw';

    constructor(private config: any) { }

    async initialize(): Promise<void> {
        // Prevent default browser behavior for dropped files globally
        ['drop', 'dragover'].forEach(name =>
            window.addEventListener(name, e => e.preventDefault())
        );
        // Pre-fill fields from config
        const fields: Record<string, string> = {
            'httpgw_url': this.config.httpgw.url,
            'server_url': this.config.server.url,
            'server_user': this.config.server.username,
            'server_pass': this.config.server.password,
            'file_to_download': this.config.server.file_download,
            'folder_for_upload': this.config.server.folder_upload
        };
        Object.entries(fields).forEach(([id, val]) => {
            (document.getElementById(id) as HTMLInputElement)?.setAttribute('value', val);
        });
        // Event Bindings
        document.querySelectorAll('input[type=radio]').forEach(el => el.addEventListener('change', () => this.updateUi()));
        document.getElementById('btn_select_files')?.addEventListener('click', () => this.pickFiles());
        document.getElementById('btn_start_transfer')?.addEventListener('click', () => this.startClientTransfer());
        await this.updateUi();
    }

    // =====================
    // Logic Handlers
    // =====================

    async pickFiles() {
        this.selectedUploadFiles = [];
        try {
            const response = await showSelectDialog({ multiple: true, });
            const files = response.dataTransfer?.files || [];
            // Use Set to ensure unique filenames
            this.selectedUploadFiles = [...new Set(files.map(f => f.name))];
            this.updateUi();
        } catch (err) {
            handleError("User cancelled or selection failed", err);
        }
    }

    async startClientTransfer() {
        const state = this.uiState;
        const isDownload = state.direction === 'download';

        const params = {
            operation: state.direction,
            sources: isDownload ? [state.downloadPath] : this.selectedUploadFiles,
            destination: isDownload ? undefined : state.uploadDest,
            basic_token: state.authType === 'basic_token'
        };

        try {
            let spec: TransferSpec;
            if (state.authType === "ssh_creds") {
                spec = this.getTransferSpecSSH(params);
            } else {
                spec = await this.getTransferSpecFromServer(params);
                spec.authentication = 'token';
            }

            await startTransfer(spec, {});
            if (!isDownload) this.selectedUploadFiles = [];
            this.updateUi();
        } catch (err) {
            handleError("Transfer Failed", err);
        }
    }

    /**
     * STATE SNAPSHOT: Centralizes all DOM reads.
     * This is the "Single Source of Truth" for the application logic.
     */
    private get uiState() {
        return {
            client: (getChecked('client_select') || 'desktop') as 'connect' | 'httpgw' | 'desktop',
            direction: getChecked('op_select') as 'upload' | 'download',
            authType: getChecked('transfer_auth'),
            serverUrl: getVal('server_url'),
            downloadPath: getVal('file_to_download'),
            uploadDest: getVal('folder_for_upload'),
        };
    }

    /**
     * UPDATER: Declaratively updates visibility and SDK state.
     */
    private async updateUi() {
        const state = this.uiState;
        // SDK Transition Logic
        if (state.client !== this.currentClient) {
            console.log(`Switching client from ${this.currentClient} to ${state.client}`);
            await this.reinitSdk(state.client);
            this.currentClient = state.client;
        }

        // Update file list display
        const uploadEl = document.getElementById('upload_files');
        if (uploadEl) uploadEl.textContent = this.selectedUploadFiles.join(', ') || 'No files selected';

        // VISIBILITY MATRIX
        const visibilityMatrix: Record<string, boolean> = {
            'httpgw_url': state.client === 'httpgw',
            'div_ssh_creds_selector': ['connect', 'desktop'].includes(state.client),
            'hsts_ssh_info': state.authType === 'ssh_creds',
            'download_selection': state.direction === 'download',
            'upload_selection': state.direction === 'upload'
        };
        Object.entries(visibilityMatrix).forEach(([id, visible]) => {
            document.getElementById(id)?.toggleAttribute('hidden', !visible);
        });
        await this.refreshStatusDisplay(state.client);
    }

    private async reinitSdk(clientType: string) {
        try {
            await init({
                appId: "C81C7514-BAE4-44F7-83FB-7C4DC5BB0EE7",
                supportMultipleUsers: false,
                httpGatewaySettings: {
                    url: clientType === 'httpgw' ? this.config.httpgw.url : undefined,
                    forceGateway: clientType === 'httpgw'
                },
                connectSettings: {
                    useConnect: clientType === 'connect',
                    dragDropEnabled: true
                }
            });
            await initDragDrop();
            await createDropzone(this.handleDropEvent.bind(this), '#drop_area', { drop: true, allowPropagation: true });
            registerActivityCallback(this.handleTransferEvents.bind(this));
        } catch (err) {
            handleError("Initialization Failed", err);
        }
    }


    private handleTransferEvents(response: TransferResponse) {
        // Modernized logging using formatted strings
        response.transfers.forEach(t => {
            const status = `ID: ${t.uuid} | ${t.status} | ${(t.percentage * 100).toFixed(1)}% | ${bytesFormatter.format(t.bytes_written)} / ${bytesFormatter.format(t.bytes_expected)}`;
            console.log(status);
            const el = document.getElementById('status');
            if (el) el.textContent = status;
        });
        this.updateUi();
    }

    private handleDropEvent(data: { event: DragEvent; files: DataTransferResponse }) {
        const { event, files } = data;
        event.preventDefault();

        const dropArea = document.getElementById('drop_area');
        if (!dropArea) return;

        const colors: Record<string, string> = {
            'drop': '#3498db',
            'dragenter': 'red',
            'dragleave': 'green'
        };

        dropArea.style.backgroundColor = colors[event.type] || '';

        if (event.type === 'drop' && files.dataTransfer?.files) {
            this.storeFileNames(files);
        }
    }

    private async refreshStatusDisplay(clientType: string) {
        const info = await getInfo();
        const el = document.getElementById('client_status');
        if (!el) return;
        const statusMap: Record<string, string> = {
            'connect': info.connect.status,
            'httpgw': info.httpGateway.info?.version || 'Connected',
            'desktop': 'Ready'
        };
        //el.textContent = statusMap[clientType] || 'Unknown';
        el.textContent = JSON.stringify(info, null, 2);
    }

    private storeFileNames(selection: DataTransferResponse) {
        const files = selection.dataTransfer?.files || [];
        const names = files.map(f => f.name);
        // merge, no dupes
        this.selectedUploadFiles = [...new Set([...this.selectedUploadFiles, ...names])];
        this.updateUi();
    }

    private getTransferSpecSSH(params: any): TransferSpec {
        const url = new URL(this.uiState.serverUrl.replace(/^ssh:/, 'http://'));
        const spec: TransferSpec = {
            remote_host: url.hostname,
            ssh_port: parseInt(url.port, 10) || 22,
            remote_user: (document.getElementById('server_user') as HTMLInputElement).value,
            remote_password: (document.getElementById('server_pass') as HTMLInputElement).value,
            paths: params.sources.map((s: string) => ({ source: s }))
        };

        if (params.operation === 'upload') {
            spec.direction = 'send';
            spec.destination_root = params.destination;
        } else {
            spec.direction = 'receive';
        }
        return spec;
    }

    private async getTransferSpecFromServer(params: any): Promise<TransferSpec> {
        const response = await fetch(`${window.location.origin}/api/tspec`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        });

        const ts = await response.json();
        if (ts.error) throw new Error(ts.error);
        return ts;
    }
}

// Global Entry Point
(async () => {
    try {
        const response = await fetch("/api/config");
        if (!response.ok) throw new Error("Config not found");
        const config = await response.json();
        const app = new ClientApp(config);
        await app.initialize();
    } catch (err) {
        handleError("Startup failed", err);
    }
})();
