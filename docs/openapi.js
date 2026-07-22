const params = new URLSearchParams(window.location.search);
const specUrl = params.get("spec");

function addCacheBuster(url) {
  const u = new URL(url);
  u.searchParams.set("_t", Date.now());
  return u.toString();
}

if (!specUrl) {

  const input = document.getElementById("spec-input");

  function loadSpec() {
    const url = input.value.trim();

    if (!url) {
      document.getElementById("error").textContent = "Please enter a URL";
      return;
    }

    window.location.href =
      window.location.pathname + "?spec=" + encodeURIComponent(url);
  }

  document.getElementById("load-btn").addEventListener("click", loadSpec);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadSpec();
  });

} else {

  document.getElementById("form-screen").hidden = true;
  document.getElementById("redoc-container").hidden = false;

  Redoc.init(
    addCacheBuster(specUrl),
    {
      hideDownloadButton: false,
      expandResponses: "200,201"
    },
    document.getElementById("redoc-container")
  );

}
