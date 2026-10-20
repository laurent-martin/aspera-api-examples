// List of OpenAPI files with their spec versions
const openApiSpecs = [
    {
        filename: "IBM Aspera Console-enhanced.yaml",
        specVersion: "OpenAPI 3.1",
    },
    {
        filename: "IBM Aspera Faspex API-5.0-enhanced.yaml",
        specVersion: "OpenAPI 3.1",
    },
    {
        filename: "IBM Aspera Faspex API-5.0.json",
        specVersion: "OpenAPI 3.0",
    },
    {
        filename: "IBM Aspera Node API-4.4.1.json",
        specVersion: "Swagger 2.0",
    },
    {
        filename: "IBM Aspera Node API-4.4.1.yaml",
        specVersion: "Swagger 2.0",
    },
    {
        filename: "IBM Aspera Node API-4.4.6.yaml",
        specVersion: "OpenAPI 3.0",
    },
    {
        filename: "IBM Aspera Orchestrator API-v1-enhanced.yaml",
        specVersion: "OpenAPI 3.0",
    },
    {
        filename: "IBM Aspera Orchestrator API-v1.yaml",
        specVersion: "OpenAPI 3.0",
    },
    {
        filename: "IBM Aspera faspio Gateway API-1.0.0-enhanced.yaml",
        specVersion: "OpenAPI 3.1",
    },
    {
        filename: "IBM Aspera faspio Gateway API-1.0.0.json",
        specVersion: "OpenAPI 3.0",
    },
    {
        filename: "IBM Aspera faspio Gateway API-1.0.0.yaml",
        specVersion: "OpenAPI 3.0",
    },
    {
        filename: "IBM Aspera on Cloud API-0.2.6-enhanced.yaml",
        specVersion: "OpenAPI 3.1",
    },
    {
        filename: "IBM Aspera on Cloud API-0.2.6.json",
        specVersion: "OpenAPI 3.0",
    },
    {
        filename: "IBM Aspera on Cloud API-0.2.6.yaml",
        specVersion: "OpenAPI 3.0",
    },
    {
        filename: "IBM Aspera on Cloud Automation API-1.0.5-enhanced.yaml",
        specVersion: "OpenAPI 3.1",
    },
    {
        filename: "IBM Aspera on Cloud Automation API-1.0.5.yaml",
        specVersion: "OpenAPI 3.0",
    },
    {
        filename: "IBM_Aspera_Shares.yaml",
        specVersion: "OpenAPI 3.0",
    },
];

// Filter groups: values of the same group are alternatives, groups are combined
const filterGroups = [
    { key: "format", label: "Format" },
    { key: "spec", label: "Specification" },
    { key: "variant", label: "Variant" },
];

// Selected values per filter group: none means no filter
const activeFilters = Object.fromEntries(filterGroups.map((group) => [group.key, new Set()]));

// Icons (Lucide, ISC license)
const icons = {
    docs: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
    raw: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
};

// Function to generate an inline SVG icon
function icon(name) {
    return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}

// Function to extract information from spec object
function parseApiInfo(spec) {
    const filename = spec.filename;
    const format = filename.endsWith(".yaml") ? "YAML" : "JSON";
    const nameWithoutExt = filename.replace(/\.(yaml|json)$/, "");

    // Check if it's an enhanced version
    const isEnhanced = nameWithoutExt.endsWith("-enhanced");
    let name = nameWithoutExt.replace(/-enhanced$/, "");

    // Extract version at end of name, e.g. "-4.4.6" or "-v1"
    const versionMatch = name.match(/-v?(\d+(?:\.\d+)*)$/);
    const version = versionMatch ? versionMatch[1] : null;
    if (versionMatch) {
        name = name.slice(0, versionMatch.index);
    }

    return {
        filename,
        name,
        version,
        format,
        isEnhanced,
        variant: isEnhanced ? "Enhanced" : "Original",
        specVersion: spec.specVersion,
        displayName: name.replace(/_/g, " ").replace(/^IBM /, ""),
    };
}

