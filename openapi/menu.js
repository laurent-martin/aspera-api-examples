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
    const format = filename.endsWith(".yaml") ? "yaml" : "json";
    const nameWithoutExt = filename.replace(/\.(yaml|json)$/, "");

    // Extract name and version
    const versionMatch = nameWithoutExt.match(/-(\d+\.\d+\.\d+)/);
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

// Function to generate viewer URL
function generateViewerUrl(filename) {
    const baseUrl = "https://eudemo.asperademo.com/openapi.html?spec=";
    const specUrl = `https://raw.githubusercontent.com/laurent-martin/aspera-api-examples/refs/heads/main/openapi/${encodeURIComponent(filename)}`;
    return baseUrl + encodeURIComponent(specUrl);
}

// Function to generate raw URL
function generateRawUrl(filename) {
    return `https://raw.githubusercontent.com/laurent-martin/aspera-api-examples/refs/heads/main/openapi/${encodeURIComponent(filename)}`;
}

// Function to create API card
function createApiCard(apiInfo) {
    const card = document.createElement("div");
    card.className = apiInfo.isEnhanced ? "api-card enhanced-card" : "api-card";
    card.dataset.searchText =
        `${apiInfo.displayName} ${apiInfo.version || ""} ${apiInfo.format}`.toLowerCase();

    const versionBadge = apiInfo.version
        ? `<span class="api-version">v${apiInfo.version}</span>`
        : "";

    const enhancedBadge = apiInfo.isEnhanced
        ? '<span class="api-format" style="background: #4caf50; color: white;">Enhanced</span>'
        : "";

    card.innerHTML = `
        <div class="api-name">${apiInfo.displayName}</div>
        ${versionBadge}
        <span class="api-format">${apiInfo.format}</span>
        <span class="api-format" style="background: #9c27b0; color: white;">${apiInfo.specVersion}</span>
        ${enhancedBadge}
        <div class="api-links">
            <a href="${generateViewerUrl(apiInfo.filename)}"
               target="_blank"
               class="btn btn-primary"
               title="Open in OpenAPI viewer">
                📖 View Spec
            </a>
            <a href="${generateRawUrl(apiInfo.filename)}"
               target="_blank"
               class="btn btn-secondary"
               title="View raw file">
                📄 Raw File
            </a>
        </div>
    `;

    return card;
}

// Function to display APIs
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

    specs.forEach((spec) => {
        const apiInfo = parseApiInfo(spec);
        const card = createApiCard(apiInfo);
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

// Made with Bob
