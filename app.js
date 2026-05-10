// Glue layer: file import, drag-drop, sidebar updates, control buttons.
(function () {
  const els = {
    fileInput: document.getElementById("file-input"),
    loadSample: document.getElementById("load-sample"),
    toggleFlow: document.getElementById("toggle-flow"),
    resetZoom: document.getElementById("reset-zoom"),
    mode2d: document.getElementById("mode-2d"),
    mode3d: document.getElementById("mode-3d"),
    exploreBtn: document.getElementById("explore-btn"),
    exploreHud: document.getElementById("explore-hud"),
    attackBtn: document.getElementById("attack-btn"),
    attackModal: document.getElementById("attack-modal"),
    attackGrid: document.getElementById("attack-grid"),
    attackModalClose: document.getElementById("attack-modal-close"),
    attackHud: document.getElementById("attack-hud"),
    attackHudIcon: document.getElementById("attack-hud-icon"),
    attackHudName: document.getElementById("attack-hud-name"),
    attackHudPhase: document.getElementById("attack-hud-phase"),
    attackProgressFill: document.getElementById("attack-progress-fill"),
    attackStatSpawned: document.getElementById("attack-stat-spawned"),
    attackStatBlocked: document.getElementById("attack-stat-blocked"),
    attackStatArrived: document.getElementById("attack-stat-arrived"),
    attackLog: document.getElementById("attack-log"),
    attackAbort: document.getElementById("attack-abort"),
    attackSummary: document.getElementById("attack-summary"),
    attackSummaryClose: document.getElementById("attack-summary-close"),
    attackSummaryOutcome: document.getElementById("attack-summary-outcome"),
    attackSummaryStats: document.getElementById("attack-summary-stats"),
    attackSummaryLog: document.getElementById("attack-summary-log"),
    attackSummaryReplay: document.getElementById("attack-summary-replay"),
    attackSummaryDone: document.getElementById("attack-summary-done"),
    themeToggle: document.getElementById("theme-toggle"),
    themeIconNight: document.getElementById("theme-icon-night"),
    themeIconDay: document.getElementById("theme-icon-day"),
    stage: document.getElementById("stage"),
    stage3d: document.getElementById("stage-3d"),
    diagram: document.getElementById("diagram"),
    hint3d: document.getElementById("hint-3d"),
    netName: document.getElementById("net-name"),
    netMeta: document.getElementById("net-meta"),
    timelinePanel: document.getElementById("timeline-panel"),
    timelineList: document.getElementById("timeline-list"),
    detailTitle: document.getElementById("detail-title"),
    detailSummary: document.getElementById("detail-summary"),
    detailProps: document.getElementById("detail-props"),
    detailExplainer: document.getElementById("detail-explainer"),
    hint: document.getElementById("hint"),
  };

  let currentData = null;
  let currentVersions = null;   // full versions array if the loaded network is multi-version
  let currentVersionId = null;
  let networkName = null;       // top-level network name (separate from version-specific name)
  let paused = false;
  let mode = "2d";

  // Exposed so tour.js can route focus/highlight to the active mode.
  window.AwsMode = {
    is3D: () => mode === "3d",
    current: () => mode,
  };

  function loadData(data) {
    // Multi-version network: { name, versions: [{ id, name, author, timestamp,
    // status, note, data: { vpcs, flows, ... } }, ...] }
    if (data && Array.isArray(data.versions) && data.versions.length) {
      currentVersions = data.versions;
      networkName = data.name || null;
      const latest = currentVersions[currentVersions.length - 1];
      currentVersionId = latest.id;
      renderTimeline();
      els.timelinePanel.hidden = false;
      applyVersionData(latest.data);
      fadeHint();
      return;
    }

    // Single-version network (the original schema): top-level vpcs/flows
    if (!data || !data.vpcs) {
      alert("That JSON doesn't look like a network topology — expected a top-level 'vpcs' array (or a 'versions' array).");
      return;
    }
    currentVersions = null;
    currentVersionId = null;
    networkName = data.name || null;
    els.timelinePanel.hidden = true;
    applyVersionData(data);
    fadeHint();
  }

  function applyVersionData(data) {
    currentData = data;
    AwsViz.render(data);
    if (window.AwsViz3D && window.AwsViz3D.isReady()) {
      window.AwsViz3D.render(data);
    }
    updateSummary(data);
  }

  function selectVersion(id) {
    if (!currentVersions) return;
    const ver = currentVersions.find((v) => v.id === id);
    if (!ver) return;
    currentVersionId = id;
    applyVersionData(ver.data);
    renderTimeline();
  }

  function renderTimeline() {
    if (!currentVersions) {
      els.timelineList.innerHTML = "";
      return;
    }
    els.timelineList.innerHTML = currentVersions
      .map((v) => {
        const isActive = v.id === currentVersionId;
        const status = v.status || "ok";
        const statusLabel = status === "broken" ? "broken" : status === "fixed" ? "fixed" : "ok";
        const date = v.timestamp ? formatVersionDate(v.timestamp) : "";
        const author = v.author ? escapeHtml(v.author).replace(/@.+$/, "") : "unknown";
        const noteHtml = v.note
          ? `<div class="version-note status-${status}">${escapeHtml(v.note)}</div>`
          : "";
        return `
          <div class="version-item ${isActive ? "is-active" : ""}" data-version-id="${escapeHtml(v.id)}">
            <span class="version-dot status-${status}"></span>
            <div class="version-header">
              <div>
                <div class="version-name">${escapeHtml(v.name || v.id)}</div>
                <div class="version-byline">
                  <span class="author">${author}</span>
                  ${date ? `<span>· ${escapeHtml(date)}</span>` : ""}
                </div>
              </div>
              <span class="version-status ${status}">${statusLabel}</span>
            </div>
            ${noteHtml}
          </div>
        `;
      })
      .join("");

    els.timelineList.querySelectorAll(".version-item").forEach((el) => {
      el.addEventListener("click", () => selectVersion(el.getAttribute("data-version-id")));
    });
  }

  function formatVersionDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  // ---- Mode switching ----

  function setMode(next) {
    if (next === mode) return;
    mode = next;
    document.body.classList.toggle("mode-3d", mode === "3d");
    els.mode2d.classList.toggle("is-active", mode === "2d");
    els.mode3d.classList.toggle("is-active", mode === "3d");
    els.mode2d.setAttribute("aria-pressed", mode === "2d" ? "true" : "false");
    els.mode3d.setAttribute("aria-pressed", mode === "3d" ? "true" : "false");
    els.diagram.style.display = mode === "2d" ? "" : "none";
    els.stage3d.hidden = mode !== "3d";
    els.hint3d.hidden = mode !== "3d";
    els.exploreBtn.hidden = mode !== "3d";
    els.attackBtn.hidden = mode !== "3d";
    if (mode !== "3d") {
      if (window.AwsViz3D && window.AwsViz3D.isExploring()) {
        window.AwsViz3D.exitExplore();
        els.exploreHud.hidden = true;
      }
      if (window.AwsViz3D && window.AwsViz3D.isAttackActive && window.AwsViz3D.isAttackActive()) {
        window.AwsViz3D.stopAttack();
      }
      els.attackHud.hidden = true;
      els.attackModal.hidden = true;
      els.attackSummary.hidden = true;
    }

    if (mode === "3d") {
      // Lazy-init the 3D scene. The module is loaded via <script type="module">
      // and might not have attached AwsViz3D yet on a slow connection.
      const tryInit = (attempts = 20) => {
        if (window.AwsViz3D) {
          if (!window.AwsViz3D.isReady()) window.AwsViz3D.init(els.stage3d);
          if (currentData) window.AwsViz3D.render(currentData);
          if (window.AwsViz3D.setTheme) window.AwsViz3D.setTheme(theme);
        } else if (attempts > 0) {
          setTimeout(() => tryInit(attempts - 1), 100);
        } else {
          alert(
            "3D view couldn't load. Your browser may not support import maps (needs Chrome 89+, Safari 16.4+, or Firefox 108+) or you may be offline.",
          );
          setMode("2d");
        }
      };
      tryInit();
    }
  }

  els.mode2d.addEventListener("click", () => setMode("2d"));
  els.mode3d.addEventListener("click", () => setMode("3d"));

  // ---- Day / night theme ----

  let theme = localStorage.getItem("aws-viz.theme") === "day" ? "day" : "night";
  applyTheme(theme);

  function applyTheme(next) {
    theme = next === "day" ? "day" : "night";
    document.body.classList.toggle("theme-day", theme === "day");
    els.themeIconNight.style.display = theme === "day" ? "none" : "";
    els.themeIconDay.style.display   = theme === "day" ? "" : "none";
    els.themeToggle.setAttribute("aria-label",
      theme === "day" ? "Switch to night theme" : "Switch to day theme");
    if (window.AwsViz3D && window.AwsViz3D.setTheme) {
      window.AwsViz3D.setTheme(theme);
    }
  }

  els.themeToggle.addEventListener("click", () => {
    const next = theme === "day" ? "night" : "day";
    applyTheme(next);
    localStorage.setItem("aws-viz.theme", next);
  });

  // Explore mode (first-person walk through the city). 3D only.
  els.exploreBtn.addEventListener("click", () => {
    if (!window.AwsViz3D || !window.AwsViz3D.isReady()) return;
    if (window.AwsViz3D.isExploring()) {
      window.AwsViz3D.exitExplore();
    } else {
      // Close the tour first if it's open — pointer-lock would fight the
      // tour bar's keyboard shortcuts.
      const tourBar = document.getElementById("tour-bar");
      if (tourBar && tourBar.classList.contains("open") && window.AwsTour) {
        window.AwsTour.close();
      }
      els.exploreHud.hidden = false;
      window.AwsViz3D.enterExplore();
    }
  });

  // ---- Attack simulation ----

  let lastAttackId = null;

  function openAttackModal() {
    if (!window.AwsViz3D || !window.AwsViz3D.isReady()) return;
    // Whatever else is going on, always end up in a clean state where
    // the picker is the only thing visible.
    if (window.AwsViz3D.isAttackActive && window.AwsViz3D.isAttackActive()) {
      window.AwsViz3D.stopAttack();
    }
    if (window.AwsViz3D.isExploring && window.AwsViz3D.isExploring()) {
      window.AwsViz3D.exitExplore();
    }
    const tourBar = document.getElementById("tour-bar");
    if (tourBar && tourBar.classList.contains("open") && window.AwsTour) {
      window.AwsTour.close();
    }
    els.attackHud.hidden = true;
    els.attackSummary.hidden = true;
    populateAttackGrid();
    // Defensive: clear any stale inline display style and force visible
    els.attackModal.style.display = "";
    els.attackModal.hidden = false;
  }

  function populateAttackGrid() {
    const types = window.AwsViz3D.attackTypes ? window.AwsViz3D.attackTypes() : [];
    els.attackGrid.innerHTML = types
      .map(
        (t) => `
          <button class="attack-card" data-attack="${escapeHtml(t.id)}">
            <span class="attack-card-icon">${escapeHtml(t.icon || "!")}</span>
            <span>
              <h3>${escapeHtml(t.name)}</h3>
              <p>${escapeHtml(t.description)}</p>
            </span>
          </button>`,
      )
      .join("");
    els.attackGrid.querySelectorAll(".attack-card").forEach((card) => {
      card.addEventListener("click", () => {
        startAttack(card.getAttribute("data-attack"));
      });
    });
  }

  function startAttack(id) {
    if (!window.AwsViz3D) return;
    lastAttackId = id;
    els.attackModal.hidden = true;
    els.attackSummary.hidden = true;
    els.attackHud.hidden = false;
    els.attackLog.innerHTML = "";
    setAttackStat(els.attackStatSpawned, 0);
    setAttackStat(els.attackStatBlocked, 0);
    setAttackStat(els.attackStatArrived, 0);
    els.attackProgressFill.style.right = "100%";
    window.AwsViz3D.startAttack(id);
  }

  function setAttackStat(el, value) {
    el.textContent = String(value);
  }

  function renderAttackLog(events) {
    // Render the last 8 events in the live HUD
    const recent = events.slice(-8);
    els.attackLog.innerHTML = recent
      .map((ev) => `
        <li class="sev-${escapeHtml(ev.severity)}">
          <span>${escapeHtml(formatTime(ev.t))}</span>
          <span>${escapeHtml(ev.message)}</span>
        </li>`)
      .join("");
    // Auto-scroll to bottom
    els.attackLog.scrollTop = els.attackLog.scrollHeight;
  }

  function formatTime(ms) {
    if (typeof ms !== "number") return "";
    const totalS = ms / 1000;
    const m = Math.floor(totalS / 60);
    const s = Math.floor(totalS - m * 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  // viz3d.js calls these when an attack is running
  window.AwsAttack = {
    onStart(def) {
      els.attackHudIcon.textContent = def.icon || "!";
      els.attackHudName.textContent = def.name;
      els.attackHudPhase.textContent = "Starting…";
    },
    onTick(state) {
      if (!state) return;
      els.attackHudPhase.textContent = state.phaseLabel || "";
      els.attackProgressFill.style.right = `${100 - state.progress * 100}%`;
      setAttackStat(els.attackStatSpawned, state.stats.spawned);
      setAttackStat(els.attackStatBlocked, state.stats.blocked);
      setAttackStat(els.attackStatArrived, state.stats.arrived);
      renderAttackLog(state.events);
    },
    onEnd(summary) {
      // Hide live HUD, show summary modal
      els.attackHud.hidden = true;
      renderAttackSummary(summary);
      els.attackSummary.hidden = false;
    },
    onStop() {
      els.attackHud.hidden = true;
    },
  };

  function renderAttackSummary(summary) {
    els.attackSummaryOutcome.className =
      `attack-summary-outcome status-${summary.outcomeStatus || "warn"}`;
    els.attackSummaryOutcome.textContent = summary.outcome;

    els.attackSummaryStats.innerHTML = summary.stats
      .map(
        (s) => `
          <div>
            <div class="label">${escapeHtml(s.label)}</div>
            <div class="value">${escapeHtml(String(s.value))}</div>
          </div>`,
      )
      .join("");

    els.attackSummaryLog.innerHTML = summary.events
      .map(
        (ev) => `
          <li class="sev-${escapeHtml(ev.severity)}">
            <span class="t">${escapeHtml(formatTime(ev.t))}</span>
            <span></span>
            <span>${escapeHtml(ev.message)}</span>
          </li>`,
      )
      .join("");
  }

  els.attackBtn.addEventListener("click", openAttackModal);
  els.attackModalClose.addEventListener("click", () => {
    els.attackModal.hidden = true;
  });
  els.attackAbort.addEventListener("click", () => {
    if (window.AwsViz3D) window.AwsViz3D.stopAttack();
    els.attackHud.hidden = true;
  });
  els.attackSummaryClose.addEventListener("click", () => {
    if (window.AwsViz3D) window.AwsViz3D.stopAttack();
    els.attackSummary.hidden = true;
  });
  els.attackSummaryDone.addEventListener("click", () => {
    if (window.AwsViz3D) window.AwsViz3D.stopAttack();
    els.attackSummary.hidden = true;
  });
  els.attackSummaryReplay.addEventListener("click", () => {
    if (lastAttackId) startAttack(lastAttackId);
  });

  // Click outside the modal cards dismisses
  els.attackModal.addEventListener("click", (e) => {
    if (e.target === els.attackModal) els.attackModal.hidden = true;
  });
  els.attackSummary.addEventListener("click", (e) => {
    if (e.target === els.attackSummary) {
      if (window.AwsViz3D) window.AwsViz3D.stopAttack();
      els.attackSummary.hidden = true;
    }
  });

  // Hide HUD when explore exits (poll because PointerLockControls fires
  // 'unlock' inside viz3d.js, not here)
  document.addEventListener("pointerlockchange", () => {
    if (!document.pointerLockElement && els.exploreHud) {
      // Small delay so the prox-panel slide-out animation can play.
      setTimeout(() => {
        if (window.AwsViz3D && !window.AwsViz3D.isExploring()) {
          els.exploreHud.hidden = true;
        }
      }, 250);
    }
  });

  function updateSummary(data) {
    // Prefer the top-level network name when working with a multi-version
    // network so the header doesn't flicker between "v1", "v2", "v3" labels.
    els.netName.textContent = networkName || data.name || "Unnamed network";
    const counts = countResources(data);
    const region = data.region || (data.vpcs[0] && data.vpcs[0].region) || "—";
    const verLabel = currentVersionId ? `version ${currentVersionId} · ` : "";
    els.netMeta.textContent =
      `${verLabel}${data.vpcs.length} VPC${data.vpcs.length !== 1 ? "s" : ""} · ` +
      `${counts.subnets} subnets · ${counts.resources} resources · ` +
      `${counts.flows} flows · ${region}`;
  }

  function countResources(data) {
    let subnets = 0;
    let resources = 0;
    (data.vpcs || []).forEach((v) => {
      subnets += (v.subnets || []).length;
      resources += (v.resources || []).length + (v.gateways || []).length;
    });
    return { subnets, resources, flows: (data.flows || []).length };
  }

  function fadeHint() {
    if (!els.hint) return;
    els.hint.classList.add("fade");
    setTimeout(() => els.hint && (els.hint.style.display = "none"), 600);
  }

  AwsViz.onSelect = function (node) {
    if (!node) {
      els.detailTitle.textContent = "Hover an element";
      els.detailSummary.textContent =
        "Move the cursor over a VPC, subnet, gateway, or service to see how it works and how traffic flows through it.";
      els.detailProps.innerHTML = "";
      els.detailExplainer.innerHTML = "";
      return;
    }

    const meta = explainFor(node);

    els.detailTitle.textContent = node.name || node.id || meta.title;
    els.detailSummary.textContent = meta.title;

    const props = [
      ["Type", (node.type || "").toUpperCase()],
      ["ID", node.id],
      ["Name", node.name],
      ["CIDR", node.cidr],
      ["AZ", node.az],
      ["Tier", node.tier],
      ["Subnet", node.parent && node.parent !== node.id ? node.parent : null],
    ].filter(([, v]) => v);

    els.detailProps.innerHTML = props
      .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`)
      .join("");

    const bullets = (meta.bullets || [])
      .map((b) => `<li>${escapeHtml(b)}</li>`)
      .join("");

    const flowSummary = describeFlowsFor(node);

    els.detailExplainer.innerHTML = `
      <div>${escapeHtml(meta.summary)}</div>
      ${bullets ? `<ul>${bullets}</ul>` : ""}
      ${flowSummary ? `<div style="margin-top:10px"><strong>Traffic involving this element</strong><ul>${flowSummary}</ul></div>` : ""}
    `;
  };

  AwsViz.onSelectFlow = function (flow, fromNode, toNode) {
    if (!flow) return;
    els.detailTitle.textContent = flow.label || "Traffic flow";
    els.detailSummary.textContent = `${nodeLabel(fromNode)} → ${nodeLabel(toNode)}`;
    els.detailProps.innerHTML = `
      <dt>From</dt><dd>${escapeHtml(nodeLabel(fromNode))}</dd>
      <dt>To</dt><dd>${escapeHtml(nodeLabel(toNode))}</dd>
      ${flow.kind ? `<dt>Kind</dt><dd>${escapeHtml(flow.kind)}</dd>` : ""}
      ${flow.label ? `<dt>Label</dt><dd>${escapeHtml(flow.label)}</dd>` : ""}
    `;
    els.detailExplainer.innerHTML = `
      <div>${flowExplainer(flow, fromNode, toNode)}</div>
    `;
  };

  function nodeLabel(n) {
    if (!n) return "—";
    return n.name || n.id || n.type;
  }

  function flowExplainer(flow, a, b) {
    const kind = flow.kind || inferFlowKind(a, b);
    if (kind === "internet") {
      return `Public-internet traffic enters through an Internet Gateway and is routed to a public-subnet target. It must pass any WAF / Security Group rules attached to the receiving resource.`;
    }
    if (kind === "egress") {
      return `Outbound traffic from a private subnet hops through a NAT Gateway in a public subnet, which translates the source IP and forwards out via the Internet Gateway. Return traffic is allowed automatically (NAT is stateful).`;
    }
    return `Internal east-west traffic stays within the VPC. It is governed by Security Groups on each ENI and the route tables of the source and destination subnets.`;
  }

  function inferFlowKind(a, b) {
    if (!a || !b) return "internal";
    if (a.type === "internet" || b.type === "internet") return "internet";
    if (a.type === "nat" || b.type === "igw") return "egress";
    return "internal";
  }

  function explainFor(node) {
    if (!node) return window.AWS_EXPLAIN.unknown;
    if (node.type === "subnet") {
      return window.AWS_TIER_EXPLAIN[node.tier] || window.AWS_EXPLAIN.subnet;
    }
    return window.AWS_EXPLAIN[node.type] || window.AWS_EXPLAIN.unknown;
  }

  function describeFlowsFor(node) {
    if (!currentData || !currentData.flows) return "";
    const matches = currentData.flows.filter(
      (f) => f.from === node.id || f.to === node.id,
    );
    if (!matches.length) return "";
    return matches
      .map((f) => {
        const dir = f.from === node.id ? "→" : "←";
        const other = f.from === node.id ? f.to : f.from;
        return `<li>${dir} <code>${escapeHtml(other)}</code>${f.label ? ` &nbsp; <span style="color:#8b9bbb">${escapeHtml(f.label)}</span>` : ""}</li>`;
      })
      .join("");
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // --- Import wiring ---------------------------------------------------

  els.fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) readFile(file);
    e.target.value = "";
  });

  els.loadSample.addEventListener("click", async () => {
    try {
      const res = await fetch("sample-network.json");
      const data = await res.json();
      loadData(data);
    } catch (err) {
      // Fallback for file:// where fetch may be blocked
      loadData(EMBEDDED_SAMPLE);
    }
  });

  els.toggleFlow.addEventListener("click", () => {
    paused = !paused;
    document.body.classList.toggle("paused", paused);
    els.toggleFlow.textContent = paused ? "Resume traffic" : "Pause traffic";
  });

  els.resetZoom.addEventListener("click", () => AwsViz.resetZoom());

  function readFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        loadData(data);
      } catch (err) {
        alert("Could not parse JSON: " + err.message);
      }
    };
    reader.readAsText(file);
  }

  // Drag-and-drop on the stage
  ["dragenter", "dragover"].forEach((evt) =>
    els.stage.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      els.stage.classList.add("dropping");
    }),
  );
  ["dragleave", "drop"].forEach((evt) =>
    els.stage.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      els.stage.classList.remove("dropping");
    }),
  );
  els.stage.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (file) readFile(file);
  });

  // Embedded fallback so the page works even when opened from file://.
  // Mirrors sample-network.json — three versions of the same network so
  // the timeline panel works even without a working fetch.
  const SHARED_SUBNETS_AB = [
    { id: "pub-1a", name: "Public 1a", cidr: "10.0.1.0/24",  tier: "public",  az: "us-east-1a" },
    { id: "prv-1a", name: "App 1a",    cidr: "10.0.11.0/24", tier: "private", az: "us-east-1a" },
    { id: "db-1a",  name: "Data 1a",   cidr: "10.0.21.0/24", tier: "data",    az: "us-east-1a" },
    { id: "pub-1b", name: "Public 1b", cidr: "10.0.2.0/24",  tier: "public",  az: "us-east-1b" },
    { id: "prv-1b", name: "App 1b",    cidr: "10.0.12.0/24", tier: "private", az: "us-east-1b" },
    { id: "db-1b",  name: "Data 1b",   cidr: "10.0.22.0/24", tier: "data",    az: "us-east-1b" },
  ];
  const SUBNETS_C = [
    { id: "pub-1c", name: "Public 1c", cidr: "10.0.3.0/24",  tier: "public",  az: "us-east-1c" },
    { id: "prv-1c", name: "App 1c",    cidr: "10.0.13.0/24", tier: "private", az: "us-east-1c" },
    { id: "db-1c",  name: "Data 1c",   cidr: "10.0.23.0/24", tier: "data",    az: "us-east-1c" },
  ];

  const V1 = {
    name: "Three-Tier Web App · v1", region: "us-east-1",
    vpcs: [{
      id: "vpc-prod", name: "Production", cidr: "10.0.0.0/16", region: "us-east-1",
      subnets: SHARED_SUBNETS_AB,
      gateways: [
        { id: "igw-prod", type: "igw", name: "Internet GW" },
        { id: "nat-1a",   type: "nat", name: "NAT 1a", subnet: "pub-1a" },
        { id: "nat-1b",   type: "nat", name: "NAT 1b", subnet: "pub-1b" },
      ],
      resources: [
        { id: "alb",   type: "alb",    name: "Web ALB",    subnet: "pub-1a" },
        { id: "waf",   type: "waf",    name: "WAF",        subnet: "pub-1b" },
        { id: "app-a", type: "ecs",    name: "API Tasks",  subnet: "prv-1a" },
        { id: "app-b", type: "ecs",    name: "API Tasks",  subnet: "prv-1b" },
        { id: "fn",    type: "lambda", name: "Webhook Fn", subnet: "prv-1b" },
        { id: "rds-w", type: "aurora", name: "Aurora W",   subnet: "db-1a" },
        { id: "rds-r", type: "aurora", name: "Aurora R",   subnet: "db-1b" },
      ],
    }],
    flows: [
      { from: "internet", to: "alb",   label: "HTTPS 443", kind: "internet" },
      { from: "internet", to: "waf",   label: "inspect",   kind: "internet" },
      { from: "alb",      to: "app-a", label: "HTTP" },
      { from: "alb",      to: "app-b", label: "HTTP" },
      { from: "app-a",    to: "rds-w", label: "5432 write" },
      { from: "app-b",    to: "rds-r", label: "5432 read"  },
      { from: "fn",       to: "rds-r", label: "5432 read"  },
      { from: "app-a",    to: "nat-1a",label: "egress",    kind: "egress" },
      { from: "app-b",    to: "nat-1b",label: "egress",    kind: "egress" },
      { from: "nat-1a",   to: "igw-prod", label: "0.0.0.0/0", kind: "egress" },
      { from: "nat-1b",   to: "igw-prod", label: "0.0.0.0/0", kind: "egress" },
    ],
  };
  const V2 = {
    name: "Three-Tier Web App · v2 (broken)", region: "us-east-1",
    vpcs: [{
      id: "vpc-prod", name: "Production", cidr: "10.0.0.0/16", region: "us-east-1",
      subnets: [...SHARED_SUBNETS_AB, ...SUBNETS_C],
      gateways: [
        { id: "igw-prod", type: "igw", name: "Internet GW" },
        { id: "nat-1a",   type: "nat", name: "NAT 1a", subnet: "pub-1a" },
        { id: "nat-1b",   type: "nat", name: "NAT 1b", subnet: "pub-1b" },
      ],
      resources: [
        { id: "alb",   type: "alb",    name: "Web ALB",       subnet: "pub-1a" },
        { id: "waf",   type: "waf",    name: "WAF",           subnet: "pub-1b" },
        { id: "app-a", type: "ecs",    name: "API Tasks 1a",  subnet: "prv-1a" },
        { id: "app-b", type: "ecs",    name: "API Tasks 1b",  subnet: "prv-1b" },
        { id: "app-c", type: "ecs",    name: "API Tasks 1c",  subnet: "prv-1c" },
        { id: "fn",    type: "lambda", name: "Webhook Fn",    subnet: "prv-1b" },
        { id: "rds-w", type: "aurora", name: "Aurora W",      subnet: "db-1a"  },
        { id: "rds-r", type: "aurora", name: "Aurora R 1b",   subnet: "db-1b"  },
        { id: "rds-x", type: "aurora", name: "Aurora R 1c",   subnet: "db-1c"  },
      ],
    }],
    flows: [
      { from: "internet", to: "alb",     label: "HTTPS 443", kind: "internet" },
      { from: "internet", to: "waf",     label: "inspect",   kind: "internet" },
      { from: "alb",      to: "app-a",   label: "HTTP" },
      { from: "alb",      to: "app-b",   label: "HTTP" },
      { from: "alb",      to: "app-c",   label: "HTTP" },
      { from: "app-a",    to: "rds-w",   label: "5432 write" },
      { from: "app-b",    to: "rds-r",   label: "5432 read"  },
      { from: "app-c",    to: "rds-x",   label: "5432 read"  },
      { from: "fn",       to: "rds-r",   label: "5432 read"  },
      { from: "app-a",    to: "nat-1a",  label: "egress",    kind: "egress" },
      { from: "app-b",    to: "nat-1b",  label: "egress",    kind: "egress" },
      { from: "app-c",    to: "nat-1a",  label: "egress (cross-AZ!)", kind: "egress" },
      { from: "nat-1a",   to: "igw-prod",label: "0.0.0.0/0", kind: "egress" },
      { from: "nat-1b",   to: "igw-prod",label: "0.0.0.0/0", kind: "egress" },
    ],
  };
  const V3 = {
    name: "Three-Tier Web App · v3 (fixed)", region: "us-east-1",
    vpcs: [{
      id: "vpc-prod", name: "Production", cidr: "10.0.0.0/16", region: "us-east-1",
      subnets: [...SHARED_SUBNETS_AB, ...SUBNETS_C],
      gateways: [
        { id: "igw-prod", type: "igw", name: "Internet GW" },
        { id: "nat-1a",   type: "nat", name: "NAT 1a", subnet: "pub-1a" },
        { id: "nat-1b",   type: "nat", name: "NAT 1b", subnet: "pub-1b" },
        { id: "nat-1c",   type: "nat", name: "NAT 1c", subnet: "pub-1c" },
      ],
      resources: V2.vpcs[0].resources,
    }],
    flows: [
      { from: "internet", to: "alb",     label: "HTTPS 443", kind: "internet" },
      { from: "internet", to: "waf",     label: "inspect",   kind: "internet" },
      { from: "alb",      to: "app-a",   label: "HTTP" },
      { from: "alb",      to: "app-b",   label: "HTTP" },
      { from: "alb",      to: "app-c",   label: "HTTP" },
      { from: "app-a",    to: "rds-w",   label: "5432 write" },
      { from: "app-b",    to: "rds-r",   label: "5432 read"  },
      { from: "app-c",    to: "rds-x",   label: "5432 read"  },
      { from: "fn",       to: "rds-r",   label: "5432 read"  },
      { from: "app-a",    to: "nat-1a",  label: "egress",    kind: "egress" },
      { from: "app-b",    to: "nat-1b",  label: "egress",    kind: "egress" },
      { from: "app-c",    to: "nat-1c",  label: "egress",    kind: "egress" },
      { from: "nat-1a",   to: "igw-prod",label: "0.0.0.0/0", kind: "egress" },
      { from: "nat-1b",   to: "igw-prod",label: "0.0.0.0/0", kind: "egress" },
      { from: "nat-1c",   to: "igw-prod",label: "0.0.0.0/0", kind: "egress" },
    ],
  };
  const EMBEDDED_SAMPLE = {
    name: "Three-Tier Web App",
    region: "us-east-1",
    versions: [
      { id: "v1", name: "Initial 3-tier deployment", author: "alice@example.com",
        timestamp: "2025-01-15T10:00:00Z", status: "ok",
        note: "Two-AZ ALB + ECS + Aurora setup. Production ready.", data: V1 },
      { id: "v2", name: "Expand to third AZ (us-east-1c)", author: "bob@example.com",
        timestamp: "2025-02-03T14:30:00Z", status: "broken",
        note: "Webhook integrations from app-1c are timing out. The new us-east-1c AZ has the app subnet (prv-1c) and a data subnet (db-1c) but NO NAT gateway in pub-1c. The route table for prv-1c was pointed at nat-1a in another AZ — that doubles latency, costs cross-AZ data-transfer fees, and on any 1a outage app-1c loses its internet egress entirely.",
        data: V2 },
      { id: "v3", name: "Add NAT gateway in 1c", author: "alice@example.com",
        timestamp: "2025-02-04T09:15:00Z", status: "fixed",
        note: "Provisioned nat-1c in pub-1c (its own Elastic IP) and updated prv-1c's route table to send 0.0.0.0/0 to nat-1c. App tasks in 1c now egress through the local NAT — webhooks succeed, cross-AZ data-transfer cost is gone, and an outage in 1a no longer takes 1c offline.",
        data: V3 },
    ],
  };

  // Auto-load the sample on first paint so the page never starts empty.
  window.addEventListener("DOMContentLoaded", async () => {
    try {
      const res = await fetch("sample-network.json");
      if (res.ok) {
        loadData(await res.json());
        return;
      }
    } catch (_) {
      /* file:// or offline */
    }
    loadData(EMBEDDED_SAMPLE);
  });
})();