// Function to get the value of a spec for a filter group
function filterValue(apiInfo, key) {
    return { format: apiInfo.format, spec: apiInfo.specVersion, variant: apiInfo.variant }[key];
}

// Function to group specs by product name
function groupSpecsByProduct(specs) {
    const grouped = {};

    specs.forEach((spec) => {
        const apiInfo = parseApiInfo(spec);
        const productName = apiInfo.displayName;

        if (!grouped[productName]) {
            grouped[productName] = [];
        }

        grouped[productName].push(apiInfo);
    });

    // Sort versions within each product (newest first)
    Object.keys(grouped).forEach(productName => {
        grouped[productName].sort((a, b) => {
            // Sort by version (descending), then by enhanced status, then by format
            if (a.version && b.version) {
                const versionCompare = b.version.localeCompare(a.version, undefined, { numeric: true });
                if (versionCompare !== 0) return versionCompare;
            }
            if (a.isEnhanced !== b.isEnhanced) return a.isEnhanced ? -1 : 1;
            return a.format.localeCompare(b.format);
        });
    });

    return grouped;
}

// Function to generate raw URL
function generateRawUrl(filename) {
    return `https://raw.githubusercontent.com/laurent-martin/aspera-api-examples/refs/heads/main/openapi/${encodeURIComponent(filename)}`;
}

// Function to generate viewer URL
function generateViewerUrl(filename) {
    return `openapi.html?spec=${encodeURIComponent(generateRawUrl(filename))}`;
}

// Function to create API card for a product group
function createProductCard(productName, versions) {
    const card = document.createElement("section");
    card.className = "api-card";

    // Create version lines
    const versionLines = versions.map(apiInfo => {
        const rawUrl = generateRawUrl(apiInfo.filename);
        const searchText = `${productName} ${apiInfo.version || ""} ${apiInfo.format} ${apiInfo.specVersion} ${apiInfo.variant}`.toLowerCase();
        return `
            <div class="version-line" data-format="${apiInfo.format}" data-spec="${apiInfo.specVersion}"
                 data-variant="${apiInfo.variant}" data-search="${searchText}">
                <div class="version-info">
                    ${apiInfo.version ? `<span class="version-text">v${apiInfo.version}</span>` : ""}
                    <span class="badge">${apiInfo.specVersion}</span>
                    <span class="badge">${apiInfo.format}</span>
                    ${apiInfo.isEnhanced ? '<span class="badge badge-accent">Enhanced</span>' : ""}
                </div>
                <div class="version-actions">
                    <a href="${generateViewerUrl(apiInfo.filename)}" class="action action-primary"
                       title="View documentation">${icon("docs")}Docs</a>
                    <a href="${rawUrl}" target="_blank" rel="noopener" class="action"
                       title="Open raw file">${icon("raw")}Raw</a>
                    <button type="button" class="action copy-button" data-url="${rawUrl}"
                            title="Copy file URL" aria-label="Copy file URL">${icon("copy")}</button>
                </div>
            </div>
        `;
    }).join("");

    card.innerHTML = `
        <header class="api-card-header">
            <h2 class="api-name">${productName}</h2>
            <span class="api-count"></span>
        </header>
        ${versionLines}
    `;

    return card;
}

// Function to display APIs grouped by product
function displayApis(specs = openApiSpecs) {
    const grid = document.getElementById("apiGrid");
    grid.innerHTML = "";

    const groupedSpecs = groupSpecsByProduct(specs);

    // Sort product names alphabetically, ignoring case
    const sortedProducts = Object.keys(groupedSpecs).sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }));

    sortedProducts.forEach((productName) => {
        const versions = groupedSpecs[productName];
        const card = createProductCard(productName, versions);
        grid.appendChild(card);
    });
}

