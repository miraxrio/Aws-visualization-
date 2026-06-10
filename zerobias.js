// ZeroBias integration for the Network Visualizer (browser side).
//
// Owns everything ZeroBias in the static app:
//   • connection / "sign in" state (host, org, boundary, API key, current user)
//   • a live-or-fallback data layer (org, boundaries, accounts, users, tasks,
//     and the native AWS inventory pull) — tries the live ZeroBias API, and
//     falls back to the bundled samples under data/zerobias/ so every panel is
//     populated offline (this web sandbox can't reach *.zerobias.com).
//   • all the ZeroBias UI: the import menu, the connect/login modal with user
//     selection, the sidebar Organization / Boundaries / Tasks panels, and the
//     Map overlay.
//
// The AWS-inventory → visualizer mapping is reused verbatim from the Node
// adapter via window.ZeroBiasGraphQL (adapter/zerobias-graphql.js is UMD), so
// the live import path is a drop-in for the CLI's offline one.
(function () {
  "use strict";

  const LS_KEY = "zerobias-connection";
  const DEFAULT_HOST = "api.uat.zerobias.com";
  const SAMPLE = {
    org: "data/zerobias/org.json",
    users: "data/zerobias/users.json",
    tasks: "data/zerobias/tasks.json",
    inventory: "adapter/sample-aws-inventory.json",
    creds: "data/zerobias/credentials.local.json", // gitignored, optional
  };

  // --- state -------------------------------------------------------------

  let conn = {
    host: DEFAULT_HOST,
    orgId: "",
    boundaryId: "",
    apiKey: "",
    remember: false,
    connected: false, // user explicitly connected / entered demo
    live: false,      // last inventory pull came back from the live API
  };
  let currentUser = null;
  const data = { org: null, boundaries: [], accounts: [], users: [], tasks: [] };
  let localCreds = {}; // userId -> apiKey, from the gitignored local file
  let inited = false;
  let dataReady = null; // promise
  let hooks = { onLoadNetwork: null, onToast: null, onFocusHolon: null };
  const els = {};

  // --- persistence -------------------------------------------------------

  function loadConn() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_KEY) || "null");
      if (raw && typeof raw === "object") {
        conn.host = raw.host || DEFAULT_HOST;
        conn.orgId = raw.orgId || "";
        conn.boundaryId = raw.boundaryId || "";
        conn.remember = !!raw.remember;
        if (raw.remember && raw.apiKey) conn.apiKey = raw.apiKey;
        conn.connected = !!raw.connected;
        conn._userId = raw.userId || null;
      }
    } catch (_) {/* ignore */}
  }
  function saveConn() {
    try {
      const payload = {
        host: conn.host,
        orgId: conn.orgId,
        boundaryId: conn.boundaryId,
        remember: conn.remember,
        connected: conn.connected,
        userId: currentUser ? currentUser.id : null,
      };
      if (conn.remember && conn.apiKey) payload.apiKey = conn.apiKey;
      localStorage.setItem(LS_KEY, JSON.stringify(payload));
    } catch (_) {/* ignore */}
  }

  // --- helpers -----------------------------------------------------------

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  async function fetchJson(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.json();
    } catch (_) {
      return null;
    }
  }
  function toast(msg) { if (hooks.onToast) hooks.onToast(msg); }
  function fmtDate(s) {
    if (!s) return "—";
    const d = new Date(s);
    return isNaN(d) ? String(s) : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  function dueLabel(s) {
    if (!s) return "";
    const d = new Date(s);
    if (isNaN(d)) return "";
    const days = Math.round((d - Date.now()) / 86400000);
    if (days < 0) return `overdue ${-days}d`;
    if (days === 0) return "due today";
    if (days === 1) return "due tomorrow";
    return `due in ${days}d`;
  }
  function initials(name) {
    return String(name || "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "?";
  }
  const PROVIDER_LABEL = { aws: "AWS", azure: "Azure", gcp: "GCP", "on-prem": "On-Prem", agnostic: "Agnostic" };

  // --- data layer (live → fallback) --------------------------------------

  function ensureData() {
    if (dataReady) return dataReady;
    dataReady = (async () => {
      const [orgDoc, usersDoc, tasksDoc, credsDoc] = await Promise.all([
        fetchJson(SAMPLE.org), fetchJson(SAMPLE.users), fetchJson(SAMPLE.tasks), fetchJson(SAMPLE.creds),
      ]);
      if (orgDoc) {
        data.org = orgDoc.org || null;
        data.boundaries = orgDoc.boundaries || [];
        data.accounts = orgDoc.accounts || [];
      }
      if (usersDoc) data.users = usersDoc.users || [];
      if (tasksDoc) data.tasks = tasksDoc.tasks || [];
      if (credsDoc) localCreds = credsDoc.credentials || credsDoc || {};
      // Restore the previously selected user (and re-apply its connection).
      if (conn._userId) {
        currentUser = data.users.find((u) => u.id === conn._userId) || null;
        if (currentUser) applyUserConnection(currentUser);
      }
    })();
    return dataReady;
  }

  function countInventory(raw) {
    if (!raw) return 0;
    return Object.keys(raw).reduce((n, k) => (k[0] === "_" ? n : n + (Array.isArray(raw[k]) ? raw[k].length : 0)), 0);
  }

  // Pull the native AWS inventory and map it to the visualizer schema. Tries
  // the live ZeroBias boundaries GraphQL API; on any failure (blocked host,
  // CORS, missing creds, empty result) falls back to the bundled sample so the
  // import always produces a renderable network.
  async function getInventoryNetwork() {
    const G = window.ZeroBiasGraphQL;
    if (G && conn.apiKey && conn.orgId && conn.boundaryId) {
      try {
        const c = { host: conn.host || DEFAULT_HOST, boundaryId: conn.boundaryId, apiKey: conn.apiKey, orgId: conn.orgId, pageSize: 100 };
        const raw = await G.fetchInventory(c);
        if (countInventory(raw) > 0) {
          conn.live = true;
          return { net: G.awsInventoryToVisualizer(raw, { identity: true, name: "AWS inventory · ZeroBias (live)" }), live: true };
        }
      } catch (_) {/* fall through to sample */}
    }
    conn.live = false;
    const raw = await fetchJson(SAMPLE.inventory);
    if (G && raw) {
      return { net: G.awsInventoryToVisualizer(raw, { identity: true, name: "AWS inventory · ZeroBias (demo)" }), live: false };
    }
    return { net: null, live: false };
  }

  // The import-menu action: pull inventory and hand it to the app.
  async function doImport() {
    closeMenu();
    toast(conn.apiKey ? "Pulling live inventory from ZeroBias…" : "Loading ZeroBias inventory (demo)…");
    await ensureData();
    const { net, live } = await getInventoryNetwork();
    if (!net) { toast("Could not build the ZeroBias network."); return; }
    if (hooks.onLoadNetwork) hooks.onLoadNetwork(net);
    render();
    toast(live ? "Imported live AWS inventory from ZeroBias." : "Imported AWS inventory from ZeroBias (demo data).");
  }

  // Load a boundary (assessment → holographic view, network → 3D city) and
  // optionally drill to a specific holon/finding.
  async function openBoundary(boundaryId, holonId) {
    await ensureData();
    const b = data.boundaries.find((x) => x.id === boundaryId);
    if (!b || !b.dataFile) { toast("Boundary has no data file."); return; }
    const doc = await fetchJson(b.dataFile);
    if (!doc) { toast("Could not load boundary: " + b.name); return; }
    if (hooks.onLoadNetwork) hooks.onLoadNetwork(doc);
    toast(`Opened ${b.name}`);
    if (holonId && hooks.onFocusHolon) {
      setTimeout(() => hooks.onFocusHolon(holonId), 350);
    }
  }

  // --- connection actions ------------------------------------------------

  // Apply a user's saved connection target (host/org/boundary, from users.json)
  // and, if a local API key is configured for that user
  // (data/zerobias/credentials.local.json — gitignored), wire it in so the
  // import can go live without re-typing anything.
  function applyUserConnection(u) {
    if (!u) return;
    if (u.connection) {
      conn.host = u.connection.host || conn.host || DEFAULT_HOST;
      conn.orgId = u.connection.orgId || conn.orgId || "";
      conn.boundaryId = u.connection.boundaryId || conn.boundaryId || "";
    }
    if (localCreds && localCreds[u.id]) conn.apiKey = localCreds[u.id];
  }

  function refreshMap() {
    if (window.AwsMap && window.AwsMap.isReady && window.AwsMap.isReady()) window.AwsMap.render();
  }

  // Run after any successful connect: refresh panels + the map gate, then pull
  // the network so the views are no longer empty.
  function afterConnect() {
    render();
    refreshMap();
    doImport();
  }

  function connect(form) {
    conn.host = (form.host || "").trim() || DEFAULT_HOST;
    conn.orgId = (form.orgId || "").trim();
    conn.boundaryId = (form.boundaryId || "").trim();
    conn.apiKey = form.apiKey || conn.apiKey || "";
    conn.remember = !!form.remember;
    conn.connected = true;
    if (!currentUser && data.users.length) {
      currentUser = data.users.find((u) => u.type === "human") || data.users[0];
    }
    saveConn();
    const liveCapable = conn.apiKey && conn.orgId && conn.boundaryId;
    toast(liveCapable ? "Connected to ZeroBias — pulling inventory…" : "ZeroBias connected (demo). Add an API key for live data.");
    afterConnect();
  }
  function continueDemo() {
    conn.connected = true;
    if (!currentUser && data.users.length) currentUser = data.users.find((u) => u.type === "human") || data.users[0];
    saveConn();
    toast("Using ZeroBias demo data.");
    afterConnect();
  }
  function disconnect() {
    conn.apiKey = "";
    conn.connected = false;
    conn.live = false;
    currentUser = null;
    try { localStorage.removeItem(LS_KEY); } catch (_) {}
    render();
    refreshMap();
    toast("Disconnected from ZeroBias.");
  }
  function selectUser(id) {
    currentUser = data.users.find((u) => u.id === id) || null;
    if (!currentUser) return;
    conn.connected = true;
    applyUserConnection(currentUser);
    saveConn();
    toast(`Signed in as ${currentUser.name}.`);
    afterConnect();
  }

  // --- rendering: account button + brand state ---------------------------

  function renderAccountBtn() {
    if (!els.accountLabel) return;
    if (currentUser) {
      els.accountLabel.textContent = currentUser.name;
      els.accountBtn.classList.add("is-connected");
      els.accountBtn.classList.toggle("is-live", conn.live);
      if (els.accountAvatar) {
        els.accountAvatar.textContent = initials(currentUser.name);
        els.accountAvatar.style.background = currentUser.avatarColor || "#7c5cff";
        els.accountAvatar.hidden = false;
      }
    } else {
      els.accountLabel.textContent = conn.connected ? (data.org ? data.org.name : "ZeroBias") : "Connect ZeroBias";
      els.accountBtn.classList.toggle("is-connected", conn.connected);
      els.accountBtn.classList.remove("is-live");
      if (els.accountAvatar) els.accountAvatar.hidden = true;
    }
  }

  function statusBadge() {
    if (conn.live) return '<span class="zb-badge zb-badge-live">● Live</span>';
    if (conn.connected) return '<span class="zb-badge zb-badge-demo">Demo data</span>';
    return '<span class="zb-badge zb-badge-off">Not connected</span>';
  }

  // Empty-state call-to-action shown in the panels before the user connects.
  function connectCtaHtml(text) {
    return `<div class="zb-cta">
      <p class="muted small">${esc(text)}</p>
      <button class="btn primary zb-cta-btn" data-zb-open-modal type="button"><span class="zb-hex">⬡</span> Connect ZeroBias</button>
    </div>`;
  }

  // --- rendering: sidebar Organization + Boundaries ----------------------

  function renderOrgPanel() {
    if (!els.orgBody) return;
    if (!conn.connected) {
      els.orgBody.innerHTML = connectCtaHtml("Connect your ZeroBias account to load your organization, boundaries and cloud accounts.");
      return;
    }
    const o = data.org;
    if (!o) { els.orgBody.innerHTML = '<p class="muted small">ZeroBias data unavailable.</p>'; return; }
    const frameworks = (o.complianceFrameworks || []).map((f) => `<span class="zb-chip">${esc(f)}</span>`).join("");
    els.orgBody.innerHTML = `
      <div class="zb-org-head">
        <div class="zb-org-name">${esc(o.name)} ${statusBadge()}</div>
        <div class="zb-kv">
          <span>Org ID</span><code>${esc(o.danaOrgId || o.id)}</code>
          <span>Plan</span><b>${esc(o.plan || "—")}</b>
          <span>Members</span><b>${esc(String(o.memberCount ?? "—"))}</b>
          <span>Accounts</span><b>${esc(String((data.accounts || []).length))}</b>
        </div>
        ${frameworks ? `<div class="zb-chips">${frameworks}</div>` : ""}
      </div>
      <div class="zb-sub-eyebrow">Boundaries (${(data.boundaries || []).length})</div>
      <div class="zb-boundary-list" id="zb-boundary-list">${boundaryListHtml()}</div>
      <div class="zb-sub-eyebrow">Cloud accounts</div>
      <div class="zb-account-list">${accountListHtml()}</div>
    `;
    els.orgBody.querySelectorAll("[data-open-boundary]").forEach((b) =>
      b.addEventListener("click", () => openBoundary(b.getAttribute("data-open-boundary"))));
  }

  function boundaryListHtml() {
    if (!(data.boundaries || []).length) return '<p class="muted small">No boundaries.</p>';
    return data.boundaries.map((b) => {
      const st = b.stats || {};
      const pass = st.passRate != null ? st.passRate : null;
      const passColor = pass == null ? "#8b9bbb" : pass >= 80 ? "#22c55e" : pass >= 50 ? "#f97316" : "#ef4444";
      const prov = PROVIDER_LABEL[b.provider] || b.provider || "—";
      const kindIcon = b.kind === "assessment" ? "⬢" : "▦";
      return `
        <button class="zb-boundary" data-open-boundary="${esc(b.id)}" title="Open ${esc(b.name)}">
          <span class="zb-boundary-icon prov-${esc(b.provider || "agnostic")}">${kindIcon}</span>
          <span class="zb-boundary-main">
            <span class="zb-boundary-name">${esc(b.name)}</span>
            <span class="zb-boundary-meta">${esc(prov)} · ${esc(b.environment || "—")} · ${esc(b.role || "—")}</span>
          </span>
          ${pass == null ? "" : `<span class="zb-boundary-pass" style="color:${passColor}">${pass}%</span>`}
        </button>`;
    }).join("");
  }

  function accountListHtml() {
    if (!(data.accounts || []).length) return '<p class="muted small">No accounts.</p>';
    return data.accounts.map((a) => `
      <div class="zb-account-row">
        <span class="zb-provider-chip prov-${esc(a.provider)}">${esc(PROVIDER_LABEL[a.provider] || a.provider)}</span>
        <span class="zb-account-name">${esc(a.name)}</span>
        <code class="zb-account-id">${esc(a.id)}</code>
        <span class="muted small">${esc(String(a.resourceCount ?? ""))} res</span>
      </div>`).join("");
  }

  // --- rendering: sidebar Tasks ------------------------------------------

  function renderTasksPanel() {
    if (!els.tasksBody) return;
    if (!conn.connected) {
      if (els.tasksCount) els.tasksCount.textContent = "0";
      els.tasksBody.innerHTML = connectCtaHtml("Sign in to ZeroBias to see the tasks assigned to you.");
      return;
    }
    const all = data.tasks || [];
    const mine = currentUser ? all.filter((t) => t.assignee === currentUser.id) : all;
    const list = (mine.length ? mine : all).slice();
    const open = list.filter((t) => t.status !== "done");
    const who = currentUser ? `for ${esc(currentUser.name.split(" ")[0])}` : "across the org";
    if (els.tasksCount) els.tasksCount.textContent = String(open.length);
    if (!list.length) { els.tasksBody.innerHTML = '<p class="muted small">No ZeroBias tasks.</p>'; return; }
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    list.sort((a, b) => (a.status === "done" ? 1 : 0) - (b.status === "done" ? 1 : 0) || (order[a.priority] ?? 9) - (order[b.priority] ?? 9));
    els.tasksBody.innerHTML =
      `<div class="zb-tasks-sub muted small">${open.length} open ${who}</div>` +
      list.map(taskHtml).join("");
    els.tasksBody.querySelectorAll("[data-task-boundary]").forEach((el) =>
      el.addEventListener("click", () => openBoundary(el.getAttribute("data-task-boundary"), el.getAttribute("data-task-holon") || null)));
  }

  function taskHtml(t) {
    const b = (data.boundaries || []).find((x) => x.id === t.boundaryId);
    const due = dueLabel(t.dueAt);
    const overdue = due.startsWith("overdue");
    return `
      <button class="zb-task status-${esc(t.status)}" data-task-boundary="${esc(t.boundaryId || "")}" data-task-holon="${esc(t.holonId || "")}" title="Open related boundary">
        <span class="zb-task-pri pri-${esc(t.priority)}"></span>
        <span class="zb-task-main">
          <span class="zb-task-title">${esc(t.title)}</span>
          <span class="zb-task-meta">
            <span class="zb-task-status st-${esc(t.status)}">${esc(t.status)}</span>
            ${t.framework ? `<span class="zb-task-fw">${esc(t.framework)}</span>` : ""}
            ${b ? `<span class="zb-task-boundary">${esc(b.name)}</span>` : ""}
            ${due ? `<span class="zb-task-due${overdue ? " is-overdue" : ""}">${esc(due)}</span>` : ""}
          </span>
        </span>
      </button>`;
  }

  // --- rendering: Map overlay --------------------------------------------

  function renderMapOverlay() {
    if (!els.mapPanel) return;
    if (!conn.connected) {
      els.mapPanel.innerHTML =
        `<div class="zb-map-head"><span class="zb-hex">⬡</span><div><div class="zb-map-title">ZeroBias</div><div class="zb-map-sub">${statusBadge()}</div></div></div>` +
        connectCtaHtml("Connect to ZeroBias to load your organization, boundaries and tasks onto the map.");
      return;
    }
    const o = data.org;
    const open = (data.tasks || []).filter((t) => t.status !== "done").length;
    const findings = (data.boundaries || []).reduce((n, b) => n + ((b.stats && b.stats.openFindings) || 0), 0);
    els.mapPanel.innerHTML = `
      <div class="zb-map-head">
        <span class="zb-hex">⬡</span>
        <div>
          <div class="zb-map-title">ZeroBias${o ? " · " + esc(o.name) : ""}</div>
          <div class="zb-map-sub">${statusBadge()}${currentUser ? ` · ${esc(currentUser.name)}` : ""}</div>
        </div>
      </div>
      <div class="zb-map-stats">
        <span><b>${(data.boundaries || []).length}</b><i>boundaries</i></span>
        <span><b>${(data.accounts || []).length}</b><i>accounts</i></span>
        <span><b>${(data.users || []).length}</b><i>users</i></span>
        <span><b>${open}</b><i>open tasks</i></span>
        <span><b>${findings}</b><i>findings</i></span>
      </div>
      <div class="zb-map-boundaries">
        ${(data.boundaries || []).map((b) => {
          const st = b.stats || {};
          const pass = st.passRate != null ? st.passRate : null;
          const passColor = pass == null ? "#8b9bbb" : pass >= 80 ? "#22c55e" : pass >= 50 ? "#f97316" : "#ef4444";
          return `<button class="zb-map-boundary" data-open-boundary="${esc(b.id)}">
            <span class="zb-provider-chip prov-${esc(b.provider || "agnostic")}">${esc(PROVIDER_LABEL[b.provider] || b.provider)}</span>
            <span class="zb-map-boundary-name">${esc(b.name)}</span>
            ${pass == null ? "" : `<span style="color:${passColor};font-weight:700">${pass}%</span>`}
          </button>`;
        }).join("")}
      </div>
    `;
    els.mapPanel.querySelectorAll("[data-open-boundary]").forEach((b) =>
      b.addEventListener("click", () => openBoundary(b.getAttribute("data-open-boundary"))));
  }

  // --- rendering: connect / login modal ----------------------------------

  function renderModal() {
    if (!els.connStatus) return;
    // status line
    els.connStatus.innerHTML = statusBadge() +
      (conn.connected
        ? ` <span class="muted small">host <code>${esc(conn.host)}</code>${conn.orgId ? ` · org <code>${esc(conn.orgId)}</code>` : ""}</span>`
        : ` <span class="muted small">Enter your tenant details to pull live data, or continue with demo data.</span>`);
    if (els.disconnectBtn) els.disconnectBtn.hidden = !conn.connected;

    // form values
    if (els.fHost && document.activeElement !== els.fHost) els.fHost.value = conn.host || DEFAULT_HOST;
    if (els.fOrg && document.activeElement !== els.fOrg) els.fOrg.value = conn.orgId || "";
    if (els.fBoundary && document.activeElement !== els.fBoundary) els.fBoundary.value = conn.boundaryId || "";
    if (els.fRemember) els.fRemember.checked = conn.remember;
    // Indicate (without echoing) when a key is already loaded for this session.
    if (els.fApiKey && document.activeElement !== els.fApiKey) {
      els.fApiKey.placeholder = conn.apiKey ? "•••••••• (key loaded)" : "APIKey …";
    }

    // user picker (sign in as)
    if (els.userPicker) {
      els.userPicker.innerHTML = (data.users || []).map((u) => `
        <button class="zb-user${currentUser && currentUser.id === u.id ? " is-active" : ""}" data-user="${esc(u.id)}">
          <span class="zb-avatar" style="background:${esc(u.avatarColor || "#7c5cff")}">${esc(initials(u.name))}</span>
          <span class="zb-user-main">
            <span class="zb-user-name">${esc(u.name)} ${u.mfaEnabled ? '<span class="zb-mfa ok" title="MFA enabled">MFA</span>' : '<span class="zb-mfa bad" title="MFA disabled">no-MFA</span>'}</span>
            <span class="zb-user-role muted small">${esc(u.role)}${u.type === "service" ? " · service account" : ""}</span>
          </span>
          ${u.openTasks ? `<span class="zb-user-tasks">${u.openTasks}</span>` : ""}
        </button>`).join("");
      els.userPicker.querySelectorAll("[data-user]").forEach((b) =>
        b.addEventListener("click", () => selectUser(b.getAttribute("data-user"))));
    }
  }

  function openModal() {
    ensureData().then(() => { renderModal(); });
    if (els.modal) els.modal.hidden = false;
  }
  function closeModal() { if (els.modal) els.modal.hidden = true; }

  // --- import menu -------------------------------------------------------

  function openMenu() {
    if (!els.menu) return;
    els.menu.hidden = false;
    if (els.menuBtn) els.menuBtn.setAttribute("aria-expanded", "true");
  }
  function closeMenu() {
    if (!els.menu) return;
    els.menu.hidden = true;
    if (els.menuBtn) els.menuBtn.setAttribute("aria-expanded", "false");
  }
  function toggleMenu() { (els.menu && els.menu.hidden) ? openMenu() : closeMenu(); }

  // --- public render -----------------------------------------------------

  function render() {
    renderAccountBtn();
    renderOrgPanel();
    renderTasksPanel();
    renderMapOverlay();
    renderModal();
  }

  // --- init --------------------------------------------------------------

  function cacheEls() {
    els.menuBtn = document.getElementById("import-menu-btn");
    els.menu = document.getElementById("import-menu");
    els.importLive = document.getElementById("import-zb-live");
    els.accountBtn = document.getElementById("zb-account-btn");
    els.accountLabel = document.getElementById("zb-account-label");
    els.accountAvatar = document.getElementById("zb-account-avatar");
    // modal
    els.modal = document.getElementById("zb-modal");
    els.modalClose = document.getElementById("zb-modal-close");
    els.connStatus = document.getElementById("zb-conn-status");
    els.fHost = document.getElementById("zb-host");
    els.fOrg = document.getElementById("zb-org");
    els.fBoundary = document.getElementById("zb-boundary");
    els.fApiKey = document.getElementById("zb-apikey");
    els.fRemember = document.getElementById("zb-remember");
    els.form = document.getElementById("zb-connect-form");
    els.connectBtn = document.getElementById("zb-connect-submit");
    els.demoBtn = document.getElementById("zb-demo-btn");
    els.disconnectBtn = document.getElementById("zb-disconnect");
    els.userPicker = document.getElementById("zb-user-picker");
    // sidebar
    els.orgBody = document.getElementById("zb-org-body");
    els.tasksBody = document.getElementById("zb-tasks-body");
    els.tasksCount = document.getElementById("zb-tasks-count");
    // map
    els.mapPanel = document.getElementById("map-zb-panel");
  }

  function wire() {
    if (els.menuBtn) els.menuBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleMenu(); });
    if (els.importLive) els.importLive.addEventListener("click", (e) => { e.preventDefault(); doImport(); });
    // Close the menu once a file is chosen via the "Downloaded network" item.
    const fileInput = document.getElementById("file-input");
    if (fileInput) fileInput.addEventListener("change", closeMenu);
    if (els.accountBtn) els.accountBtn.addEventListener("click", openModal);
    if (els.modalClose) els.modalClose.addEventListener("click", closeModal);
    if (els.modal) els.modal.addEventListener("click", (e) => { if (e.target === els.modal) closeModal(); });
    // Handle the form submit (covers both the Connect button and Enter key)
    // so the page never reloads.
    if (els.form) els.form.addEventListener("submit", (e) => {
      e.preventDefault();
      connect({
        host: els.fHost && els.fHost.value,
        orgId: els.fOrg && els.fOrg.value,
        boundaryId: els.fBoundary && els.fBoundary.value,
        apiKey: els.fApiKey && els.fApiKey.value,
        remember: els.fRemember && els.fRemember.checked,
      });
      if (els.fApiKey) els.fApiKey.value = "";
    });
    if (els.demoBtn) els.demoBtn.addEventListener("click", (e) => { e.preventDefault(); continueDemo(); });
    if (els.disconnectBtn) els.disconnectBtn.addEventListener("click", (e) => { e.preventDefault(); disconnect(); });
    // Any "Connect ZeroBias" CTA (rendered into the panels / map overlay).
    document.addEventListener("click", (e) => {
      const t = e.target && e.target.closest && e.target.closest("[data-zb-open-modal]");
      if (t) { e.preventDefault(); openModal(); }
    });
    // Close the import menu on outside click / Escape.
    document.addEventListener("click", (e) => {
      if (els.menu && !els.menu.hidden && !els.menu.contains(e.target) && e.target !== els.menuBtn) closeMenu();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { closeMenu(); closeModal(); }
    });
  }

  function init(opts) {
    if (inited) return;
    inited = true;
    hooks = Object.assign(hooks, opts || {});
    loadConn();
    cacheEls();
    wire();
    ensureData().then(() => {
      render();
      // Returning user who was already connected: pull their network so the
      // views aren't empty (a fresh, never-connected load stays empty).
      if (conn.connected) afterConnect();
    });
  }

  window.ZeroBias = {
    init,
    render,
    importNetwork: doImport,
    openBoundary,
    openModal,
    closeModal,
    isReady: () => inited,
    getState: () => ({
      connected: conn.connected,
      live: conn.live,
      host: conn.host,
      orgId: conn.orgId,
      boundaryId: conn.boundaryId,
      org: data.org,
      boundaries: data.boundaries.slice(),
      accounts: data.accounts.slice(),
      users: data.users.slice(),
      tasks: data.tasks.slice(),
      currentUser,
    }),
  };
})();
