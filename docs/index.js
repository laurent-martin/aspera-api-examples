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
        filename: "IBM Aspera Orchestrator API-v1.yaml",
        specVersion: "OpenAPI 3.0",
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

// Function to list the tags of a spec, with their badge class
function getTags(apiInfo) {
    const tags = [
        { name: apiInfo.format, badge: "version-badge" },
        { name: apiInfo.specVersion, badge: "spec-badge" },
    ];
    if (apiInfo.isEnhanced) {
        tags.push({ name: "Enhanced", badge: "enhanced-badge" });
    }
    return tags;
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
        const tagNames = getTags(apiInfo).map((tag) => tag.name).join(",");
        return `
            <div class="version-line" data-tags="${tagNames}">
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

// Function to create the tag filter: one checkbox for all tags, and one per tag, all checked
function createTagFilter() {
    const badges = {};
    openApiSpecs.forEach((spec) => {
        getTags(parseApiInfo(spec)).forEach((tag) => {
            badges[tag.name] = tag.badge;
        });
    });

    // Sort tags by badge kind, then by name
    const badgeOrder = ["version-badge", "spec-badge", "enhanced-badge"];
    const tagNames = Object.keys(badges).sort((a, b) =>
        badgeOrder.indexOf(badges[a]) - badgeOrder.indexOf(badges[b]) || a.localeCompare(b));

    const filter = document.getElementById("tagFilter");
    filter.innerHTML = `
        <label class="tag-option tag-all">
            <input type="checkbox" checked>
            All
        </label>
        ${tagNames.map((name) => `
            <label class="tag-option">
                <input type="checkbox" value="${name}" checked>
                <span class="${badges[name]}">${name}</span>
            </label>
        `).join("")}
    `;

    const allBox = filter.querySelector(".tag-all input");
    const tagBoxes = filter.querySelectorAll("input[value]");
    allBox.addEventListener("change", () => {
        tagBoxes.forEach((box) => {
            box.checked = allBox.checked;
        });
        applyFilters();
    });
    tagBoxes.forEach((box) => box.addEventListener("change", applyFilters));
}

// Function to show versions with only checked tags, and cards matching search with a visible version
function applyFilters() {
    const searchInput = document.getElementById("searchInput");
    const searchTerm = searchInput.value.toLowerCase();
    const tagBoxes = [...document.querySelectorAll("#tagFilter input[value]")];
    const checkedTags = new Set(tagBoxes.filter((box) => box.checked).map((box) => box.value));

    // "All" is checked if all tags are, and partially checked if some are
    const allBox = document.querySelector("#tagFilter .tag-all input");
    allBox.checked = checkedTags.size === tagBoxes.length;
    allBox.indeterminate = checkedTags.size > 0 && !allBox.checked;

    const cards = document.querySelectorAll(".api-card");
    let visibleCount = 0;

    cards.forEach((card) => {
        let visibleVersions = 0;
        card.querySelectorAll(".version-line").forEach((line) => {
            const visible = line.dataset.tags.split(",").every((tag) => checkedTags.has(tag));
            line.style.display = visible ? "" : "none";
            if (visible) visibleVersions++;
        });

        if (visibleVersions > 0 && card.dataset.searchText.includes(searchTerm)) {
            card.style.display = "block";
            visibleCount++;
        } else {
            card.style.display = "none";
        }
    });

    // Display message if no results
    const grid = document.getElementById("apiGrid");
    const noResults = grid.querySelector(".no-results");
    if (noResults) {
        noResults.remove();
    }

    if (visibleCount === 0) {
        const noResultsDiv = document.createElement("div");
        noResultsDiv.className = "no-results";
        noResultsDiv.style.gridColumn = "1 / -1";
        noResultsDiv.innerHTML = `
            <div class="no-results-icon">🔍</div>
            <div class="no-results-text">No APIs found</div>
        `;
        if (searchInput.value !== "") {
            noResultsDiv.lastElementChild.textContent += ` for "${searchInput.value}"`;
        }
        grid.appendChild(noResultsDiv);
    }
}

// Initialization
document.addEventListener("DOMContentLoaded", () => {
    displayApis();
    updateStats();
    createTagFilter();

    const searchInput = document.getElementById("searchInput");
    searchInput.addEventListener("input", applyFilters);
});
