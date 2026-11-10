import {
    initSession,
    getStatus,
    getInfo,
    launch,
    getInstallerInfo,
    startTransfer,
    stopTransfer,
    resumeTransfer,
    removeTransfer,
    getAllTransfers,
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

/** A transfer as reported by the SDK. */
type TransferInfo = TransferResponse['transfers'][number];

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

/** Get state of a checkbox or switch. */
const isChecked = (id: string) => (document.getElementById(id) as HTMLInputElement)?.checked ?? false;

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
    // readable on both light and dark backgrounds
    'RUNNING': '#24a148',
    'DEGRADED': '#f1c21b',      // partly working
    'DISCONNECTED': '#ff832b',  // connection lost, often recoverable by relaunching
    'FAILED': '#fa4d56'         // client not reachable
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
    /**
     * Transfers known by the app, by uuid, updated by SDK activity events.
     */
    private transfers = new Map<string, TransferInfo>();

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
            'folder_for_upload': this.config.server.folder_upload,
            'basic_access_key': this.config.node.username,
            'basic_secret': this.config.node.password
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
        document.getElementById('btn_select_files')?.addEventListener('click', () => this.pickFiles('file'));
        document.getElementById('btn_select_folders')?.addEventListener('click', () => this.pickFiles('folder'));
        document.getElementById('transfers')?.addEventListener('click', e => {
            const button = (e.target as HTMLElement).closest('button');
            if (button?.dataset.action && button.dataset.id) {
                this.controlTransfer(button.dataset.action, button.dataset.id);
            }
        });
        document.getElementById('btn_start_transfer')?.addEventListener('click', () => this.startClientTransfer());

        const initialClient = this.uiState.client;
        await this.reinitSdk(initialClient);
        this.currentClient = initialClient;
        await this.updateUi();
    }

    // =====================
    // UI event Handlers
    // =====================

    /** Select local files or folders to upload with the native dialog of the transfer client. */
    async pickFiles(select: 'file' | 'folder') {
        try {
            const response = await showSelectDialog({ select, multiple: true });
            const files = response.dataTransfer?.files || [];
            // replace the selection only once the user has actually picked files
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
            basic_token: state.authType === 'basic_token',
            basic_access_key: state.authType === 'basic_token' ? getVal('basic_access_key') : undefined,
            basic_secret: state.authType === 'basic_token' ? getVal('basic_secret') : undefined
        };

        try {
            let spec: TransferSpec;
            if (state.authType === "ssh_creds") {
                spec = this.getTransferSpecSSH(params);
            } else {
                spec = await this.getTransferSpecFromServer(params);
                spec.authentication = 'token';
            }

            // second argument: IBM Aspera settings for this transfer (not part of the transfer spec).
            // allow_dialogs is for Desktop only: true brings the app to the front, false keeps it in the background.
            await startTransfer(spec, state.client === 'desktop' ? { allow_dialogs: state.allowDialogs } : {});
            if (!isDownload) this.selectedUploadFiles = [];
            this.updateUi();
        } catch (err) {
            handleError("Transfer Failed", err);
        }
    }

    /** Stop, resume or remove a transfer, from the buttons of the transfer list. */
    private async controlTransfer(action: string, id: string) {
        try {
            if (action === 'stop') {
                await stopTransfer(id);
            } else if (action === 'resume') {
                // resuming creates a new transfer object
                const resumed = await resumeTransfer(id);
                this.transfers.set(resumed.uuid, resumed);
            } else if (action === 'remove') {
                await removeTransfer(id);
                this.transfers.delete(id);
            }
            this.renderTransfers();
        } catch (err) {
            handleError(`Cannot ${action} transfer`, err);
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
            allowDialogs: isChecked('allow_dialogs'),
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
            'desktop_options': state.client === 'desktop',
            'div_ssh_creds_selector': ['connect', 'desktop'].includes(state.client),
            'hsts_basic_info': state.authType === 'basic_token',
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

                // Show transfers that already exist for this application
                try {
                    (await getAllTransfers()).forEach(t => this.transfers.set(t.uuid, t));
                    this.renderTransfers();
                } catch (err) {
                    console.debug('Cannot list existing transfers:', err);
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


    private async addLaunchLink(status: string) {
        const el = document.getElementById('client_status');
        if (!el) return;

        // Always show a "Launch" link
        let extra = ` - <a href="#" id="launch_desktop" style="color:blue;text-decoration:underline;">${status === 'FAILED' ? 'Launch' : 'Relaunch'} Desktop App</a>`;

        // For FAILED: also fetch installer URL and show a download link
        if (status === 'FAILED') {
            try {
                const info = await getInstallerInfo();
                const entry = info.entries[0];
                if (entry?.url) {
                    extra += ` - <a href="${entry.url}" target="_blank" rel="noopener noreferrer" style="color:blue;text-decoration:underline;">Download (${entry.platform} ${entry.version})</a>`;
                }
            } catch (e) {
                console.debug('Could not fetch installer info:', e);
            }
        }

        el.innerHTML += extra;
        document.getElementById('launch_desktop')?.addEventListener('click', (e) => {
            e.preventDefault();
            launch();
        });
    }

    private handleTransferEvents(response: TransferResponse) {
        response.transfers.forEach(t => {
            console.log(`Transfer ${t.uuid}: ${t.status} ${(t.percentage * 100).toFixed(1)}%`);
            if (t.status === 'removed') {
                this.transfers.delete(t.uuid);
            } else {
                this.transfers.set(t.uuid, t);
            }
        });
        this.renderTransfers();
        this.updateUi();
    }

    /** Display the list of transfers, with the buttons that are relevant for the status of each one. */
    private renderTransfers() {
        const el = document.getElementById('transfers');
        if (!el) return;
        el.replaceChildren();
        if (this.transfers.size === 0) {
            el.textContent = 'No transfer';
            return;
        }
        for (const t of this.transfers.values()) {
            const row = document.createElement('div');
            row.className = 'transfer';
            const info = document.createElement('span');
            info.textContent = `${t.uuid} | ${t.status} | ${(t.percentage * 100).toFixed(1)}% | ` +
                `${bytesFormatter.format(t.bytes_written)} / ${bytesFormatter.format(t.bytes_expected)}` +
                (t.error_desc ? ` | ${t.error_desc}` : '');
            row.append(info);
            const actions: [string, string][] = [];
            if (['initiating', 'queued', 'running', 'willretry'].includes(t.status)) actions.push(['stop', 'Stop']);
            if (['paused', 'cancelled', 'failed'].includes(t.status)) actions.push(['resume', 'Resume']);
            actions.push(['remove', 'Remove']);
            for (const [action, label] of actions) {
                const button = document.createElement('button');
                button.textContent = label;
                button.dataset.action = action;
                button.dataset.id = t.uuid;
                row.append(button);
            }
            el.append(row);
        }
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