// Function to create the filters: one chip per value, grouped
function createFilters() {
    const filters = document.getElementById("filters");
    filterGroups.forEach((group) => {
        // Sort values by version number, then by name
        const values = [...new Set(openApiSpecs.map((spec) => filterValue(parseApiInfo(spec), group.key)))]
            .sort((a, b) => (a.match(/[\d.]+/)?.[0] || "").localeCompare(b.match(/[\d.]+/)?.[0] || "", undefined, { numeric: true })
                || a.localeCompare(b));
        const element = document.createElement("div");
        element.className = "filter-group";
        element.setAttribute("role", "group");
        element.setAttribute("aria-label", group.label);
        element.innerHTML = `
            <span class="filter-label">${group.label}</span>
            ${values.map((value) => `
                <button type="button" class="chip" aria-pressed="false"
                        data-group="${group.key}" data-value="${value}">${value}</button>
            `).join("")}
        `;
        filters.appendChild(element);
    });

    filters.addEventListener("click", (event) => {
        const chip = event.target.closest(".chip");
        if (!chip) return;
        const selected = activeFilters[chip.dataset.group];
        const pressed = !selected.has(chip.dataset.value);
        if (pressed) selected.add(chip.dataset.value);
        else selected.delete(chip.dataset.value);
        chip.setAttribute("aria-pressed", pressed);
        applyFilters();
    });
}

// Function to clear the search and the filters
function clearFilters() {
    document.getElementById("searchInput").value = "";
    Object.values(activeFilters).forEach((selected) => selected.clear());
    document.querySelectorAll(".chip").forEach((chip) => chip.setAttribute("aria-pressed", "false"));
    applyFilters();
}

// Function to show versions matching search and filters, and cards with a visible version
function applyFilters() {
    const searchInput = document.getElementById("searchInput");
    const searchWords = searchInput.value.toLowerCase().split(/\s+/).filter(Boolean);
    const lines = document.querySelectorAll(".version-line");
    let visibleCount = 0;

    lines.forEach((line) => {
        const visible = filterGroups.every((group) =>
            activeFilters[group.key].size === 0 || activeFilters[group.key].has(line.dataset[group.key]))
            && searchWords.every((word) => line.dataset.search.includes(word));
        line.hidden = !visible;
        if (visible) visibleCount++;
    });

    document.querySelectorAll(".api-card").forEach((card) => {
        const total = card.querySelectorAll(".version-line").length;
        const shown = card.querySelectorAll(".version-line:not([hidden])").length;
        const files = total > 1 ? "files" : "file";
        card.querySelector(".api-count").textContent = shown < total ? `${shown} of ${total} ${files}` : `${total} ${files}`;
        card.hidden = shown === 0;
    });

    const filtered = visibleCount < lines.length;
    document.getElementById("resultCount").textContent = filtered
        ? `Showing ${visibleCount} of ${lines.length} specification files`
        : `${lines.length} specification files`;
    document.getElementById("clearFilters").hidden = !filtered && searchWords.length === 0;
    document.getElementById("noResults").hidden = visibleCount > 0;
}

// Function to copy the file URL, and show the result on the button
async function copyUrl(button) {
    const copied = await navigator.clipboard.writeText(button.dataset.url).then(() => true, (error) => {
        console.error(error);
        return false;
    });
    button.innerHTML = copied ? `${icon("check")}Copied` : "Copy failed";
    button.classList.add(copied ? "copied" : "failed");
    setTimeout(() => {
        button.innerHTML = icon("copy");
        button.classList.remove("copied", "failed");
    }, 1500);
}

// Initialization
document.addEventListener("DOMContentLoaded", () => {
    displayApis();
    createFilters();
    applyFilters();

    const searchInput = document.getElementById("searchInput");
    searchInput.addEventListener("input", applyFilters);
    document.getElementById("clearFilters").addEventListener("click", clearFilters);

    document.getElementById("apiGrid").addEventListener("click", (event) => {
        const button = event.target.closest(".copy-button");
        if (button) copyUrl(button);
    });

    // "/" focuses the search, Escape clears it
    document.addEventListener("keydown", (event) => {
        if (event.key === "/" && !event.target.closest("input, textarea")) {
            event.preventDefault();
            searchInput.focus();
        }
    });
    searchInput.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            searchInput.value = "";
            applyFilters();
        }
    });
});
