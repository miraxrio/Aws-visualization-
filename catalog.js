// Guild Catalog — renders the published integrations sidebar and handles
// loading them into the visualizer. Reads data/guild-catalog.json on mount.

(function () {
  let catalogEntries = [];
  let filterType = "ALL";
  let filterProvider = "ALL";
  let searchTerm = "";
  let handlers = { onLoad: null, onToast: null };

  /**
   * Initial setup. Fetches the catalog data, renders cards, wires search /
   * filter input, hydrates drafts from localStorage.
   * @param {{onLoad:Function, onToast:Function}} hooks
   */
  function mount(hooks) {
    handlers = Object.assign(handlers, hooks);
    const list = document.getElementById("catalog-list");
    if (!list) return;
    fetchCatalog();
    bindSearchAndFilter();
    renderDrafts();
    bindGlobalLink();
  }

  /**
   * Fetch the seeded catalog JSON, store it locally, render the card list.
   */
  function fetchCatalog() {
    fetch("data/guild-catalog.json")
      .then((r) => r.json())
      .then((j) => {
        catalogEntries = Array.isArray(j.catalog) ? j.catalog : [];
        renderList();
      })
      .catch(() => {
        const list = document.getElementById("catalog-list");
        if (list) list.innerHTML = '<p class="muted small">Catalog unavailable offline.</p>';
      });
  }

  /**
   * Bind real-time filtering on the search input, type dropdown, and
   * provider dropdown.
   */
  function bindSearchAndFilter() {
    const search = document.getElementById("catalog-search-input");
    const filter = document.getElementById("catalog-filter");
    const provider = document.getElementById("catalog-provider-filter");
    if (search) search.addEventListener("input", () => {
      searchTerm = search.value.trim().toLowerCase();
      renderList();
    });
    if (filter) filter.addEventListener("change", () => {
      filterType = filter.value;
      renderList();
    });
    if (provider) provider.addEventListener("change", () => {
      filterProvider = provider.value;
      renderList();
    });
  }

  /**
   * Decide whether an entry matches the active search + type + provider filter.
   * @param {object} e
   * @returns {boolean}
   */
  function matches(e) {
    if (filterType !== "ALL" && e.assessmentType !== filterType) return false;
    if (filterProvider !== "ALL" && e.provider !== filterProvider) return false;
    if (!searchTerm) return true;
    const hay = `${e.name || ""} ${(e.tags || []).join(" ")}`.toLowerCase();
    return hay.includes(searchTerm);
  }

  /**
   * Filter a flat array of entities by their ontology entityClass.
   * @param {object[]} entities
   * @param {string} entityClass
   * @returns {object[]}
   */
  function filterByEntityClass(entities, entityClass) {
    return (entities || []).filter((e) => e.entityClass === entityClass);
  }

  /**
   * Filter entities by entityCategory (e.g. all NETWORK entities).
   * @param {object[]} entities
   * @param {string} entityCategory
   * @returns {object[]}
   */
  function filterByCategory(entities, entityCategory) {
    return (entities || []).filter((e) => e.entityCategory === entityCategory);
  }

  /**
   * Filter entities by provider. "agnostic" returns provider-agnostic entities.
   * @param {object[]} entities
   * @param {string} provider
   * @returns {object[]}
   */
  function filterByProvider(entities, provider) {
    return (entities || []).filter((e) => e.provider === provider);
  }

  /**
   * Render the filtered list of catalog entries to the sidebar.
   */
  function renderList() {
    const list = document.getElementById("catalog-list");
    if (!list) return;
    const visible = catalogEntries.filter(matches);
    if (!visible.length) {
      list.innerHTML = '<p class="muted small">No integrations match.</p>';
      return;
    }
    list.innerHTML = visible.map(cardHtml).join("");
    list.querySelectorAll("[data-load]").forEach((btn) => {
      btn.addEventListener("click", () => loadFromCatalog(btn.getAttribute("data-load")));
    });
  }

  /**
   * Build the HTML for a single catalog card.
   * @param {object} e
   * @returns {string}
   */
  function cardHtml(e) {
    const pass = Math.max(0, Math.min(100, e.stats && e.stats.passRate || 0));
    const passColor = pass >= 80 ? "#22c55e" : pass >= 50 ? "#f97316" : "#ef4444";
    const date = e.publishedAt ? new Date(e.publishedAt).toLocaleDateString() : "";
    return `
      <article class="catalog-card" data-id="${esc(e.id)}">
        <div class="catalog-card-head">
          <h4>${esc(e.name)}</h4>
          <span class="type-badge type-${esc(e.assessmentType)}">${esc(e.assessmentType)}</span>
        </div>
        <div class="ont-provider-row"><span class="ont-provider-chip prov-${esc(e.provider || "agnostic")}">${esc((e.provider || "agnostic").toUpperCase())}</span></div>
        <p class="muted small">${esc(e.description || "")}</p>
        <div class="catalog-card-meta">
          <span>${esc(e.author || "")}</span>
          <span>${esc(date)}</span>
        </div>
        <div class="catalog-pass">
          <span class="catalog-pass-label">Pass ${pass}%</span>
          <span class="catalog-pass-bar"><span style="width:${pass}%;background:${passColor}"></span></span>
        </div>
        <div class="catalog-tags">${(e.tags || []).map((t) => `<span class="catalog-tag">#${esc(t)}</span>`).join("")}</div>
        <button class="btn primary catalog-load" data-load="${esc(e.id)}">View Hologram</button>
      </article>
    `;
  }

  /**
   * Fetch the data file referenced by a catalog entry and pass it through
   * the onLoad hook so the main app can render it.
   * @param {string} id
   */
  function loadFromCatalog(id) {
    const e = catalogEntries.find((x) => x.id === id);
    if (!e || !e.dataFile) return;
    fetch(e.dataFile)
      .then((r) => r.json())
      .then((j) => {
        if (handlers.onLoad) handlers.onLoad(j);
        if (handlers.onToast) handlers.onToast(`Loaded: ${e.name}`);
      })
      .catch((err) => {
        if (handlers.onToast) handlers.onToast("Failed to load: " + err.message);
      });
  }

  /**
   * Hydrate the "My Drafts" section from localStorage.guild-catalog-drafts.
   */
  function renderDrafts() {
    const wrap = document.getElementById("catalog-drafts-list");
    if (!wrap) return;
    let drafts = [];
    try { drafts = JSON.parse(localStorage.getItem("guild-catalog-drafts") || "[]"); }
    catch (_) { drafts = []; }
    if (!Array.isArray(drafts) || !drafts.length) {
      wrap.innerHTML = '<p class="muted small">No drafts yet — build one from the New Integration wizard.</p>';
      return;
    }
    wrap.innerHTML = drafts.map(draftCardHtml).join("");
    wrap.querySelectorAll("[data-draft-load]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-draft-load"));
        const d = drafts[idx];
        if (d && d.json && handlers.onLoad) {
          handlers.onLoad(d.json);
          if (handlers.onToast) handlers.onToast(`Loaded draft: ${d.name || "(unnamed)"}`);
        }
      });
    });
  }

  /**
   * HTML for a single draft entry in the sidebar.
   * @param {object} d
   * @param {number} i
   * @returns {string}
   */
  function draftCardHtml(d, i) {
    const date = d.savedAt ? new Date(d.savedAt).toLocaleString() : "";
    return `
      <article class="catalog-card draft">
        <h4>${esc(d.name || "(unnamed draft)")}</h4>
        <p class="muted small">${esc(d.description || "")}</p>
        <div class="catalog-card-meta"><span>${esc(date)}</span></div>
        <button class="btn ghost catalog-load" data-draft-load="${i}">Load Draft</button>
      </article>
    `;
  }

  /**
   * Wire the "Global Catalog" placeholder link to a toast.
   */
  function bindGlobalLink() {
    const link = document.getElementById("catalog-global-link");
    if (!link) return;
    link.addEventListener("click", (e) => {
      e.preventDefault();
      if (handlers.onToast) handlers.onToast("Global Catalog coming soon.");
    });
  }

  /**
   * Force a re-render of the drafts list (e.g. after the wizard saves one).
   */
  function refreshDrafts() {
    renderDrafts();
  }

  /**
   * Escape user-supplied strings for safe HTML interpolation.
   * @param {string} s
   * @returns {string}
   */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  window.AwsCatalog = {
    mount,
    refreshDrafts,
    filterByEntityClass,
    filterByCategory,
    filterByProvider,
  };
})();
