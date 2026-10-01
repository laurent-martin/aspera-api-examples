const params = new URLSearchParams(window.location.search);
const specUrl = params.get("spec");
// Selected tags: all tags if no "tag" parameter
const tagParams = params.getAll("tag");

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

function addCacheBuster(url) {
  const u = new URL(url);
  u.searchParams.set("_t", Date.now());
  return u.toString();
}

/**
 * Fetch and parse the spec, JSON or YAML.
 * @param {string} url spec URL
 * @returns {Promise<object>} parsed spec
 */
async function fetchSpec(url) {
  const response = await fetch(addCacheBuster(url));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return jsyaml.load(text);
  }
}

/**
 * List tag names: declared ones first, then those only used in operations.
 * @param {object} spec parsed spec
 * @returns {string[]} tag names
 */
function listTags(spec) {
  const tags = (spec.tags || []).map((tag) => tag.name);
  Object.values(spec.paths || {}).forEach((pathItem) => {
    HTTP_METHODS.forEach((method) => {
      (pathItem[method]?.tags || []).forEach((tag) => {
        if (!tags.includes(tag)) tags.push(tag);
      });
    });
  });
  return tags;
}

/**
 * Keep only operations with a selected tag (untagged operations are kept).
 * @param {object} spec parsed spec
 * @param {Set<string>} selected selected tag names
 * @returns {object} filtered spec
 */
function filterSpec(spec, selected) {
  const paths = {};
  Object.entries(spec.paths || {}).forEach(([path, pathItem]) => {
    const filtered = {};
    Object.entries(pathItem).forEach(([key, value]) => {
      if (!HTTP_METHODS.includes(key) || !value.tags?.length) {
        filtered[key] = value;
        return;
      }
      // Remove unselected tags, else Redoc shows their section
      const tags = value.tags.filter((tag) => selected.has(tag));
      if (tags.length > 0) filtered[key] = { ...value, tags };
    });
    // Remove path only if all its operations were removed
    const hasOperations = (item) => HTTP_METHODS.some((method) => method in item);
    if (hasOperations(filtered) || !hasOperations(pathItem)) paths[path] = filtered;
  });
  const result = { ...spec, paths };
  if (spec.tags) result.tags = spec.tags.filter((tag) => selected.has(tag.name));
  if (spec["x-tagGroups"]) {
    result["x-tagGroups"] = spec["x-tagGroups"]
      .map((group) => ({ ...group, tags: group.tags.filter((tag) => selected.has(tag)) }))
      .filter((group) => group.tags.length > 0);
  }
  return result;
}

/**
 * Reload the page with the selected tags in URL.
 * @param {string[]} selected selected tag names
 * @param {string[]} tags all tag names
 */
function selectTags(selected, tags) {
  const url = new URL(window.location.href);
  url.hash = "";
  url.searchParams.delete("tag");
  if (selected.length < tags.length) {
    // An empty value means no tag selected
    (selected.length > 0 ? selected : [""]).forEach((tag) => url.searchParams.append("tag", tag));
  }
  window.location.replace(url.toString());
}

/**
 * Append a labelled checkbox to the container.
 * @param {HTMLElement} container parent element
 * @param {string} text label text
 * @param {boolean} checked initial state
 * @returns {HTMLInputElement} checkbox
 */
function addCheckbox(container, text, checked) {
  const label = document.createElement("label");
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = checked;
  label.append(box, text);
  container.appendChild(label);
  return box;
}

/**
 * Show the tag filter: one checkbox for all tags, and one per tag.
 * @param {string[]} tags all tag names
 * @param {Set<string>} selected selected tag names
 */
function showTagFilter(tags, selected) {
  const list = document.getElementById("tag-list");
  const allBox = addCheckbox(list, "All", selected.size === tags.length);
  allBox.indeterminate = selected.size > 0 && selected.size < tags.length;
  allBox.parentElement.classList.add("tag-all");
  const tagBoxes = tags.map((tag) => addCheckbox(list, tag, selected.has(tag)));
  allBox.addEventListener("change", () => selectTags(allBox.checked ? tags : [], tags));
  tagBoxes.forEach((box) => box.addEventListener("change", () =>
    selectTags(tags.filter((_, index) => tagBoxes[index].checked), tags)));
  document.getElementById("tag-count").textContent = `(${selected.size}/${tags.length})`;
  const panel = document.getElementById("tag-filter");
  panel.open = selected.size < tags.length;
  panel.hidden = false;
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
  document.body.classList.add("redoc-active");

  const redocOptions = {
    hideDownloadButton: false,
    downloadDefinitionUrl: specUrl,
    expandResponses: "200,201"
  };
  const container = document.getElementById("redoc-container");

  fetchSpec(specUrl).then(
    (spec) => {
      const tags = listTags(spec);
      const selected = new Set(tagParams.length > 0 ? tagParams.filter((tag) => tags.includes(tag)) : tags);
      if (tags.length > 1) showTagFilter(tags, selected);
      Redoc.init(selected.size < tags.length ? filterSpec(spec, selected) : spec, redocOptions, container);
    },
    // Let Redoc load the spec and report the error
    () => Redoc.init(addCacheBuster(specUrl), redocOptions, container)
  );

}
