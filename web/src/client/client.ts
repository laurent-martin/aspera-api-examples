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

/** Formatter for human-readable file sizes. */
const bytesFormatter = new Intl.NumberFormat('en', {
    style: 'unit',
    unit: 'byte',
    notation: 'compact',
    unitDisplay: 'short',
    maximumFractionDigits: 2
});

/** Get value of input text. */
const getVal = (id: string) => (document.getElementById(id) as HTMLInputElement)?.value;

/** Get status of radio button */
const getChecked = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value;

/** Display error on UI. */
function handleError(title: string, err: any) {
    const msg = err?.message || JSON.stringify(err);
    console.error(`${title}:`, err);
    alert(`${title}\n${msg}`);
}

class ClientApp {
    // =====================
    // STATE: Centralized state.
    // =====================
    /**
     * Currently selected files.
     */
    private selectedUploadFiles: string[] = [];
    /**
     * Currently selected transfer client.
     */
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
            const element = document.getElementById(id) as HTMLInputElement;
            if (element) element.value = val;
        });
        // Event Bindings
        document.querySelectorAll('input[type=radio]').forEach(el => el.addEventListener('change', () => this.updateUi()));
        document.getElementById('btn_select_files')?.addEventListener('click', () => this.pickFiles());
        document.getElementById('btn_start_transfer')?.addEventListener('click', () => this.startClientTransfer());
        await this.updateUi();
    }

    // =====================
    // UI event Handlers
    // =====================

    async pickFiles() {
        this.selectedUploadFiles = [];
        try {
            const response = await showSelectDialog({ select: 'file', multiple: true, });
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
            const initParams = {
                // unique application ID for this application
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
            }
            console.log("Initializing SDK with params:", initParams);
            await init(initParams);
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
            'dragenter': 'green',
            'dragleave': 'red'
        };

        dropArea.style.backgroundColor = colors[event.type] || '';

        const file_list = files.dataTransfer?.files;
        if (event.type === 'drop' && file_list) {
            const names = file_list.map(f => f.name);
            // merge, no dupes
            this.selectedUploadFiles = [...new Set([...this.selectedUploadFiles, ...names])];
            this.updateUi();
        }
    }

    private async refreshStatusDisplay(clientType: string) {
        const info = await getInfo();
        const el = document.getElementById('client_status');
        if (!el) return;

        let version: string = 'N/A';
        switch (clientType) {
            case 'desktop':
                version = info.version;
                break;
            case 'httpgw':
                version = info.httpGateway?.info?.version || 'N/A';
                break;
            case 'connect':
                version = info.connect?.status || 'N/A';
                break;
        }
        el.textContent = `Version: ${version}`;
    }

    /** Build Transfer Specification for SSH-based authentication */
    private getTransferSpecSSH(params: any): TransferSpec {
        const serverUrl = this.uiState.serverUrl;
        if (!serverUrl) {
            throw new Error('Server URL is required for SSH authentication');
        }
        const url = new URL(serverUrl.replace(/^ssh:/, 'http://'));
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

    /** Get Transfer Specification from broker application */
    private async getTransferSpecFromServer(params: any): Promise<TransferSpec> {
        const response = await fetch(`${window.location.origin}/api/tspec`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        });
        const spec = await response.json();
        if (spec.error) throw new Error(spec.error);
        return spec;
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
