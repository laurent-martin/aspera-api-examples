const params = new URLSearchParams(window.location.search);
const specUrl = params.get("spec");
// Selected tags: all tags if no "tag" parameter
const tagParams = params.getAll("tag");

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
// Redoc 3 is an ES module: pin the version, "latest" may break the page
const REDOC_URL = "https://cdn.redoc.ly/redoc/v3.0.1/bundles/redoc.standalone.js";

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

// Keywords whose value is data, not a schema
const DATA_KEYWORDS = ["example", "examples", "default", "const", "enum"];
// Keywords whose value maps names to schemas
const SCHEMA_MAPS = ["properties", "patternProperties", "$defs", "definitions"];

/**
 * Adapt a JSON Schema for Redoc, which shows "example" but not "examples", reads "<x>" in descriptions as HTML,
 * and shows if/then/else as "case 1/case 2" (conditions are expected in descriptions).
 * @param {object} schema schema, modified in place
 */
function adaptSchema(schema) {
  if (Array.isArray(schema)) return schema.forEach(adaptSchema);
  if (!schema || typeof schema !== "object") return;
  if (Array.isArray(schema.examples) && !("example" in schema)) schema.example = schema.examples[0];
  if (typeof schema.description === "string") schema.description = schema.description.replace(/</g, "&lt;");
  delete schema.if;
  delete schema.then;
  delete schema.else;
  Object.entries(schema).forEach(([key, value]) => {
    if (SCHEMA_MAPS.includes(key)) Object.values(value).forEach(adaptSchema);
    else if (!DATA_KEYWORDS.includes(key)) adaptSchema(value);
  });
}

/**
 * Wrap a JSON Schema in an OpenAPI document, so that Redoc shows it in a "Schema" section.
 * @param {object} jsonSchema JSON Schema
 * @returns {object} OpenAPI 3.1 document
 */
function schemaToOpenApi(jsonSchema) {
  const { $schema, $comment, title, description, ...schema } = structuredClone(jsonSchema);
  adaptSchema(schema);
  return {
    openapi: "3.1.0",
    info: { title: title || "JSON Schema", version: "", description: description?.replace(/</g, "&lt;") },
    tags: [{ name: "Schema", description: '{% schemaDefinition schemaRef="#/components/schemas/Schema" /%}' }],
    paths: {},
    components: { schemas: { Schema: schema } },
  };
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
 * Save the selected tags in URL, without reloading the page.
 * @param {string[]} tags all tag names
 * @param {Set<string>} selected selected tag names
 */
function saveTags(tags, selected) {
  const url = new URL(window.location.href);
  url.hash = "";
  url.searchParams.delete("tag");
  if (selected.size < tags.length) {
    // An empty value means no tag selected
    const values = tags.filter((tag) => selected.has(tag));
    (values.length > 0 ? values : [""]).forEach((tag) => url.searchParams.append("tag", tag));
  }
  history.replaceState(null, "", url);
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
 * @param {Set<string>} selected selected tag names, updated on change
 * @param {function} onChange called when the selection changes
 */
function showTagFilter(tags, selected, onChange) {
  const filter = document.getElementById("tag-filter");
  const list = document.getElementById("tag-list");
  const allBox = addCheckbox(list, "All", false);
  allBox.parentElement.classList.add("tag-all");
  const tagBoxes = tags.map((tag) => addCheckbox(list, tag, selected.has(tag)));
  // Show the selection state on "All" and on the button
  const update = () => {
    allBox.checked = selected.size === tags.length;
    allBox.indeterminate = selected.size > 0 && !allBox.checked;
    document.getElementById("tag-count").textContent = `${selected.size}/${tags.length}`;
    filter.classList.toggle("filtered", !allBox.checked);
  };
  const apply = () => {
    selected.clear();
    tags.forEach((tag, index) => {
      if (tagBoxes[index].checked) selected.add(tag);
    });
    update();
    saveTags(tags, selected);
    onChange();
  };
  allBox.addEventListener("change", () => {
    tagBoxes.forEach((box) => {
      box.checked = allBox.checked;
    });
    apply();
  });
  tagBoxes.forEach((box) => box.addEventListener("change", apply));
  update();
  filter.hidden = false;
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

  document.getElementById("spec-form").addEventListener("submit", (e) => {
    e.preventDefault();
    loadSpec();
  });

} else {

  const topBar = document.getElementById("top-bar");
  document.getElementById("form-screen").hidden = true;
  document.getElementById("redoc-container").hidden = false;

  const redocOptions = {
    downloadUrls: [{ url: specUrl, title: decodeURIComponent(new URL(specUrl).pathname.split("/").pop()) }],
    // Keep the sidebar and anchors below the top bar
    scrollYOffset: () => topBar.offsetHeight,
    disableTelemetry: true
  };
  const container = document.getElementById("redoc-container");
  const redoc = import(REDOC_URL);

  Promise.all([redoc, fetchSpec(specUrl)]).then(
    ([Redoc, loaded]) => {
      const spec = !loaded.openapi && !loaded.swagger && loaded.$schema ? schemaToOpenApi(loaded) : loaded;
      if (spec.info?.title) document.title = `${spec.info.title} · Aspera APIs`;
      const tags = listTags(spec);
      const selected = new Set(tagParams.length > 0 ? tagParams.filter((tag) => tags.includes(tag)) : tags);
      let root = null;
      // Render again when the selection changes: Redoc may modify the spec, so give it a copy
      const render = () => {
        root?.unmount();
        root = Redoc.init(structuredClone(selected.size < tags.length ? filterSpec(spec, selected) : spec), redocOptions, container);
      };
      if (tags.length > 1) showTagFilter(tags, selected, render);
      render();
    },
    // Let Redoc load the spec and report the error
    () => redoc.then((Redoc) => Redoc.init(addCacheBuster(specUrl), redocOptions, container))
  ).catch((error) => {
    // Redoc not loaded, or failed: show the error instead of an empty page
    console.error(error);
    container.classList.add("error");
    container.textContent = `Failed to display ${specUrl}: ${error.message}`;
  });

}
