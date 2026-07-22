// List of OpenAPI files with their spec versions
const openApiSpecs = [
    {
        filename: "IBM Aspera Faspex API-5.0-enhanced.yaml",
        specVersion: "OpenAPI 3.1",
    },
    { filename: "IBM Aspera Faspex API-5.0.json", specVersion: "OpenAPI 3.0" },
    { filename: "IBM Aspera Node API-4.4.1.json", specVersion: "Swagger 2.0" },
    { filename: "IBM Aspera Node API-4.4.1.yaml", specVersion: "Swagger 2.0" },
    { filename: "IBM Aspera Node API-4.4.6.yaml", specVersion: "OpenAPI 3.0" },
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
    { filename: "IBM_Aspera_Shares.yaml", specVersion: "OpenAPI 3.0" },
];

// Function to extract information from spec object
function parseApiInfo(spec) {
    const filename = spec.filename;
    const format = filename.endsWith(".yaml") ? "YAML" : "JSON";
    const nameWithoutExt = filename.replace(/\.(yaml|json)$/, "");

    // Extract name and version
    const versionMatch = nameWithoutExt.match(/-(\d+\.\d+(?:\.\d+)?)/);
    const version = versionMatch ? versionMatch[1] : null;

    let name = nameWithoutExt;
    if (version) {
        name = name.replace(`-${version}`, "");
    }

    // Check if it's an enhanced version
    const isEnhanced = nameWithoutExt.includes("-enhanced");
    if (isEnhanced) {
        name = name.replace("-enhanced", "");
    }

    return {
        filename,
        name,
        version,
        format,
        isEnhanced,
        specVersion: spec.specVersion,
        displayName: name.replace(/_/g, " "),
    };
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

// Function to generate viewer URL
function generateViewerUrl(filename) {
    const specUrl = `https://raw.githubusercontent.com/laurent-martin/aspera-api-examples/refs/heads/main/openapi/${encodeURIComponent(filename)}`;
    return `openapi.html?spec=${encodeURIComponent(specUrl)}`;
}

// Function to generate raw URL
function generateRawUrl(filename) {
    return `https://raw.githubusercontent.com/laurent-martin/aspera-api-examples/refs/heads/main/openapi/${encodeURIComponent(filename)}`;
}

// Function to create API card for a product group
function createProductCard(productName, versions) {
    const card = document.createElement("div");

    // Check if any version is enhanced
    const hasEnhanced = versions.some(v => v.isEnhanced);
    card.className = hasEnhanced ? "api-card enhanced-card" : "api-card";

    // Build search text from all versions
    const searchText = `${productName} ${versions.map(v =>
        `${v.version || ""} ${v.format} ${v.specVersion}`
    ).join(" ")}`.toLowerCase();
    card.dataset.searchText = searchText;

    // Create version lines
    const versionLines = versions.map(apiInfo => {
        const enhancedText = apiInfo.isEnhanced ? " • Enhanced" : "";
        return `
            <div class="version-line">
                <div class="version-info">
                    <span class="version-badge">${apiInfo.format}</span>
                    <span class="version-text">v${apiInfo.version || "1.0"}</span>
                    <span class="spec-badge">${apiInfo.specVersion}</span>
                    ${apiInfo.isEnhanced ? '<span class="enhanced-badge">Enhanced</span>' : ''}
                </div>
                <div class="version-actions">
                    <a href="${generateViewerUrl(apiInfo.filename)}"
                       target="_blank"
                       class="icon-btn"
                       title="View in OpenAPI viewer">
                        📖
                    </a>
                    <a href="${generateRawUrl(apiInfo.filename)}"
                       target="_blank"
                       class="icon-btn"
                       title="View raw file">
                        📄
                    </a>
                </div>
            </div>
        `;
    }).join("");

    card.innerHTML = `
        <div class="api-name">${productName}</div>
        <div class="versions-container">
            ${versionLines}
        </div>
    `;

    return card;
}

// Function to display APIs grouped by product
function displayApis(specs = openApiSpecs) {
    const grid = document.getElementById("apiGrid");
    grid.innerHTML = "";

    if (specs.length === 0) {
        grid.innerHTML = `
            <div class="no-results" style="grid-column: 1 / -1;">
                <div class="no-results-icon">🔍</div>
                <div class="no-results-text">No APIs found</div>
            </div>
        `;
        return;
    }

    const groupedSpecs = groupSpecsByProduct(specs);

    // Sort product names alphabetically
    const sortedProducts = Object.keys(groupedSpecs).sort();

    sortedProducts.forEach((productName) => {
        const versions = groupedSpecs[productName];
        const card = createProductCard(productName, versions);
        grid.appendChild(card);
    });
}

// Function to update statistics
function updateStats() {
    const yamlCount = openApiSpecs.filter((s) =>
        s.filename.endsWith(".yaml"),
    ).length;
    const jsonCount = openApiSpecs.filter((s) =>
        s.filename.endsWith(".json"),
    ).length;

    document.getElementById("totalApis").textContent = openApiSpecs.length;
    document.getElementById("yamlCount").textContent = yamlCount;
    document.getElementById("jsonCount").textContent = jsonCount;
}

// Search function
function handleSearch(event) {
    const searchTerm = event.target.value.toLowerCase();
    const cards = document.querySelectorAll(".api-card");
    let visibleCount = 0;

    cards.forEach((card) => {
        const searchText = card.dataset.searchText;
        if (searchText.includes(searchTerm)) {
            card.style.display = "block";
            visibleCount++;
        } else {
            card.style.display = "none";
        }
    });

    // Display message if no results
    const grid = document.getElementById("apiGrid");
    const noResults = grid.querySelector(".no-results");

    if (visibleCount === 0 && searchTerm !== "") {
        if (!noResults) {
            const noResultsDiv = document.createElement("div");
            noResultsDiv.className = "no-results";
            noResultsDiv.style.gridColumn = "1 / -1";
            noResultsDiv.innerHTML = `
                <div class="no-results-icon">🔍</div>
                <div class="no-results-text">No APIs found for "${event.target.value}"</div>
            `;
            grid.appendChild(noResultsDiv);
        }
    } else if (noResults) {
        noResults.remove();
    }
}

// Initialization
document.addEventListener("DOMContentLoaded", () => {
    displayApis();
    updateStats();

    const searchInput = document.getElementById("searchInput");
    searchInput.addEventListener("input", handleSearch);
});
