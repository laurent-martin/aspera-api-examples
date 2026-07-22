const params = new URLSearchParams(window.location.search);
const specUrl = params.get("spec");

const app = document.getElementById("app");

function addCacheBuster(url) {
  const u = new URL(url);

  // Prevent browser caching of fetched spec
  u.searchParams.set("_t", Date.now());

  return u.toString();
}

if (!specUrl) {

  app.innerHTML = `
    <div id="form-container">
      <h1>OpenAPI Viewer</h1>

      <p>Enter an OpenAPI / Swagger spec URL:</p>

      <input
        id="spec-input"
        type="text"
        placeholder="https://example.com/openapi.json"
      />

      <button id="load-btn">Load Documentation</button>

      <div class="error" id="error"></div>
    </div>
  `;

  const input = document.getElementById("spec-input");

  function loadSpec() {
    const url = input.value.trim();

    if (!url) {
      document.getElementById("error").textContent =
        "Please enter a URL";
      return;
    }

    const next =
      window.location.pathname +
      "?spec=" +
      encodeURIComponent(url);

    window.location.href = next;
  }

  document
    .getElementById("load-btn")
    .addEventListener("click", loadSpec);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      loadSpec();
    }
  });

} else {

  app.innerHTML = `
    <div id="redoc-container"></div>
  `;

  const uncachedSpecUrl = addCacheBuster(specUrl);

  Redoc.init(
    uncachedSpecUrl,
    {
      hideDownloadButton: false,
      expandResponses: "200,201"
    },
    document.getElementById("redoc-container")
  );
}
