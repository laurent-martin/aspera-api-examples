import {
    initSession,
    getStatus,
    getInfo,
    launch,
    startTransfer,
    showSelectFileDialog,
    showSelectFolderDialog,
    initDragDrop,
    createDropzone,
    removeDropzone,
    registerActivityCallback,
    registerStatusCallback,
    type DataTransferResponse,
    type TransferResponse,
    type TransferSpec,
    type FileDialogOptions,
    type FolderDialogOptions,
    type SdkStatus
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

/** Merge arrays and remove duplicates */
const uniqueMerge = <T>(...arrays: T[][]): T[] => [...new Set(arrays.flat())];

/** Status color mapping */
const STATUS_COLORS: Record<string, string> = {
    'RUNNING': 'green',
    'DEGRADED': 'orange',
    'FAILED': 'red',
    'DISCONNECTED': 'red'
};

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
    private currentClient: 'desktop' | 'connect' | 'httpgw' | null = null;
    /**
     * Flag to track if drag & drop has been initialized for current client
     */
    private dragDropInitialized: boolean = false;

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

        // Restore selected client from sessionStorage if available
        const savedClient = sessionStorage.getItem('selectedClient');
        if (savedClient) {
            const radioButton = document.querySelector<HTMLInputElement>(`input[name="client_select"][value="${savedClient}"]`);
            if (radioButton) {
                radioButton.checked = true;
            }
            sessionStorage.removeItem('selectedClient'); // Clean up
        }

        // Event Bindings
        document.querySelectorAll('input[type=radio]').forEach(el => el.addEventListener('change', () => this.updateUi()));
        document.getElementById('btn_select_files')?.addEventListener('click', () => this.pickFiles());
        document.getElementById('btn_start_transfer')?.addEventListener('click', () => this.startClientTransfer());

        const initialClient = this.uiState.client;
        await this.reinitSdk(initialClient);
        this.currentClient = initialClient;
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
            this.selectedUploadFiles = uniqueMerge(files.map(f => f.name));
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
        // SDK Transition Logic - Force page reload when switching transfer client
        if (state.client !== this.currentClient) {
            console.log(`Switching client from ${this.currentClient} to ${state.client}`);
            // Store the selected client in sessionStorage before reload
            sessionStorage.setItem('selectedClient', state.client);
            // Force page reload to cleanly reinitialize the SDK
            window.location.reload();
            return; // Exit early as page will reload
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
            // Clean up old dropzone before reinitialization
            try {
                await removeDropzone('#drop_area');
                this.dragDropInitialized = false;
            } catch (e) {
                // Ignore if no existing dropzone
            }

            const clientConfigs = {
                httpgw: {
                    httpGatewaySettings: { url: this.config.httpgw.url, forceGateway: true },
                    connectSettings: { useConnect: false, fallback: false, dragDropEnabled: false }
                },
                connect: {
                    connectSettings: { useConnect: true, fallback: false, dragDropEnabled: true, method: 'extension' as const }
                },
                desktop: {
                    connectSettings: { useConnect: false, fallback: false, dragDropEnabled: true, method: 'extension' as const }
                }
            };

            const initParams: any = {
                appId: "C81C7514-BAE4-44F7-83FB-7C4DC5BB0EE7",
                supportMultipleUsers: false,
                ...clientConfigs[clientType as keyof typeof clientConfigs]
            };

            console.log("Initializing SDK with params:", initParams);

            // Register status callback to monitor SDK lifecycle
            registerStatusCallback(this.handleStatusEvents.bind(this));

            // Register activity callback for transfer events
            registerActivityCallback(this.handleTransferEvents.bind(this));

            // Use initSession instead of init for non-blocking initialization
            // Drag & drop will be initialized when status becomes RUNNING
            initSession(initParams);
        } catch (err) {
            handleError("Initialization Failed", err);
        }
    }

    private async handleStatusEvents(status: SdkStatus) {
        console.log('SDK Status:', status);

        // When status changes to RUNNING, wait a bit then initialize drag & drop
        if (status === 'RUNNING') {
            // Wait for SDK to be fully ready before initializing drag & drop
            setTimeout(async () => {
                // Initialize drag & drop only once when SDK becomes ready
                if (!this.dragDropInitialized && this.currentClient !== 'httpgw') {
                    try {
                        await initDragDrop();
                        await createDropzone(this.handleDropEvent.bind(this), '#drop_area', { drop: true, allowPropagation: true });
                        this.dragDropInitialized = true;
                        console.log('Drag & drop initialized successfully');
                    } catch (err) {
                        console.error('Failed to initialize drag & drop:', err);
                    }
                }

                // Refresh status display after drag & drop is initialized
                await this.refreshStatusDisplay(this.currentClient || 'desktop');
            }, 500); // Wait 500ms for SDK to be fully verified
        } else {
            // For non-RUNNING statuses, refresh immediately
            await this.refreshStatusDisplay(this.currentClient || 'desktop');
        }

        // Add launch link for Desktop when FAILED or DISCONNECTED
        if (this.currentClient === 'desktop' && ['FAILED', 'DISCONNECTED'].includes(status)) {
            this.addLaunchLink(status);
        }
    }


    private addLaunchLink(status: string) {
        const el = document.getElementById('client_status');
        if (!el) return;

        const linkId = status === 'FAILED' ? 'launch_desktop' : 'relaunch_desktop';
        const linkText = status === 'FAILED' ? 'Launch Desktop App' : 'Relaunch Desktop App';

        el.innerHTML += ` - <a href="#" id="${linkId}" style="color: blue; text-decoration: underline;">${linkText}</a>`;

        setTimeout(() => {
            document.getElementById(linkId)?.addEventListener('click', (e) => {
                e.preventDefault();
                console.log(`Attempting to ${status === 'FAILED' ? 'launch' : 'relaunch'} IBM Aspera for Desktop...`);
                launch();
            });
        }, 0);
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

    private handleDropEvent(data: { event: DragEvent; files?: DataTransferResponse }) {
        const { event, files } = data;
        if (!files) return;
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
            this.selectedUploadFiles = uniqueMerge(this.selectedUploadFiles, file_list.map(f => f.name));
            this.updateUi();
        }
    }

    private async refreshStatusDisplay(clientType: string) {
        const el = document.getElementById('client_status');
        if (!el) return;

        try {
            const info = await getInfo();
            console.log('SDK Info (full):', JSON.stringify(info, null, 2));

            const status = getStatus();
            const statusFormatters = {
                desktop: () => `Status: ${status || 'Unknown'} | Desktop Version: ${info.version || 'N/A'}`,
                httpgw: () => `Status: ${status || 'Unknown'} | Gateway Version: ${info.httpGateway?.info?.version || 'N/A'}`,
                connect: () => {
                    const connectInfo = info.connect;
                    console.log('Connect info:', connectInfo);
                    return `Status: ${connectInfo?.status || 'N/A'} | Active: ${connectInfo?.active ? '✓' : '✗'}`;
                }
            };

            el.textContent = statusFormatters[clientType as keyof typeof statusFormatters]?.() || `Status: ${status || 'Unknown'}`;
            el.style.color = (status && STATUS_COLORS[status]) || 'gray';
        } catch (err) {
            console.debug('SDK info unavailable:', err);
            const status = getStatus();
            el.textContent = `Status: ${status || 'N/A'}`;
            el.style.color = 'gray';
        }
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
