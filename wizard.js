// Integration Template Wizard — multi-step form that produces a holographic
// holon JSON. Reads no external data, writes only to sessionStorage (handoff
// to the visualizer) and localStorage.guild-catalog-drafts (drafts).

(function () {
  let currentStep = 1;
  const customFields = [];
  const sampleHolons = [];

  /**
   * Wire all DOM event listeners once the document is parsed.
   */
  function init() {
    document.querySelectorAll(".wizard-step").forEach((btn) => {
      btn.addEventListener("click", () => goToStep(Number(btn.getAttribute("data-step"))));
    });
    document.getElementById("next-step").addEventListener("click", () => goToStep(currentStep + 1));
    document.getElementById("prev-step").addEventListener("click", () => goToStep(currentStep - 1));
    document.getElementById("add-field-btn").addEventListener("click", addField);
    document.getElementById("add-holon-btn").addEventListener("click", () => {
      addHolon();
      renderHolonsEditor();
      refreshPreviews();
    });
    document.getElementById("copy-json-btn").addEventListener("click", copyFinal);
    document.getElementById("download-json-btn").addEventListener("click", downloadFinal);
    document.getElementById("load-into-viz-btn").addEventListener("click", loadIntoVisualizer);
    document.getElementById("publish-draft-btn").addEventListener("click", saveDraft);
    document.getElementById("wizard-modal-ok").addEventListener("click", () => {
      document.getElementById("wizard-modal").hidden = true;
    });

    ["w-name", "w-description", "w-assessment-type", "w-subtype", "w-source", "w-environment"]
      .forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("input", refreshPreviews);
        if (el) el.addEventListener("change", refreshPreviews);
      });

    addHolon();
    renderHolonsEditor();
    refreshPreviews();
  }

  /**
   * Switch the visible step pane, updating progress and Prev/Next button state.
   * @param {number} step
   */
  function goToStep(step) {
    if (step < 1 || step > 4) return;
    if (step > currentStep && !validateStep(currentStep)) return;
    currentStep = step;
    document.querySelectorAll(".wizard-pane").forEach((p) => p.classList.remove("is-active"));
    document.getElementById(`step-${step}`).classList.add("is-active");
    document.querySelectorAll(".wizard-step").forEach((b) => {
      b.classList.toggle("is-active", Number(b.getAttribute("data-step")) === step);
    });
    document.getElementById("prev-step").disabled = step === 1;
    document.getElementById("next-step").disabled = step === 4;
    document.getElementById("wizard-progress").textContent = `Step ${step} of 4`;
    if (step === 4) document.getElementById("final-json").textContent = JSON.stringify(buildBoundary(), null, 2);
  }

  /**
   * Validate the current step before allowing forward navigation.
   * @param {number} step
   * @returns {boolean}
   */
  function validateStep(step) {
    if (step === 1) {
      const name = document.getElementById("w-name").value.trim();
      const ok = name.length >= 3;
      document.getElementById("w-name-error").hidden = ok;
      return ok;
    }
    if (step === 3) {
      const ok = sampleHolons.length >= 1 && sampleHolons.every((h) => h.target && h.target.trim());
      document.getElementById("step-3-error").hidden = ok;
      return ok;
    }
    return true;
  }

  /**
   * Append a new empty custom-field row to the Step 2 builder.
   */
  function addField() {
    customFields.push({ name: "", type: "string", required: false, description: "" });
    renderFields();
    refreshPreviews();
  }

  /**
   * Re-render the Step 2 custom-field builder from the customFields array.
   */
  function renderFields() {
    const host = document.getElementById("schema-fields");
    host.innerHTML = customFields.map((f, i) => `
      <div class="schema-field" data-i="${i}">
        <input class="f-name" type="text" placeholder="Field name" value="${esc(f.name)}" />
        <select class="f-type">
          ${["string","number","boolean","date"].map((t) => `<option value="${t}" ${t===f.type?"selected":""}>${t}</option>`).join("")}
        </select>
        <label class="f-required"><input type="checkbox" class="f-required-input" ${f.required?"checked":""}/> required</label>
        <input class="f-desc" type="text" placeholder="Description" value="${esc(f.description)}" />
        <button class="btn ghost f-remove" type="button" aria-label="Remove">×</button>
      </div>
    `).join("");
    host.querySelectorAll(".schema-field").forEach((row) => {
      const i = Number(row.getAttribute("data-i"));
      row.querySelector(".f-name").addEventListener("input", (e) => { customFields[i].name = e.target.value; refreshPreviews(); renderHolonsEditor(); });
      row.querySelector(".f-type").addEventListener("change", (e) => { customFields[i].type = e.target.value; refreshPreviews(); renderHolonsEditor(); });
      row.querySelector(".f-required-input").addEventListener("change", (e) => { customFields[i].required = e.target.checked; refreshPreviews(); });
      row.querySelector(".f-desc").addEventListener("input", (e) => { customFields[i].description = e.target.value; refreshPreviews(); });
      row.querySelector(".f-remove").addEventListener("click", () => {
        customFields.splice(i, 1);
        renderFields();
        renderHolonsEditor();
        refreshPreviews();
      });
    });
  }

  /**
   * Add an empty holon record to the Step 3 dynamic editor.
   */
  function addHolon() {
    sampleHolons.push({
      target: "",
      status: "pending",
      severity: "medium",
      score: 0,
      custom: {},
    });
  }

  /**
   * Re-render the Step 3 holon editor including any custom field inputs.
   */
  function renderHolonsEditor() {
    const host = document.getElementById("holons-editor");
    host.innerHTML = sampleHolons.map((h, i) => `
      <div class="holon-card" data-i="${i}">
        <div class="holon-card-head">
          <h3>Holon #${i + 1}</h3>
          <button class="btn ghost holon-remove" type="button" data-i="${i}">Remove</button>
        </div>
        <div class="field-row">
          <label class="field">
            <span>Target <em>*</em></span>
            <input class="h-target" type="text" value="${esc(h.target)}" placeholder="nginx:1.25-alpine" />
          </label>
          <label class="field">
            <span>Status</span>
            <select class="h-status">
              ${["pass","fail","pending","unknown"].map((s) => `<option value="${s}" ${s===h.status?"selected":""}>${s}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="field-row">
          <label class="field">
            <span>Severity</span>
            <select class="h-severity">
              ${["critical","high","medium","low","info"].map((s) => `<option value="${s}" ${s===h.severity?"selected":""}>${s}</option>`).join("")}
            </select>
          </label>
          <label class="field">
            <span>Score (0–100)</span>
            <input class="h-score" type="number" min="0" max="100" value="${esc(h.score)}" />
          </label>
        </div>
        <div class="custom-fields">${renderCustomInputs(h, i)}</div>
      </div>
    `).join("");
    host.querySelectorAll(".holon-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.getAttribute("data-i"));
        sampleHolons.splice(i, 1);
        renderHolonsEditor();
        refreshPreviews();
      });
    });
    host.querySelectorAll(".holon-card").forEach((card) => {
      const i = Number(card.getAttribute("data-i"));
      card.querySelector(".h-target").addEventListener("input", (e) => { sampleHolons[i].target = e.target.value; refreshPreviews(); });
      card.querySelector(".h-status").addEventListener("change", (e) => { sampleHolons[i].status = e.target.value; refreshPreviews(); });
      card.querySelector(".h-severity").addEventListener("change", (e) => { sampleHolons[i].severity = e.target.value; refreshPreviews(); });
      card.querySelector(".h-score").addEventListener("input", (e) => { sampleHolons[i].score = Number(e.target.value); refreshPreviews(); });
      card.querySelectorAll(".cf-input").forEach((input) => {
        input.addEventListener("input", (e) => {
          const fname = input.getAttribute("data-field");
          sampleHolons[i].custom[fname] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
          refreshPreviews();
        });
      });
    });
  }

  /**
   * Generate the custom field inputs for one holon row.
   * @param {object} h
   * @param {number} i
   * @returns {string}
   */
  function renderCustomInputs(h, i) {
    if (!customFields.length) return "";
    return customFields.map((f) => {
      if (!f.name) return "";
      const v = h.custom[f.name] != null ? h.custom[f.name] : "";
      const inputType = f.type === "number" ? "number"
        : f.type === "boolean" ? "checkbox"
        : f.type === "date" ? "datetime-local"
        : "text";
      const valAttr = f.type === "boolean"
        ? (v ? "checked" : "")
        : `value="${esc(v)}"`;
      return `
        <label class="field">
          <span>${esc(f.name)}${f.required ? " <em>*</em>" : ""}</span>
          <input class="cf-input" data-field="${esc(f.name)}" type="${inputType}" ${valAttr} placeholder="${esc(f.description)}" />
        </label>
      `;
    }).join("");
  }

  /**
   * Generate a single holon object from the Step-1 metadata + a sample row.
   * @param {object} sample
   * @returns {object}
   */
  function buildHolon(sample) {
    const assessmentType = document.getElementById("w-assessment-type").value;
    const subtype = document.getElementById("w-subtype").value;
    const source = document.getElementById("w-source").value.trim() || "manual";
    const now = new Date().toISOString();
    const id = `${assessmentType.toLowerCase()}-${subtype}-${slug(sample.target || "holon")}-${rndHex(4)}`;
    return Object.assign({
      id,
      entityType: "holon",
      assessmentType,
      subtype,
      label: `${assessmentType} · ${sample.target || "holon"}`,
      target: sample.target || "",
      status: sample.status,
      severity: sample.severity,
      score: Number(sample.score) || 0,
      timestamp: now,
      hash: rndHex(64),
      source,
      immutable: true,
      provenance: {
        collectedAt: now,
        collectedBy: source,
        verifiedAt: null,
        chain: [],
      },
      meta: {
        description: document.getElementById("w-description").value || "",
        remediation: null,
        references: [],
      },
      projection: "both",
    }, sample.custom);
  }

  /**
   * Build the full boundary export object combining metadata + all sample
   * holons. This is the JSON the user copies, downloads, or hands off.
   * @returns {object}
   */
  function buildBoundary() {
    const name = document.getElementById("w-name").value.trim();
    const env = document.getElementById("w-environment").value;
    const holons = sampleHolons.map(buildHolon);
    const holonic = {
      id: `holonic-${slug(name || "integration")}-${rndHex(4)}`,
      entityType: "holonic",
      label: name || "Untitled holonic",
      holonType: "control",
      holons: holons.map((h) => h.id),
      childHolonics: [],
      aggregateStatus: aggregate(holons.map((h) => h.status)),
      aggregateScore: holons.length ? Math.round(holons.reduce((a, b) => a + (b.score || 0), 0) / holons.length) : 0,
      boundary: { shape: "cluster", color: "#58a6ff" },
      timestamp: new Date().toISOString(),
      projection: "both",
    };
    return {
      id: `boundary-${slug(name || "integration")}-${rndHex(4)}`,
      entityType: "boundary",
      label: name || "Untitled boundary",
      environment: env,
      role: "supplier",
      snapshotAt: new Date().toISOString(),
      schemaVersion: "1.0.0",
      holonics: [holonic],
      loose_holons: holons,
      meta: {
        guild: "",
        project: name || "",
        version: "0.1.0",
      },
      customFieldSchema: customFields.filter((f) => f.name),
    };
  }

  /**
   * Roll up child holon statuses into a holonic aggregate status.
   * @param {string[]} statuses
   * @returns {string}
   */
  function aggregate(statuses) {
    if (!statuses.length) return "unknown";
    const allPass = statuses.every((s) => s === "pass");
    const allFail = statuses.every((s) => s === "fail");
    const anyFail = statuses.some((s) => s === "fail");
    const anyPass = statuses.some((s) => s === "pass");
    if (allPass) return "pass";
    if (allFail) return "fail";
    if (anyFail && anyPass) return "partial-fail";
    return "pending";
  }

  /**
   * Refresh the right-rail live preview and Step-2 schema preview.
   */
  function refreshPreviews() {
    const live = document.getElementById("live-preview");
    if (live) live.textContent = JSON.stringify(buildBoundary(), null, 2);
    const schema = document.getElementById("schema-preview");
    if (schema) {
      const proto = {
        id: "string (auto)",
        entityType: "holon",
        assessmentType: document.getElementById("w-assessment-type").value,
        subtype: document.getElementById("w-subtype").value,
        target: "string",
        status: "pass | fail | pending | unknown",
        severity: "critical | high | medium | low | info",
        score: 0,
        timestamp: "ISO-8601",
        hash: "64-char hex (auto)",
        source: document.getElementById("w-source").value,
        immutable: true,
        provenance: { collectedAt: "ISO-8601", collectedBy: "string", verifiedAt: null, chain: [] },
        meta: { description: "string", remediation: null, references: [] },
        projection: "both",
      };
      customFields.forEach((f) => { if (f.name) proto[f.name] = `<${f.type}${f.required?" required":""}>`; });
      schema.textContent = JSON.stringify(proto, null, 2);
    }
  }

  /**
   * Copy the final boundary JSON to the user's clipboard.
   */
  function copyFinal() {
    const text = JSON.stringify(buildBoundary(), null, 2);
    navigator.clipboard.writeText(text).then(() => toast("JSON copied to clipboard."));
  }

  /**
   * Trigger a browser download of the final boundary JSON as a .json file.
   */
  function downloadFinal() {
    const data = buildBoundary();
    const filename = `${slug(document.getElementById("w-name").value || "integration")}-holons.json`;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * Park the boundary JSON in sessionStorage and redirect to the visualizer
   * which picks it up on startup.
   */
  function loadIntoVisualizer() {
    if (!validateStep(1) || !validateStep(3)) {
      toast("Fix validation errors first.");
      return;
    }
    const data = buildBoundary();
    try {
      sessionStorage.setItem("holo-wizard-pending", JSON.stringify(data));
      window.location.href = "index.html";
    } catch (e) {
      toast("Could not store handoff: " + e.message);
    }
  }

  /**
   * Save the boundary JSON to localStorage.guild-catalog-drafts and show a
   * "coming soon" modal explaining that publishing isn't yet wired up.
   */
  function saveDraft() {
    if (!validateStep(1)) { toast("Name is required."); return; }
    const data = buildBoundary();
    let drafts = [];
    try { drafts = JSON.parse(localStorage.getItem("guild-catalog-drafts") || "[]"); }
    catch (_) { drafts = []; }
    drafts.push({
      name: data.label,
      description: document.getElementById("w-description").value || "",
      savedAt: new Date().toISOString(),
      json: data,
    });
    try {
      localStorage.setItem("guild-catalog-drafts", JSON.stringify(drafts));
      const modal = document.getElementById("wizard-modal");
      if (modal) modal.hidden = false;
    } catch (e) {
      toast("Could not save draft: " + e.message);
    }
  }

  /**
   * Generate a stable kebab-case slug from a free-text string.
   * @param {string} s
   * @returns {string}
   */
  function slug(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "item";
  }

  /**
   * Generate a random lowercase hex string of length n (mock hash / id).
   * @param {number} n
   * @returns {string}
   */
  function rndHex(n) {
    const chars = "0123456789abcdef";
    let out = "";
    for (let i = 0; i < n; i++) out += chars[Math.floor(Math.random() * 16)];
    return out;
  }

  /**
   * Show a short toast at the bottom of the wizard.
   * @param {string} msg
   */
  function toast(msg) {
    const t = document.getElementById("wizard-toast");
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(t._t);
    t._t = setTimeout(() => { t.hidden = true; }, 2200);
  }

  /**
   * Escape strings for safe HTML interpolation.
   * @param {*} s
   * @returns {string}
   */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
