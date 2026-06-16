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
    board: "data/zerobias/board-sample.json",
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
  let liveTasks = null; // real Ticket/WorkflowTicket/Finding records once fetched
  let liveTasksError = false;
  // --- assessor board (platform-ops) state ---
  let myTasksRaw = null;        // raw POST /portal/myTasks array (null = not loaded yet)
  let myTasksErr = false;       // last myTasks fetch failed (CORS / network / auth)
  let boardSampleDoc = null;    // data/zerobias/board-sample.json (lazy)
  let boardLaneAxis = "auto";   // 'auto' | 'board' | 'partition' | 'phase' | 'none'
  let boardFinancials = false;  // FinancialProfile disclosure gate (off by default)
  let detailTaskId = null;      // open task-detail drawer (task code/id) or null
  let boardTasksCache = [];     // tasks backing the current board (for detail lookup)
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
    if (!boundaryId) return; // live tickets have no local boundary file — no-op
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

  // --- tasks: REAL ZeroBias tasks from the platform task API --------------
  // Tasks are a platform concept (NOT in the boundary GraphQL, which has no Task
  // type). They live in the hydra "portal" service:
  //   POST https://<host>/portal/myTasks  → the signed-in org's assigned tasks
  // CORS is open for the GitHub Pages origin, so the browser pulls them directly.

  const hasLiveCreds = () => !!(conn.apiKey && conn.orgId && conn.boundaryId);
  const hasOrgCreds = () => !!(conn.apiKey && conn.orgId); // tasks are org-scoped

  function mapPortalTask(t) {
    const pv = t && t.priority && typeof t.priority === "object" ? t.priority.value : null;
    const priority = pv == null ? "medium" : pv < 150 ? "critical" : pv < 200 ? "high" : pv === 200 ? "medium" : "low";
    const link = (t.links || []).find((l) => l && l.description) || (t.links || [])[0] || {};
    const approver = (t.approvers && t.approvers[0] && t.approvers[0].contactName) || null;
    return {
      id: t.id,
      title: t.name || t.code || t.id,
      description: link.description || "",
      status: String(t.status || "todo").toLowerCase(),
      priority,
      approver,
      framework: null,
      dueAt: null,
      createdAt: t.created || null,
      source: "live",
    };
  }

  // Raw POST /portal/myTasks fetch. Prefers the shared platform-ops module
  // (window.ZeroBiasPlatform, also used by the Node adapter); falls back to an
  // inline fetch so the sidebar still works if that script didn't load. Throws on
  // a transport/auth failure so callers can show an explicit error state.
  async function fetchMyTasksRaw() {
    const P = window.ZeroBiasPlatform;
    if (P && P.fetchMyTasks) {
      return P.fetchMyTasks({ host: conn.host || DEFAULT_HOST, apiKey: conn.apiKey, orgId: conn.orgId });
    }
    const url = `https://${conn.host || DEFAULT_HOST}/portal/myTasks`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `APIKey ${conn.apiKey}`,
        "dana-org-id": conn.orgId,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: "{}",
    });
    if (!res.ok) throw new Error(`myTasks HTTP ${res.status}`);
    const arr = await res.json();
    return Array.isArray(arr) ? arr : [];
  }

  // Derive the sidebar's slim task list from the shared raw payload, so the
  // sidebar list and the board are always one consistent fetch.
  function syncDerivedTasks() {
    if (myTasksErr) { liveTasks = []; liveTasksError = true; }
    else if (myTasksRaw) { liveTasks = myTasksRaw.map(mapPortalTask); liveTasksError = false; }
    else { liveTasks = null; liveTasksError = false; }
  }

  // Refresh the sidebar Tasks panel AND the assessor board from one live pull.
  async function refreshTasks() {
    if (!hasOrgCreds()) {
      myTasksRaw = null; myTasksErr = false;
      liveTasks = null; liveTasksError = false;
      renderTasksPanel(); renderBoardView();
      return;
    }
    myTasksRaw = null; myTasksErr = false;
    liveTasks = null; liveTasksError = false;
    renderTasksPanel(); renderBoardView(); // show "loading…"
    try {
      myTasksRaw = await fetchMyTasksRaw();
      myTasksErr = false;
    } catch (_) {
      myTasksRaw = null; myTasksErr = true; // network / CORS / auth failure
    }
    syncDerivedTasks();
    renderTasksPanel(); renderBoardView();
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
  function afterConnect(opts) {
    render();
    refreshMap();
    doImport();
    refreshTasks();
    // The assessor board is the primary interface — land newly-connected users on
    // it (explicit connect / sign-in / demo), but don't hijack a returning user's
    // last view on reload.
    if (opts && opts.board && window.AwsMode && window.AwsMode.set) window.AwsMode.set("board");
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
    afterConnect({ board: true });
  }
  function continueDemo() {
    conn.connected = true;
    if (!currentUser && data.users.length) currentUser = data.users.find((u) => u.type === "human") || data.users[0];
    saveConn();
    toast("Using ZeroBias demo data.");
    afterConnect({ board: true });
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
    afterConnect({ board: true });
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
    const live = hasLiveCreds();
    const frameworks = (o.complianceFrameworks || []).map((f) => `<span class="zb-chip">${esc(f)}</span>`).join("");
    // Be explicit about provenance: only the inventory/IAM/tasks come live; the
    // org profile, boundary list and accounts below are bundled sample data.
    const banner = live
      ? `<div class="zb-tasks-sample"><span class="zb-badge zb-badge-live">● Live</span> Live from boundary <code>${esc(conn.boundaryId)}</code>: AWS inventory, IAM &amp; tasks. The org profile, boundary list &amp; accounts below are <b>sample</b> (the boundary API doesn't expose an org profile).</div>`
      : "";
    els.orgBody.innerHTML = `
      ${banner}
      <div class="zb-org-head">
        <div class="zb-org-name">${esc(live ? "Your ZeroBias org" : o.name)} ${statusBadge()}</div>
        <div class="zb-kv">
          <span>Org ID</span><code>${esc(live ? conn.orgId : (o.danaOrgId || o.id))}</code>
          ${live ? "" : `<span>Plan</span><b>${esc(o.plan || "—")}</b>`}
          ${live ? "" : `<span>Members</span><b>${esc(String(o.memberCount ?? "—"))}</b>`}
          <span>Accounts</span><b>${esc(String((data.accounts || []).length))}${live ? " <small class=\"muted\">(sample)</small>" : ""}</b>
        </div>
        ${live ? "" : (frameworks ? `<div class="zb-chips">${frameworks}</div>` : "")}
      </div>
      <div class="zb-sub-eyebrow">Boundaries (${(data.boundaries || []).length})${live ? " · sample" : ""}</div>
      <div class="zb-boundary-list" id="zb-boundary-list">${boundaryListHtml()}</div>
      <div class="zb-sub-eyebrow">Cloud accounts${live ? " · sample" : ""}</div>
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
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    const isOpen = (t) => !["done", "closed", "resolved", "complete", "completed"].includes(String(t.status));

    // LIVE mode: a real API key is present → show the org's real tasks from the
    // platform task API (or an honest empty/error state). Never fabricated.
    if (hasOrgCreds()) {
      if (liveTasks === null) {
        if (els.tasksCount) els.tasksCount.textContent = "—";
        els.tasksBody.innerHTML = '<p class="muted small">Loading your tasks from ZeroBias…</p>';
        return;
      }
      if (liveTasksError) {
        if (els.tasksCount) els.tasksCount.textContent = "0";
        els.tasksBody.innerHTML = '<p class="muted small">Could not reach the ZeroBias task API (CORS / network). No tasks shown.</p>';
        return;
      }
      const list = liveTasks.slice();
      if (els.tasksCount) els.tasksCount.textContent = String(list.filter(isOpen).length);
      if (!list.length) {
        els.tasksBody.innerHTML =
          '<div class="zb-tasks-empty"><span class="zb-badge zb-badge-live">● Live</span>' +
          '<p class="muted small">No tasks are assigned to you in ZeroBias right now. Nothing here is fabricated.</p></div>';
        return;
      }
      list.sort((a, b) => (isOpen(a) ? 0 : 1) - (isOpen(b) ? 0 : 1) || (order[a.priority] ?? 9) - (order[b.priority] ?? 9));
      els.tasksBody.innerHTML =
        `<div class="zb-tasks-sub muted small"><span class="zb-badge zb-badge-live">● Live</span> ${list.length} assigned to you in ZeroBias</div>` +
        list.map(taskHtml).join("");
      els.tasksBody.querySelectorAll("[data-task-boundary]").forEach((el) =>
        el.addEventListener("click", () => openBoundary(el.getAttribute("data-task-boundary"), el.getAttribute("data-task-holon") || null)));
      return;
    }

    // DEMO mode: no API key → the bundled tasks are FICTIONAL samples, labelled
    // as such and never presented as the signed-in user's real assignments.
    const all = data.tasks || [];
    const list = all.slice();
    const open = list.filter(isOpen);
    if (els.tasksCount) els.tasksCount.textContent = String(open.length);
    const banner =
      '<div class="zb-tasks-sample"><span class="zb-badge zb-badge-demo">Sample</span>' +
      ' Fictional demo tasks — <b>not</b> from your ZeroBias account. Add an API key to see your real tasks.</div>';
    if (!list.length) { els.tasksBody.innerHTML = banner; return; }
    list.sort((a, b) => (isOpen(a) ? 0 : 1) - (isOpen(b) ? 0 : 1) || (order[a.priority] ?? 9) - (order[b.priority] ?? 9));
    els.tasksBody.innerHTML = banner + list.map(taskHtml).join("");
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
            ${t.approver ? `<span class="zb-task-boundary">▸ ${esc(t.approver)}</span>` : ""}
            ${b ? `<span class="zb-task-boundary">${esc(b.name)}</span>` : ""}
            ${due ? `<span class="zb-task-due${overdue ? " is-overdue" : ""}">${esc(due)}</span>` : ""}
          </span>
        </span>
      </button>`;
  }

  // --- rendering: assessor BOARD (the primary assessor interface) --------
  // Swim-lanes × status columns, fed by the live SmeMartTask records from
  // POST /portal/myTasks (badged ● Live) or the bundled sample board (badged
  // Sample). Cards open a detail drawer with the task's real lifecycle/workflow
  // and a (sample) economics roll-up; a deep-link opens the related boundary.

  function fmtMoney(v) {
    if (v == null || isNaN(v)) return "—";
    return "$" + Math.round(v).toLocaleString();
  }
  function titleCaseLocal(s) {
    return String(s || "").replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  function boundaryName(bid) {
    const b = (data.boundaries || []).find((x) => x.id === bid);
    return b ? b.name : bid;
  }
  function resolveLaneAxis(source) {
    if (boardLaneAxis !== "auto") return boardLaneAxis;
    return source === "sample" ? "partition" : "board"; // live has no partition; group by real board
  }

  // Normalise the sample board file into the same task model mapTask() emits, so
  // the board renderer is source-agnostic (live vs sample share one code path).
  function sampleBoardTasks() {
    const P = window.ZeroBiasPlatform;
    if (!boardSampleDoc || !P) return [];
    const wf = boardSampleDoc.workflow || null;
    const board = boardSampleDoc.board || null;
    const closedSet = ["done", "closed", "complete", "completed", "cancelled", "canceled"];
    return (boardSampleDoc.tasks || []).map((t, i) => {
      const level = String(t.priority || "medium").toLowerCase();
      const closed = closedSet.includes(String(t.status).toLowerCase());
      return {
        id: t.id || t.code || "sample-" + i,
        code: t.code || "S-" + i,
        name: t.name,
        description: t.description || "",
        status: String(t.status || "todo"),
        statusName: P.statusLabel(t.status),
        phase: closed ? "closed" : "open",
        phaseName: closed ? "Closed" : "Open",
        priority: { value: null, label: titleCaseLocal(level), level },
        rank: null,
        boardId: board ? board.id : "board-sample",
        board: board ? { id: board.id, name: board.name, description: board.description } : null,
        activity: t.activity ? { code: t.activity.code, name: t.activity.name, type: "task", workflowId: wf ? wf.id : null } : null,
        workflow: wf,
        nextTransitions: wf ? P.transitionsFrom(wf, t.status) : [],
        boundaryId: t.boundaryId || null,
        boundary: t.boundaryId ? { id: t.boundaryId, name: boundaryName(t.boundaryId) } : null,
        product: t.product || null,
        framework: t.framework || null,
        custom: {},
        links: [],
        approver: null,
        partition: t.partition || null,
        source: "sample",
      };
    });
  }

  function renderBoardView() {
    if (!els.boardStage) return;
    const P = window.ZeroBiasPlatform;

    if (!conn.connected) {
      els.boardStage.innerHTML =
        `<div class="zb-board zb-board--empty">${boardHeadHtml({ source: null })}` +
        `<div class="zb-board-scroll"><div class="zb-board-cta">` +
        connectCtaHtml("Connect your ZeroBias account to load your assessor task board — your tasks grouped into swim lanes, each with its lifecycle and economics.") +
        `</div></div></div>`;
      wireBoardEls();
      return;
    }
    if (!P) {
      els.boardStage.innerHTML = `<div class="zb-board"><div class="zb-board-scroll"><div class="zb-board-cta"><p class="muted small">The board module (adapter/zerobias-platform.js) didn’t load.</p></div></div></div>`;
      return;
    }

    const live = hasOrgCreds();
    const source = live ? "live" : "sample";

    // The sample board needs its bundled data file first.
    if (!live && !boardSampleDoc) {
      els.boardStage.innerHTML =
        `<div class="zb-board">${boardHeadHtml({ source })}<div class="zb-board-scroll">` +
        `<div class="zb-board-cta"><p class="muted small">Loading the sample board…</p></div></div></div>`;
      fetchJson(SAMPLE.board).then((doc) => { boardSampleDoc = doc || { tasks: [] }; renderBoardView(); });
      return;
    }

    let tasks = [], loading = false, errored = false;
    if (live) {
      if (myTasksRaw === null && !myTasksErr) loading = true;
      else if (myTasksErr) errored = true;
      else tasks = myTasksRaw.map((t) => P.mapTask(t, "live"));
    } else {
      tasks = sampleBoardTasks();
    }
    boardTasksCache = tasks;

    const axis = resolveLaneAxis(source);
    const model = loading || errored ? null : P.buildBoard(tasks, { laneAxis: axis });

    let body;
    if (loading) body = `<div class="zb-board-cta"><p class="muted small">Loading your tasks from ZeroBias…</p></div>`;
    else if (errored) body = `<div class="zb-board-cta"><p class="muted small">Could not reach the ZeroBias task API (CORS / network). No tasks shown — nothing here is fabricated.</p></div>`;
    else if (!tasks.length) {
      body = `<div class="zb-board-cta"><span class="zb-badge zb-badge-live">● Live</span><p class="muted small">No tasks are assigned to you in ZeroBias right now. Nothing here is fabricated.</p></div>`;
    } else {
      body = boardGridHtml(model) + opportunitiesHtml(tasks);
    }

    els.boardStage.innerHTML =
      `<div class="zb-board">${boardHeadHtml({ source, model, axis })}` +
      `<div class="zb-board-scroll">${body}</div>${detailDrawerHtml()}</div>`;
    wireBoardEls();
  }

  function boardHeadHtml({ source, model, axis }) {
    const badge = source === "live"
      ? '<span class="zb-badge zb-badge-live">● Live</span>'
      : source === "sample"
        ? '<span class="zb-badge zb-badge-demo">Sample</span>'
        : statusBadge();
    const totals = model
      ? `<div class="zb-board-totals">
           <span><b>${model.total.open}</b><i>open</i></span>
           <span><b>${model.total.count}</b><i>tasks</i></span>
           <span class="zb-econ"><b>${fmtMoney(model.total.value)}</b><i>value <span class="zb-badge zb-badge-demo zb-badge-xs">Sample</span></i></span>
         </div>`
      : "";
    const axes = source ? laneAxisSwitchHtml(axis) : "";
    const sub = source === "sample"
      ? "AuditCrowd · Assessor board (sample)"
      : model && model.lanes.length
        ? `${model.lanes.length} lane${model.lanes.length === 1 ? "" : "s"} · ${model.columns.length} status columns`
        : "Your tasks across engagements";
    const provNote = source === "live"
      ? '<p class="zb-board-note muted small"><span class="zb-badge zb-badge-live">● Live</span> Tasks, boards, lifecycle &amp; boundaries are your real ZeroBias data (<code>POST /portal/myTasks</code>). The <b>$ value</b> is a <span class="zb-badge zb-badge-demo zb-badge-xs">Sample</span> rate-card estimate — real budgets need the platform economics API.</p>'
      : source === "sample"
        ? '<p class="zb-board-note muted small"><span class="zb-badge zb-badge-demo">Sample</span> Fictional demo board — <b>not</b> your real tasks. Connect an API key to load your live board.</p>'
        : "";
    return `
      <header class="zb-board-head">
        <div class="zb-board-head-main">
          <div class="zb-board-title"><span class="zb-hex">⬡</span> Assessor board ${badge}</div>
          <div class="zb-board-sub muted small">${esc(sub)}</div>
        </div>
        ${totals}
        <div class="zb-board-actions">
          ${axes}
          <a class="zb-ref-link" href="reference.html" target="_blank" rel="noopener" title="A labelled reference of the assessor experience">What am I seeing? ↗</a>
        </div>
      </header>
      ${provNote}`;
  }

  function laneAxisSwitchHtml(axis) {
    const opts = [
      { k: "board", label: "By board" },
      { k: "partition", label: "By lane" },
      { k: "phase", label: "By phase" },
    ];
    return `<div class="zb-axis-switch" role="group" aria-label="Group swim-lanes by">` +
      opts.map((o) => `<button class="zb-axis-btn${axis === o.k ? " is-active" : ""}" data-board-axis="${o.k}">${o.label}</button>`).join("") +
      `</div>`;
  }

  function boardGridHtml(model) {
    const cols = model.columns;
    const colHeads = cols.map((c) =>
      `<div class="zb-bg-colhead"><span class="zb-bg-dot" style="background:${c.color}"></span>${esc(c.label)}</div>`).join("");
    const rows = model.lanes.map((lane) => {
      const cells = cols.map((c) => {
        const cellTasks = lane.byStatus[c.key] || [];
        return `<div class="zb-bg-cell">${cellTasks.map(boardCardHtml).join("")}</div>`;
      }).join("");
      return `
        <div class="zb-bg-lanehead" style="--lane:${lane.color}">
          <div class="zb-bg-lane-name">${esc(lane.label)}</div>
          <div class="zb-bg-lane-meta">${lane.openCount}/${lane.count} open · <span class="zb-econ-sm">${fmtMoney(lane.value)}</span></div>
          ${lane.desc ? `<div class="zb-bg-lane-desc muted">${esc(lane.desc)}</div>` : ""}
        </div>${cells}`;
    }).join("");
    return `
      <div class="zb-board-grid" style="grid-template-columns: minmax(170px,210px) repeat(${cols.length}, minmax(208px,1fr));">
        <div class="zb-bg-corner"></div>${colHeads}${rows}
      </div>`;
  }

  function boardCardHtml(t) {
    const econ = t.econ || {};
    const chips = [
      t.product ? `<span class="zb-chip zb-chip-prod">${esc(t.product)}</span>` : "",
      t.framework ? `<span class="zb-chip zb-chip-fw">${esc(t.framework)}</span>` : "",
    ].join("");
    return `
      <button class="zb-card pri-${esc(t.priority.level)}" data-task-id="${esc(t.id)}" title="${esc(t.name)}">
        <span class="zb-card-top">
          <span class="zb-card-code">${esc(t.code)}</span>
          <span class="zb-card-pri pri-${esc(t.priority.level)}" title="${esc(t.priority.label || t.priority.level)}"></span>
        </span>
        <span class="zb-card-name">${esc(t.name)}</span>
        ${chips ? `<span class="zb-card-chips">${chips}</span>` : ""}
        <span class="zb-card-foot">
          <span class="zb-card-val">${fmtMoney(econ.value)} <span class="zb-badge zb-badge-demo zb-badge-xs">est</span></span>
          ${t.boundary ? `<span class="zb-card-bnd" title="${esc(t.boundary.name)}">▦ ${esc(t.boundary.name)}</span>` : ""}
        </span>
      </button>`;
  }

  function opportunitiesHtml() {
    const P = window.ZeroBiasPlatform;
    if (!P) return "";
    const profile = P.SAMPLE_PROVIDER_PROFILE;
    const ops = P.SAMPLE_OPPORTUNITIES.map((o) => ({ o, s: P.scoreOpportunity(o, profile) }))
      .sort((a, b) => b.s.score - a.s.score);
    const total = ops.reduce((s, x) => s + x.o.price, 0);
    return `
      <section class="zb-opps">
        <div class="zb-opps-head">
          <div class="zb-opps-title">Opportunities <span class="zb-badge zb-badge-demo">Sample</span></div>
          <div class="zb-opps-sub muted small">Open RFPs &amp; bids matched to your profile — <b>${fmtMoney(total)}</b> in reach. Real bids need the marketplace API (not browser-reachable here).</div>
        </div>
        <div class="zb-opps-row">
          ${ops.map(({ o, s }) => `
            <div class="zb-opp">
              <div class="zb-opp-price">${fmtMoney(o.price)} <span class="zb-opp-model">${esc(String(o.pricingModel || "").toLowerCase())}</span></div>
              <div class="zb-opp-title">${esc(o.title)}</div>
              <div class="zb-opp-meta muted small">${esc(o.product || "")}${o.framework ? " · " + esc(o.framework) : ""} · ${esc(String(o.hours))}h</div>
              ${s.reasons.length
                ? `<div class="zb-opp-match">✓ ${esc(s.reasons.join(" · "))}</div>`
                : `<div class="zb-opp-match zb-opp-nomatch">No profile match</div>`}
            </div>`).join("")}
        </div>
        ${financialGateHtml()}
      </section>`;
  }

  // FinancialProfile is sensitive (annualRevenue / credit) — read-gated at the UI
  // layer: hidden until the user explicitly discloses, and even then it's sample.
  function financialGateHtml() {
    if (!boardFinancials) {
      return `<div class="zb-finprofile">
        <button class="zb-fin-toggle" data-fin-toggle="1">🔒 Show financial profile</button>
        <span class="muted small">FinancialProfile (revenue / credit) is sensitive — hidden until you explicitly disclose.</span>
      </div>`;
    }
    return `<div class="zb-finprofile is-open">
      <div class="zb-fin-head"><b>Financial profile</b> <span class="zb-badge zb-badge-demo">Sample</span>
        <button class="zb-fin-toggle" data-fin-toggle="0">Hide</button></div>
      <div class="zb-fin-grid">
        <span>Annual revenue</span><b>$2.4M</b>
        <span>Credit standing</span><b>Good</b>
        <span>Utilisation (90d)</span><b>72%</b>
      </div>
      <p class="muted small">Illustrative only — the real FinancialProfile is read-gated behind an org disclosure check in ZeroBias.</p>
    </div>`;
  }

  // --- task detail drawer (lifecycle / economics / boundary, WS3) --------

  function detailDrawerHtml() {
    if (!detailTaskId) return "";
    const t = boardTasksCache.find((x) => String(x.id) === String(detailTaskId));
    if (!t) return "";
    const P = window.ZeroBiasPlatform;
    const econ = t.econ || (P ? P.estimateValue(t) : {});
    const localBnd = t.boundaryId ? (data.boundaries || []).find((b) => b.id === t.boundaryId) : null;
    return `
      <div class="zb-drawer" role="dialog" aria-label="Task detail">
        <div class="zb-drawer-head">
          <div>
            <div class="zb-drawer-code">${esc(t.code)} ${t.source === "live" ? '<span class="zb-badge zb-badge-live">● Live</span>' : '<span class="zb-badge zb-badge-demo">Sample</span>'}</div>
            <h3 class="zb-drawer-title">${esc(t.name)}</h3>
          </div>
          <button class="zb-drawer-close" data-drawer-close="1" aria-label="Close detail">×</button>
        </div>
        ${t.description ? `<p class="zb-drawer-desc">${esc(t.description)}</p>` : ""}
        <div class="zb-drawer-meta">
          ${t.product ? `<span class="zb-chip zb-chip-prod">${esc(t.product)}</span>` : ""}
          ${t.framework ? `<span class="zb-chip zb-chip-fw">${esc(t.framework)}</span>` : ""}
          ${t.activity ? `<span class="zb-chip">${esc(t.activity.name || t.activity.code)}</span>` : ""}
          <span class="zb-chip">priority: ${esc(t.priority.label || t.priority.level)}</span>
        </div>
        ${lifecycleHtml(t)}
        ${drawerEconHtml(econ)}
        ${drawerBoundaryHtml(t, localBnd)}
      </div>`;
  }

  function lifecycleHtml(t) {
    const P = window.ZeroBiasPlatform;
    if (!P || !t.workflow) {
      return `<div class="zb-life"><div class="zb-life-eyebrow">Lifecycle</div><p class="muted small">No workflow on this task.</p></div>`;
    }
    const steps = P.pipelineStatuses(t.workflow);
    const curKey = String(t.status).toLowerCase();
    const curIdx = steps.findIndex((s) => s.key === curKey);
    const nodes = steps.map((s, i) => {
      const state = curIdx < 0 ? "future" : i < curIdx ? "past" : i === curIdx ? "current" : "future";
      return `<div class="zb-life-node is-${state}" style="--c:${s.color}"><span class="zb-life-dot"></span><span class="zb-life-label">${esc(s.label)}</span></div>`;
    }).join('<span class="zb-life-edge"></span>');
    const nexts = (t.nextTransitions || []).filter((x) => x.status && x.status !== "init");
    const nextHtml = nexts.length
      ? `<div class="zb-life-next"><span class="muted small">Valid next moves (from workflow data):</span>${nexts.map((x) =>
          `<span class="zb-life-trans">${esc(x.name)} → ${esc(P.statusLabel(x.status))}${x.approval ? ' <span class="zb-life-approval" title="requires approval">⚑</span>' : ""}</span>`).join("")}</div>`
      : "";
    return `
      <div class="zb-life">
        <div class="zb-life-eyebrow">Lifecycle · ${esc(t.workflow.name)} ${t.source === "live" ? '<span class="zb-badge zb-badge-live zb-badge-xs">● Live</span>' : '<span class="zb-badge zb-badge-demo zb-badge-xs">Sample</span>'}</div>
        <div class="zb-life-track">${nodes}</div>
        ${nextHtml}
        <p class="muted small zb-life-foot">Statuses &amp; transitions come from the workflow definition, not hard-coded. Status changes happen in ZeroBias.</p>
      </div>`;
  }

  function drawerEconHtml(econ) {
    return `
      <div class="zb-drawer-econ">
        <div class="zb-life-eyebrow">Economics <span class="zb-badge zb-badge-demo zb-badge-xs">Sample estimate</span></div>
        <div class="zb-econ-grid">
          <span>Estimated effort</span><b>${econ.hours != null ? esc(String(econ.hours)) + " h" : "—"}</b>
          <span>Rate</span><b>${econ.rate != null ? fmtMoney(econ.rate) + "/h" : "—"}</b>
          <span>Rolled-up value</span><b>${fmtMoney(econ.value)}</b>
        </div>
        <p class="muted small">${esc(econ.basis || "")} — illustrative; real value = activity.estimatedTime × the project budget rate.</p>
      </div>`;
  }

  function drawerBoundaryHtml(t, localBnd) {
    if (localBnd) {
      return `<div class="zb-drawer-bnd">
        <div class="zb-life-eyebrow">Validates against</div>
        <button class="btn primary zb-open-bnd" data-open-bnd="${esc(localBnd.id)}">▦ Open ${esc(localBnd.name)} →</button>
        <span class="muted small">Opens the boundary in the holographic view.</span>
      </div>`;
    }
    if (t.boundary) {
      return `<div class="zb-drawer-bnd">
        <div class="zb-life-eyebrow">Validates against</div>
        <div class="zb-bnd-name">▦ ${esc(t.boundary.name)} <span class="zb-badge zb-badge-live zb-badge-xs">● Live</span></div>
        <span class="muted small">This boundary lives in ZeroBias — no local snapshot to open here.</span>
      </div>`;
    }
    return "";
  }

  function openTaskDetail(id) { detailTaskId = id; renderBoardView(); }

  function wireBoardEls() {
    const root = els.boardStage;
    if (!root) return;
    root.querySelectorAll("[data-task-id]").forEach((el) =>
      el.addEventListener("click", () => openTaskDetail(el.getAttribute("data-task-id"))));
    root.querySelectorAll("[data-board-axis]").forEach((el) =>
      el.addEventListener("click", () => { boardLaneAxis = el.getAttribute("data-board-axis"); renderBoardView(); }));
    root.querySelectorAll("[data-drawer-close]").forEach((el) =>
      el.addEventListener("click", () => { detailTaskId = null; renderBoardView(); }));
    root.querySelectorAll("[data-fin-toggle]").forEach((el) =>
      el.addEventListener("click", () => { boardFinancials = el.getAttribute("data-fin-toggle") === "1"; renderBoardView(); }));
    root.querySelectorAll("[data-open-bnd]").forEach((el) =>
      el.addEventListener("click", () => {
        const bid = el.getAttribute("data-open-bnd");
        detailTaskId = null;
        openBoundary(bid).then(() => { if (window.AwsMode && window.AwsMode.set) window.AwsMode.set("3d"); });
      }));
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
    // Prefer real task count when connected live; fall back to the sample count.
    const taskSrc = hasOrgCreds() && Array.isArray(liveTasks) ? liveTasks : (data.tasks || []);
    const open = taskSrc.filter((t) => !["done", "closed", "resolved", "complete", "completed"].includes(String(t.status))).length;
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
    renderBoardView();
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
    // board
    els.boardStage = document.getElementById("stage-board");
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
    renderBoard: renderBoardView,
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
