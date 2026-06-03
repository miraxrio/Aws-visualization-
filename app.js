// Glue layer: file import, drag-drop, sidebar updates, control buttons.
(function () {
  const els = {
    fileInput: document.getElementById("file-input"),
    loadSample: document.getElementById("load-sample"),
    toggleFlow: document.getElementById("toggle-flow"),
    resetZoom: document.getElementById("reset-zoom"),
    mode2d: document.getElementById("mode-2d"),
    mode3d: document.getElementById("mode-3d"),
    modeMap: document.getElementById("mode-map"),
    stageMap: document.getElementById("stage-map"),
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
    boundaryPanel: document.getElementById("boundary-panel"),
    boundarySlider: document.getElementById("boundary-slider"),
    boundaryTicks: document.getElementById("boundary-ticks"),
    boundaryTime: document.getElementById("boundary-time"),
    boundarySub: document.getElementById("boundary-sub"),
    boundaryStart: document.getElementById("boundary-start"),
    boundaryEnd: document.getElementById("boundary-end"),
    boundaryHighlight: document.getElementById("boundary-highlight"),
    boundaryDiff: document.getElementById("boundary-diff"),
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
    // Forward so callers always hit the live setMode — the holographic
    // view monkey-patches this further down the file, and a direct ref
    // would point at the pre-patch version.
    set: (next) => setMode(next),
  };

  // Exposed so builder.js can read the live network and push edits back
  // through the same render pipeline (so it stays in sync with 3D, the
  // sidebar summary, brand detection, etc.).
  window.AwsApp = {
    getData: () => currentData,
    applyData: (data, opts) => applyVersionData(data, opts),
    detectCloud: (data) => detectCloud(data || currentData),
  };

  function loadData(data) {
    // Boundary (holographic) schema, or any holons-shaped payload that we
    // can wrap into one (e.g. data/sample-holons.json which only declares
    // "holons" + "holonics" at the top level).
    const wrapped = tryWrapAsBoundary(data);
    if (wrapped) {
      loadBoundary(wrapped);
      return;
    }

    // Multi-version network: { name, versions: [{ id, name, author, timestamp,
    // status, note, data: { vpcs, flows, ... } }, ...] }
    if (data && Array.isArray(data.versions) && data.versions.length) {
      exitBoundaryMode();
      currentVersions = data.versions;
      networkName = data.name || null;
      const latest = currentVersions[currentVersions.length - 1];
      currentVersionId = latest.id;
      renderTimeline();
      renderBoundaryPanel();
      els.timelinePanel.hidden = false;
      els.boundaryPanel.hidden = false;
      // Show the latest snapshot with persistent baseline-diff highlights
      // so the user immediately sees what's changed since the first state.
      applyVersionData(latest.data, { baselineDiff: computeBaselineDiff(latest.data) });
      updateBoundaryPanelForVersion(latest.id);
      fadeHint();
      return;
    }

    // Single-version network (the original schema): top-level vpcs/flows
    if (!data || !data.vpcs) {
      alert("That JSON doesn't look like a network topology — expected a top-level 'vpcs' array, a 'versions' array, or a holographic boundary.");
      return;
    }
    exitBoundaryMode();
    currentVersions = null;
    currentVersionId = null;
    networkName = data.name || null;
    els.timelinePanel.hidden = true;
    els.boundaryPanel.hidden = true;
    applyVersionData(data);
    fadeHint();
  }

  function applyVersionData(data, opts) {
    currentData = data;
    // When the user has enabled baseline-diff highlighting, attach a
    // pre-computed baseline layout so visualizer.js can position ghost
    // markers for elements that have been removed since the initial state.
    const enriched = opts ? { ...opts } : {};
    if (enriched.baselineDiff && currentVersions && currentVersions.length) {
      const baseline = currentVersions[0].data;
      if (baseline && window.AwsViz && AwsViz.layout) {
        enriched.baselineLayout = AwsViz.layout(baseline);
      }
    }
    AwsViz.render(data, enriched);
    if (window.AwsViz3D && window.AwsViz3D.isReady()) {
      window.AwsViz3D.render(data, opts);
    }
    if (window.AwsMap && window.AwsMap.isReady()) {
      window.AwsMap.render(data);
    }
    updateSummary(data);
    updateBrandFor(data);
  }

  // Compute the set of nodes (resources, gateways, subnets, vpcs) and flows
  // that were added or removed going from `oldData` to `newData`. Used by the
  // timeline so the diagram can animate what changed when a version is clicked.
  function diffVersionData(oldData, newData) {
    if (!oldData || !newData) return null;
    const collectIds = (d) => {
      const out = new Set();
      (d.vpcs || []).forEach((v) => {
        if (v.id) out.add(v.id);
        (v.subnets || []).forEach((s) => s.id && out.add(s.id));
        (v.resources || []).forEach((r) => r.id && out.add(r.id));
        (v.gateways || []).forEach((g) => g.id && out.add(g.id));
      });
      return out;
    };
    const oldIds = collectIds(oldData);
    const newIds = collectIds(newData);
    const addedNodes = [...newIds].filter((id) => !oldIds.has(id));
    const removedNodes = [...oldIds].filter((id) => !newIds.has(id));

    const flowKey = (f) => `${f.from}|${f.to}|${f.label || ""}`;
    const oldFlowKeys = new Set((oldData.flows || []).map(flowKey));
    const newFlowKeys = new Set((newData.flows || []).map(flowKey));
    const addedFlows = (newData.flows || []).filter((f) => !oldFlowKeys.has(flowKey(f)));
    const removedFlows = (oldData.flows || []).filter((f) => !newFlowKeys.has(flowKey(f)));

    return { addedNodes, removedNodes, addedFlows, removedFlows };
  }

  // Build the spoken narration for a version click. Broken versions explain
  // why things are failing; fixed versions explain how the issue was resolved.
  // Calls out which elements were added or removed compared to the previous
  // version so the listener can track the visual changes.
  function buildVersionNarration(ver, prevData, diff) {
    const status = ver.status || "ok";
    const lines = [];
    if (status === "broken") {
      lines.push("This version is broken.");
    } else if (status === "fixed") {
      lines.push("This version fixes the issue.");
    } else {
      lines.push(ver.name || `Version ${ver.id}.`);
    }

    if (diff) {
      const addedNames = (diff.addedNodes || []).map((id) => {
        const n = findNodeInData(ver.data, id);
        return n ? n.name || n.id : id;
      });
      const removedNames = (diff.removedNodes || []).map((id) => {
        const n = findNodeInData(prevData, id);
        return n ? n.name || n.id : id;
      });
      if (addedNames.length) lines.push(`Added ${joinList(addedNames)}.`);
      if (removedNames.length) lines.push(`Removed ${joinList(removedNames)}.`);
    }

    if (ver.note) lines.push(ver.note);
    return lines.join(" ");
  }

  function findNodeInData(data, id) {
    if (!data) return null;
    for (const v of data.vpcs || []) {
      if (v.id === id) return v;
      for (const s of v.subnets || []) if (s.id === id) return s;
      for (const r of v.resources || []) if (r.id === id) return r;
      for (const g of v.gateways || []) if (g.id === id) return g;
    }
    return null;
  }

  function joinList(items) {
    if (items.length <= 1) return items.join("");
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
  }

  // Inspect the loaded network's resource types and pick "AWS" or "Azure"
  // for the header / document title. Anything that uses majority Azure
  // type names (vm, sql, aks, vnet, nsg, frontdoor, appgw, …) flips the
  // brand to Azure. Mixed / AWS-typed data stays as AWS.
  const AZURE_TYPES = new Set([
    "vm", "vmss", "appservice", "function", "containerapp", "aks",
    "sql", "postgresql", "mysql", "cosmosdb", "redis",
    "blob", "vnet", "nsg", "appgw", "frontdoor", "azurewaf",
    "azurefirewall", "vpngw", "expressroute", "bastion", "azuredns",
    "apim", "privateendpoint", "publicip", "entra", "cdn",
  ]);
  function detectCloud(data) {
    let azure = 0, total = 0;
    (data.vpcs || []).forEach((vp) => {
      (vp.resources || []).forEach((r) => {
        total++;
        if (AZURE_TYPES.has(r.type)) azure++;
      });
      (vp.gateways || []).forEach((g) => {
        total++;
        if (AZURE_TYPES.has(g.type)) azure++;
      });
    });
    return total > 0 && azure / total >= 0.4 ? "azure" : "aws";
  }
  function updateBrandFor(data) {
    const cloud = detectCloud(data);
    const heading = document.querySelector(".brand h1");
    if (cloud === "azure") {
      if (heading) heading.textContent = "Azure Network Visualizer";
      document.title = "Azure Network Visualizer";
      document.body.classList.add("brand-azure");
    } else {
      if (heading) heading.textContent = "AWS Network Visualizer";
      document.title = "AWS Network Visualizer";
      document.body.classList.remove("brand-azure");
    }
  }

  function selectVersion(id, opts) {
    if (!currentVersions) return;
    const ver = currentVersions.find((v) => v.id === id);
    if (!ver) return;
    // Re-clicking the active version still re-narrates (intentional) but
    // there's no diff to show — pass the same data on both sides so the
    // diff comes out empty and only the voice plays.
    const prevData = currentData;
    const diff = diffVersionData(prevData, ver.data);
    currentVersionId = id;
    const renderOpts = { diff, status: ver.status || "ok" };
    if (els.boundaryHighlight && els.boundaryHighlight.checked) {
      renderOpts.baselineDiff = computeBaselineDiff(ver.data);
    }
    applyVersionData(ver.data, renderOpts);
    renderTimeline();
    updateBoundaryPanelForVersion(id);

    const silent = opts && opts.silent;
    if (!silent && window.AwsSpeak && window.AwsSpeak.enabled()) {
      const narration = buildVersionNarration(ver, prevData, diff);
      if (narration) window.AwsSpeak.speak(narration);
    }
  }

  // ---- Security system state panel (timestamp slider + baseline diff) ----

  function computeBaselineDiff(currentVersionData) {
    if (!currentVersions || !currentVersions.length) return null;
    const baseline = currentVersions[0].data;
    if (!baseline || baseline === currentVersionData) return null;
    return diffVersionData(baseline, currentVersionData);
  }

  function renderBoundaryPanel() {
    if (!currentVersions || !currentVersions.length) return;
    const max = currentVersions.length - 1;
    els.boundarySlider.min = 0;
    els.boundarySlider.max = String(max);
    els.boundarySlider.step = "1";
    els.boundarySlider.value = String(max);
    updateSliderFill(max, max);

    // Render evenly-spaced dots that line up with each snapshot.
    els.boundaryTicks.innerHTML = currentVersions
      .map((v, i) => {
        const pct = max === 0 ? 0 : (i / max) * 100;
        const status = v.status || "ok";
        return `<span class="tick status-${escapeHtml(status)}" data-i="${i}" style="left:${pct}%"
          title="${escapeHtml(v.name || v.id)} — ${escapeHtml(v.timestamp ? formatVersionDate(v.timestamp) : "")}"></span>`;
      })
      .join("");
    els.boundaryTicks.querySelectorAll(".tick").forEach((tickEl) => {
      tickEl.addEventListener("click", () => {
        const i = Number(tickEl.getAttribute("data-i"));
        const v = currentVersions[i];
        if (v) selectVersion(v.id, { silent: true });
      });
    });

    els.boundaryStart.textContent = currentVersions[0].timestamp
      ? formatVersionDate(currentVersions[0].timestamp) : "—";
    els.boundaryEnd.textContent = currentVersions[max].timestamp
      ? formatVersionDate(currentVersions[max].timestamp) : "—";
  }

  function updateSliderFill(idx, max) {
    const pct = max === 0 ? 100 : (idx / max) * 100;
    els.boundarySlider.style.setProperty("--boundary-fill", `${pct}%`);
  }

  function updateBoundaryPanelForVersion(id) {
    if (!currentVersions) return;
    const idx = currentVersions.findIndex((v) => v.id === id);
    if (idx < 0) return;
    const max = currentVersions.length - 1;
    const ver = currentVersions[idx];

    els.boundarySlider.value = String(idx);
    updateSliderFill(idx, max);
    els.boundaryTime.textContent = ver.timestamp ? formatVersionDate(ver.timestamp) : (ver.name || ver.id);

    const isBaseline = idx === 0;
    els.boundarySub.textContent = isBaseline
      ? "This is the first recorded state — drag the slider forward to see what's changed."
      : `Showing the boundary at ${ver.name || ver.id}. Green = added since initial, red = removed since initial.`;

    els.boundaryTicks.querySelectorAll(".tick").forEach((t, i) => {
      t.classList.toggle("is-active", i === idx);
    });

    renderBoundaryDiff(ver, isBaseline);
  }

  function renderBoundaryDiff(ver, isBaseline) {
    if (isBaseline) {
      els.boundaryDiff.innerHTML =
        `<div class="diff-empty">No changes — this is the baseline state.</div>`;
      return;
    }
    const diff = computeBaselineDiff(ver.data);
    if (!diff) {
      els.boundaryDiff.innerHTML = "";
      return;
    }
    const baselineData = currentVersions[0].data;
    const addedItems = diff.addedNodes.map((id) => describeNode(ver.data, id));
    const removedItems = diff.removedNodes.map((id) => describeNode(baselineData, id));
    const same = !addedItems.length && !removedItems.length;

    if (same) {
      els.boundaryDiff.innerHTML =
        `<div class="diff-empty">Same set of services as the initial state (flows may differ).</div>`;
      return;
    }

    const renderPills = (items, kind) => {
      if (!items.length) return "";
      return `
        <div class="diff-section">
          <div class="diff-eyebrow ${kind}">
            ${kind === "added" ? "+ Added since initial" : "− Removed since initial"}
            <span class="count">· ${items.length}</span>
          </div>
          <div class="diff-pills">
            ${items.map((it) => `
              <span class="pill ${kind}" title="${escapeHtml(it.id)}">
                <span class="pill-name">${escapeHtml(it.label)}</span>
                <span class="pill-type">${escapeHtml(it.type)}</span>
              </span>`).join("")}
          </div>
        </div>`;
    };

    els.boundaryDiff.innerHTML = renderPills(addedItems, "added") + renderPills(removedItems, "removed");
  }

  function describeNode(data, id) {
    const n = findNodeInData(data, id);
    if (!n) return { id, label: id, type: "node" };
    const type = (n.type || nodeKindFromData(data, id) || "node").toString();
    return { id, label: n.name || n.id, type };
  }

  // Walk the data once to figure out whether `id` is a vpc, subnet,
  // gateway, or resource — used when the node itself doesn't carry a
  // `type` (vpcs and subnets typically don't in this schema).
  function nodeKindFromData(data, id) {
    for (const v of data.vpcs || []) {
      if (v.id === id) return "vpc";
      for (const s of v.subnets || []) if (s.id === id) return s.tier ? `${s.tier} subnet` : "subnet";
    }
    return null;
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
    const is2d = mode === "2d", is3d = mode === "3d", isMap = mode === "map";
    document.body.classList.toggle("mode-3d", is3d);
    document.body.classList.toggle("mode-map", isMap);
    els.mode2d.classList.toggle("is-active", is2d);
    els.mode3d.classList.toggle("is-active", is3d);
    if (els.modeMap) els.modeMap.classList.toggle("is-active", isMap);
    els.mode2d.setAttribute("aria-pressed", is2d ? "true" : "false");
    els.mode3d.setAttribute("aria-pressed", is3d ? "true" : "false");
    if (els.modeMap) els.modeMap.setAttribute("aria-pressed", isMap ? "true" : "false");
    els.diagram.style.display = is2d ? "" : "none";
    els.stage3d.hidden = !is3d;
    if (els.stageMap) els.stageMap.hidden = !isMap;
    els.hint3d.hidden = !is3d;
    els.exploreBtn.hidden = !is3d;
    els.attackBtn.hidden = !is3d;
    if (!is3d) {
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

    if (isMap) {
      // Lazy-init the geographic map. MapLibre GL is loaded from a CDN and may
      // not be ready yet on a slow connection.
      const tryInitMap = (attempts = 25) => {
        if (window.AwsMap && window.maplibregl) {
          // Seed the theme before init() builds the map so the initial base
          // style matches; setTheme is a no-op (just records the value) until ready.
          if (window.AwsMap.setTheme) window.AwsMap.setTheme(theme);
          if (!window.AwsMap.isReady()) window.AwsMap.init(els.stageMap);
          window.AwsMap.resize();
          if (currentData) window.AwsMap.render(currentData);
          // Re-arm the zoom-to-drill hand-off and zoom back out, so returning
          // from the holographic view doesn't instantly re-trigger.
          if (window.AwsMap.armDrill) window.AwsMap.armDrill();
        } else if (attempts > 0) {
          setTimeout(() => tryInitMap(attempts - 1), 120);
        } else {
          alert("Map view couldn't load — MapLibre GL failed to load (you may be offline).");
          setMode("2d");
        }
      };
      tryInitMap();
    }
  }

  els.mode2d.addEventListener("click", () => setMode("2d"));
  els.mode3d.addEventListener("click", () => setMode("3d"));
  if (els.modeMap) els.modeMap.addEventListener("click", () => setMode("map"));

  // ---- Boundary slider + highlight toggle ----
  // The slider snaps to each snapshot index. Each scrub silently swaps the
  // active version (no voice narration) so users can drag-explore without
  // the synth babbling on every tick.
  els.boundarySlider.addEventListener("input", () => {
    if (!currentVersions) return;
    const idx = Math.max(0, Math.min(currentVersions.length - 1, Number(els.boundarySlider.value)));
    const ver = currentVersions[idx];
    if (!ver || ver.id === currentVersionId) {
      updateSliderFill(idx, currentVersions.length - 1);
      return;
    }
    selectVersion(ver.id, { silent: true });
  });
  els.boundaryHighlight.addEventListener("change", () => {
    if (!currentVersions || !currentVersionId) return;
    // Re-render the current version with or without baseline highlights.
    const ver = currentVersions.find((v) => v.id === currentVersionId);
    if (!ver) return;
    const renderOpts = {};
    if (els.boundaryHighlight.checked) {
      renderOpts.baselineDiff = computeBaselineDiff(ver.data);
    }
    applyVersionData(ver.data, renderOpts);
  });

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
    if (window.AwsMap && window.AwsMap.isReady()) {
      window.AwsMap.setTheme(theme);
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
  let _attackLastSpokenPhase = null;
  function attackSpeak(text) {
    if (window.AwsSpeak && window.AwsSpeak.enabled() && text) {
      window.AwsSpeak.speak(text);
    }
  }
  window.AwsAttack = {
    onStart(def) {
      els.attackHudIcon.textContent = def.icon || "!";
      els.attackHudName.textContent = def.name;
      els.attackHudPhase.textContent = "Starting…";
      _attackLastSpokenPhase = null;
      // Narrate the attack name once at start so the user knows what's
      // unfolding without having to read the HUD.
      attackSpeak(def.name + ".");
    },
    onTick(state) {
      if (!state) return;
      els.attackHudPhase.textContent = state.phaseLabel || "";
      els.attackProgressFill.style.right = `${100 - state.progress * 100}%`;
      setAttackStat(els.attackStatSpawned, state.stats.spawned);
      setAttackStat(els.attackStatBlocked, state.stats.blocked);
      setAttackStat(els.attackStatArrived, state.stats.arrived);
      renderAttackLog(state.events);
      // Speak each new phase label exactly once. Skip the first one if
      // the start-narration is still ringing — give the synth ~1.2s.
      if (state.phaseLabel && state.phaseLabel !== _attackLastSpokenPhase) {
        const first = _attackLastSpokenPhase === null;
        _attackLastSpokenPhase = state.phaseLabel;
        if (!first || state.elapsed > 1200) attackSpeak(state.phaseLabel + ".");
      }
    },
    onEnd(summary) {
      // Hide live HUD, show summary modal
      els.attackHud.hidden = true;
      renderAttackSummary(summary);
      els.attackSummary.hidden = false;
      // Narrate the outcome so the user gets the verdict without reading.
      attackSpeak(summary.outcome);
    },
    onStop() {
      els.attackHud.hidden = true;
      if (window.AwsSpeak && window.AwsSpeak.enabled()) window.AwsSpeak.stop();
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
  // V4: Add search-svc + cache + opensearch
  const V4 = {
    name: "Three-Tier Web App · v4", region: "us-east-1",
    vpcs: [{
      id: "vpc-prod", name: "Production", cidr: "10.0.0.0/16", region: "us-east-1",
      subnets: [...SHARED_SUBNETS_AB, ...SUBNETS_C],
      gateways: V3.vpcs[0].gateways,
      resources: [
        ...V3.vpcs[0].resources,
        { id: "search-svc", type: "ecs",   name: "Search Svc",  subnet: "prv-1a" },
        { id: "cache",      type: "redis", name: "Redis Cache", subnet: "prv-1b" },
        { id: "search-db",  type: "rds",   name: "OpenSearch",  subnet: "db-1a"  },
      ],
    }],
    flows: [
      ...V3.flows,
      { from: "app-a",      to: "cache",      label: "GET (cache)" },
      { from: "app-b",      to: "cache",      label: "GET (cache)" },
      { from: "app-c",      to: "cache",      label: "GET (cache)" },
      { from: "app-a",      to: "search-svc", label: "search" },
      { from: "search-svc", to: "search-db",  label: "index" },
      { from: "search-svc", to: "rds-w",      label: "scan" },
    ],
  };
  // V5: Retire `fn`, add CDN + API gateway
  const V5 = {
    name: "Three-Tier Web App · v5", region: "us-east-1",
    vpcs: [{
      id: "vpc-prod", name: "Production", cidr: "10.0.0.0/16", region: "us-east-1",
      subnets: V4.vpcs[0].subnets,
      gateways: V4.vpcs[0].gateways,
      resources: V4.vpcs[0].resources
        .filter((r) => r.id !== "fn")
        .concat([
          { id: "cdn",    type: "cloudfront", name: "Edge CDN",    subnet: "pub-1a" },
          { id: "api-gw", type: "apigw",      name: "Partner API", subnet: "pub-1b" },
        ]),
    }],
    flows: V4.flows
      .filter((f) => f.from !== "fn" && f.to !== "fn")
      .concat([
        { from: "internet", to: "cdn",    label: "HTTPS 443",      kind: "internet" },
        { from: "cdn",      to: "alb",    label: "HTTPS origin" },
        { from: "internet", to: "api-gw", label: "webhook POST",   kind: "internet" },
        { from: "api-gw",   to: "app-b",  label: "/ingest" },
      ]),
  };
  // V6: Add audit S3 + sessions DynamoDB, remove WAF
  const V6 = {
    name: "Three-Tier Web App · v6", region: "us-east-1",
    vpcs: [{
      id: "vpc-prod", name: "Production", cidr: "10.0.0.0/16", region: "us-east-1",
      subnets: V5.vpcs[0].subnets,
      gateways: V5.vpcs[0].gateways,
      resources: V5.vpcs[0].resources
        .filter((r) => r.id !== "waf")
        .concat([
          { id: "sessions", type: "dynamodb", name: "Session Store", subnet: "db-1b" },
          { id: "audit",    type: "s3",       name: "Audit Logs",    subnet: "db-1c" },
        ]),
    }],
    flows: V5.flows
      .filter((f) => f.from !== "waf" && f.to !== "waf")
      .concat([
        { from: "app-a", to: "sessions", label: "session R/W" },
        { from: "app-b", to: "sessions", label: "session R/W" },
        { from: "app-c", to: "sessions", label: "session R/W" },
        { from: "app-a", to: "audit",    label: "audit event" },
        { from: "app-b", to: "audit",    label: "audit event" },
        { from: "app-c", to: "audit",    label: "audit event" },
      ]),
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
      { id: "v4", name: "Add search + cache services", author: "carol@example.com",
        timestamp: "2025-03-12T11:20:00Z", status: "ok",
        note: "New product-search service backed by OpenSearch and a Redis cache. App tasks now hit the cache first and fall back to Aurora.",
        data: V4 },
      { id: "v5", name: "Retire webhook Lambda; add API gateway + CDN", author: "bob@example.com",
        timestamp: "2025-04-05T09:45:00Z", status: "ok",
        note: "Webhook Lambda decommissioned. Public traffic now lands on a CloudFront edge, and a separate API Gateway terminates partner-facing webhook ingest.",
        data: V5 },
      { id: "v6", name: "Audit storage + session store; WAF in maintenance", author: "carol@example.com",
        timestamp: "2025-05-01T16:10:00Z", status: "ok",
        note: "Added an S3 audit bucket for SOC2 evidence and a DynamoDB session store. WAF is temporarily out of the boundary while the rule set is being rewritten.",
        data: V6 },
    ],
  };

  // ============================================================
  //   Holographic (boundary) mode wiring
  // ============================================================

  let currentBoundary = null;
  // ZoomLevel — 0 = Holonic Control View, 1 = Holonic View, 2 = Holon Detail.
  let ZoomLevel = 0;
  let currentHolonicId = null;
  let currentHolonId = null;

  window.AwsHoloApp = {
    getLevel: () => ZoomLevel,
    getHolonicId: () => currentHolonicId,
    getHolonId: () => currentHolonId,
    getBoundary: () => currentBoundary,
    setLevel: (lvl, holonicId, holonId) => holoNavigate(lvl, holonicId, holonId),
  };

  /**
   * Try to normalise an arbitrary payload into a boundary object so the
   * holographic renderer can display it. Returns null when the data
   * doesn't look holographic at all.
   * @param {*} data
   * @returns {object|null}
   */
  function tryWrapAsBoundary(data) {
    if (!data || typeof data !== "object") return null;
    if (data.entityType === "boundary") return data;
    const hasHolons = Array.isArray(data.holons);
    const hasHolonics = Array.isArray(data.holonics);
    const hasLoose = Array.isArray(data.loose_holons);
    if (!hasHolons && !hasHolonics && !hasLoose) return null;
    return {
      id: data.id || "boundary-imported",
      entityType: "boundary",
      label: data.label || data.name || "Imported holons",
      environment: data.environment || "dev",
      role: data.role || "supplier",
      snapshotAt: data.snapshotAt || new Date().toISOString(),
      schemaVersion: data.schemaVersion || "1.0.0",
      holonics: data.holonics || [],
      loose_holons: data.loose_holons || data.holons || [],
      meta: data.meta || {},
    };
  }

  /**
   * Render a boundary (holographic) snapshot. Switches the stage from the
   * legacy AWS diagram to the holographic 2D/3D pipeline.
   * @param {object} data
   */
  function loadBoundary(data) {
    currentBoundary = data;
    currentData = null;
    currentVersions = null;
    currentVersionId = null;
    networkName = data.label || null;
    document.body.classList.add("mode-holographic");
    els.timelinePanel.hidden = true;
    els.boundaryPanel.hidden = true;
    if (els.holoBreadcrumb) els.holoBreadcrumb.hidden = false;
    if (els.holoWatermark) els.holoWatermark.hidden = false;
    if (els.holoStarfield) els.holoStarfield.hidden = false;
    if (els.asmFilterBar) els.asmFilterBar.hidden = false;
    if (els.holoViewHint) els.holoViewHint.hidden = false;
    if (window.AwsHoloViz) window.AwsHoloViz.reset();
    ZoomLevel = 0;
    currentHolonicId = null;
    currentHolonId = null;
    // Toggle the right stage so 2D ↔ 3D works regardless of prior mode.
    if (els.stage3d) els.stage3d.hidden = true;
    if (els.stageHolo) els.stageHolo.hidden = mode !== "3d";
    els.diagram.style.display = mode === "2d" ? "" : "none";
    if (mode === "2d") {
      window.AwsHoloViz.renderHolonicControlView(data);
    } else {
      ensureHolo3DReady().then(() => {
        if (window.AwsHoloViz3D) window.AwsHoloViz3D.renderHolonicControlView(data);
      });
    }
    updateBoundarySummary(data);
    updateBreadcrumb();
    fadeHint();
    document.title = `${data.label || "Holographic boundary"} — Visualizer`;
  }

  /**
   * Tear down boundary mode visuals when the user loads a legacy network.
   */
  function exitBoundaryMode() {
    currentBoundary = null;
    ZoomLevel = 0;
    currentHolonicId = null;
    currentHolonId = null;
    document.body.classList.remove("mode-holographic");
    if (els.holoBreadcrumb) els.holoBreadcrumb.hidden = true;
    if (els.holoWatermark) els.holoWatermark.hidden = true;
    if (els.holoStarfield) els.holoStarfield.hidden = true;
    if (els.holoDetail) els.holoDetail.hidden = true;
    if (els.asmFilterBar) els.asmFilterBar.hidden = true;
    if (els.holoViewHint) els.holoViewHint.hidden = true;
    document.body.classList.remove("holo-l0", "holo-l1", "holo-l2");
    // Hide the holographic 3D stage and restore the legacy stage(s) for
    // the current viewing mode, otherwise the boundary spheres linger on
    // top of the AWS view after the user clicks "Exit boundary".
    if (els.stageHolo) els.stageHolo.hidden = true;
    els.diagram.style.display = mode === "2d" ? "" : "none";
    if (els.stage3d) els.stage3d.hidden = mode !== "3d";
  }

  /**
   * Lazy-init the holographic 3D scene the first time the user enters it.
   * @returns {Promise<void>}
   */
  function ensureHolo3DReady() {
    return new Promise((resolve) => {
      const tryInit = (n = 30) => {
        if (window.AwsHoloViz3D) {
          if (!window.AwsHoloViz3D.isReady()) {
            window.AwsHoloViz3D.init(els.stageHolo);
          }
          resolve();
        } else if (n > 0) {
          setTimeout(() => tryInit(n - 1), 80);
        } else {
          resolve();
        }
      };
      tryInit();
    });
  }

  /**
   * Drive both the 2D and 3D holographic renderers to the requested level.
   * @param {0|1|2} lvl
   * @param {string|null} holonicId
   * @param {string|null} holonId
   */
  function holoNavigate(lvl, holonicId, holonId) {
    if (!currentBoundary) return;
    ZoomLevel = lvl;
    currentHolonicId = holonicId || null;
    currentHolonId = holonId || null;
    if (mode === "2d") {
      if (lvl === 0) window.AwsHoloViz.renderHolonicControlView(currentBoundary);
      else if (lvl === 1) window.AwsHoloViz.renderHolonicView(holonicId, currentBoundary);
      else window.AwsHoloViz.renderHolonDetailView(holonId, currentBoundary);
    } else if (window.AwsHoloViz3D && window.AwsHoloViz3D.isReady()) {
      if (lvl === 0) window.AwsHoloViz3D.renderHolonicControlView(currentBoundary);
      else if (lvl === 1) window.AwsHoloViz3D.renderHolonicView(holonicId, currentBoundary);
      else window.AwsHoloViz3D.renderHolonDetailView(holonId, currentBoundary);
    }
    if (lvl !== 2 && els.holoDetail) els.holoDetail.hidden = true;
    updateBreadcrumb();
  }

  /**
   * Refresh the boundary > holonic > holon breadcrumb to reflect the
   * current ZoomLevel.
   */
  function updateBreadcrumb() {
    if (!els.holoBreadcrumb || !currentBoundary) return;
    const sep2 = document.getElementById("holo-crumb-sep-2");
    const crumbHolonic = document.getElementById("holo-crumb-holonic");
    const crumbHolon = document.getElementById("holo-crumb-holon");
    const back = document.getElementById("holo-back");

    if (ZoomLevel >= 1 && currentHolonicId) {
      const hc = window.AwsHoloViz.findHolonic(currentHolonicId);
      crumbHolonic.textContent = (hc && hc.label) || currentHolonicId;
      crumbHolonic.hidden = false;
    } else {
      crumbHolonic.hidden = true;
    }
    if (ZoomLevel >= 2 && currentHolonId) {
      const h = window.AwsHoloViz.findHolon(currentHolonId);
      crumbHolon.textContent = (h && h.label) || currentHolonId;
      crumbHolon.hidden = false;
      sep2.hidden = false;
    } else {
      crumbHolon.hidden = true;
      sep2.hidden = true;
    }
    back.hidden = ZoomLevel === 0;

    // Body class drives the CSS background swap (starfield ↔ quantum tint).
    document.body.classList.remove("holo-l0", "holo-l1", "holo-l2");
    document.body.classList.add(`holo-l${ZoomLevel}`);

    if (els.holoViewHint) {
      const hints = {
        0: "<b>Holonic Control View</b> · each sphere is a holonic — click one to expand its holons",
        1: "<b>Holonic View</b> · holons orbiting their cluster — click one for full detail",
        2: "<b>Holon Detail</b> · see the panel on the right · Back returns to the cluster",
      };
      els.holoViewHint.innerHTML = hints[ZoomLevel] || "";
    }
  }

  /**
   * Update the sidebar summary so the user sees the boundary's identity.
   * @param {object} data
   */
  function updateBoundarySummary(data) {
    els.netName.textContent = data.label || "Holographic boundary";
    const passCount = (data.loose_holons || []).filter((h) => h.status === "pass").length;
    els.netMeta.textContent =
      `${(data.holonics || []).length} holonics · ${(data.loose_holons || []).length} holons · ` +
      `${passCount} pass · env=${data.environment || "—"} · role=${data.role || "—"}`;
    const heading = document.querySelector(".brand h1");
    if (heading) heading.textContent = "Holographic Assessment Visualizer";
  }

  // Render Level-2 detail panel.
  function renderHolonDetail(holon) {
    if (!els.holoDetail || !holon) return;
    els.holoDetail.hidden = false;
    document.getElementById("holo-detail-title").textContent = holon.label || holon.id;
    const hashShort = (holon.hash || "").slice(0, 12) + (holon.hash ? "…" : "");
    const refs = (holon.meta && holon.meta.references) || [];
    const chain = (holon.provenance && holon.provenance.chain) || [];
    const lockIcon = holon.immutable
      ? '<span class="holo-badge lock" title="Immutable evidence">🔒 immutable</span>'
      : '<span class="holo-badge warn" title="Source can still be re-written">⚠️ mutable</span>';
    const body = document.getElementById("holo-detail-body");
    body.innerHTML = `
      <dl class="holo-dl">
        ${ontologyRow(holon)}
        <dt>Assessment</dt><dd>${esc(holon.assessmentType)} · ${esc(holon.subtype)}</dd>
        <dt>Target</dt><dd>${esc(holon.target || "—")}</dd>
        <dt>Status</dt><dd><span class="status-pill status-${esc(holon.status)}">${esc(holon.status)}</span></dd>
        <dt>Severity</dt><dd><span class="sev-pill sev-${esc(holon.severity)}">${esc(holon.severity)}</span></dd>
        <dt>Score</dt><dd>${esc(String(Math.round(holon.score || 0)))}/100</dd>
        <dt>Timestamp</dt><dd>${esc(holon.timestamp || "—")}</dd>
        <dt>Hash</dt><dd>
          <code class="holo-hash" id="holo-hash">${esc(hashShort)}</code>
          ${lockIcon}
          <button class="btn ghost holo-mini" id="holo-copy-hash" type="button" data-hash="${esc(holon.hash || "")}">Copy Hash</button>
        </dd>
        <dt>Source</dt><dd>${esc(holon.source || "—")}</dd>
        <dt>Collected by</dt><dd>${esc(holon.provenance && holon.provenance.collectedBy || "—")}</dd>
        <dt>Verified at</dt><dd>${esc(holon.provenance && holon.provenance.verifiedAt || "unverified")}</dd>
        ${chain.length ? `<dt>Chain</dt><dd>${chain.map((c) => `<code>${esc(c)}</code>`).join(" → ")}</dd>` : ""}
      </dl>
      ${assemblySection(holon)}
      <div class="holo-desc">
        <h4>Description</h4>
        <p>${esc(holon.meta && holon.meta.description || "—")}</p>
      </div>
      ${holon.meta && holon.meta.remediation ? `<div class="holo-desc"><h4>Remediation</h4><p>${esc(holon.meta.remediation)}</p></div>` : ""}
      ${refs.length ? `<div class="holo-desc"><h4>References</h4><ul>${refs.map((u) => `<li><a target="_blank" rel="noopener" href="${esc(u)}">${esc(u)}</a></li>`).join("")}</ul></div>` : ""}
    `;
    const btn = document.getElementById("holo-copy-hash");
    if (btn) {
      btn.addEventListener("click", () => {
        const fullHash = btn.getAttribute("data-hash") || "";
        navigator.clipboard.writeText(fullHash).then(() => showHoloToast("Hash copied to clipboard"));
      });
    }
    body.querySelectorAll("[data-nav-entity]").forEach((el) => {
      el.addEventListener("click", () => navigateToEntity(el.getAttribute("data-nav-entity")));
    });
  }

  /**
   * Build the ontology row (entityClass + provider badge) for the detail panel.
   * @param {object} entity
   * @returns {string}
   */
  function ontologyRow(entity) {
    if (!entity.entityClass) return "";
    const r = window.OntologyRenderer;
    const badge = r ? r.getProviderBadge(entity.provider, entity.providerType) : entity.provider;
    const icon = r ? r.getRenderProps(entity.entityClass).icon : "◯";
    return `<dt>Class</dt><dd>${esc(icon)} ${esc(entity.entityClass)} <span class="ont-cat">${esc(entity.entityCategory || "")}</span></dd>
      <dt>Provider</dt><dd><span class="ont-provider-chip prov-${esc(entity.provider || "agnostic")}">${esc(badge)}</span></dd>`;
  }

  /**
   * Build the ASSEMBLY section: level badge, context, clickable children,
   * and a clickable parent link.
   * @param {object} entity
   * @returns {string}
   */
  function assemblySection(entity) {
    if (entity.assemblyLevel == null) return "";
    const a = window.OntologyAssembly;
    const label = a ? a.getAssemblyLabel(entity.assemblyLevel) : `Level ${entity.assemblyLevel}`;
    const icon = ["⬥", "◈", "◉", "⬡", "⊕"][entity.assemblyLevel] || "⬥";
    const kids = entity.atomicChildren || [];
    const childLinks = kids.length
      ? kids.map((id) => `<button class="asm-link" data-nav-entity="${esc(id)}">${esc(entityLabel(id))}</button>`).join(" ")
      : '<span class="muted small">none (atomic)</span>';
    const parent = entity.assembledInto
      ? `<button class="asm-link" data-nav-entity="${esc(entity.assembledInto)}">${esc(entityLabel(entity.assembledInto))}</button>`
      : '<span class="muted small">none (top level)</span>';
    return `
      <div class="holo-desc asm-section">
        <h4>Assembly</h4>
        <dl class="holo-dl">
          <dt>Level</dt><dd><span class="asm-badge-pill asm-${entity.assemblyLevel}">${icon} ${entity.assemblyLevel}</span> ${esc(label)}</dd>
          <dt>Context</dt><dd>${esc(entity.assemblyContext || "—")}</dd>
          <dt>Children</dt><dd class="asm-link-list">${childLinks}</dd>
          <dt>Part of</dt><dd>${parent}</dd>
        </dl>
      </div>`;
  }

  /**
   * Resolve an entity id to a display label from the active boundary.
   * @param {string} id
   * @returns {string}
   */
  function entityLabel(id) {
    if (!currentBoundary || !window.AwsHoloViz) return id;
    const all = window.AwsHoloViz.allEntities ? window.AwsHoloViz.allEntities() : [];
    const e = all.find((x) => x.id === id);
    return (e && e.label) || id;
  }

  /**
   * Navigate the visualizer to a given entity id, choosing the right zoom
   * level based on whether it is a holonic or a holon.
   * @param {string} id
   */
  function navigateToEntity(id) {
    if (!currentBoundary) return;
    const hc = (currentBoundary.holonics || []).find((x) => x.id === id);
    if (hc) { holoNavigate(1, id, null); return; }
    const holon = (currentBoundary.loose_holons || []).find((x) => x.id === id);
    if (holon) {
      const owning = (currentBoundary.holonics || []).find((x) => (x.holons || []).includes(id));
      holoNavigate(2, owning ? owning.id : currentHolonicId, id);
    } else {
      showHoloToast(`${entityLabel(id)} is an assembly node (not directly rendered).`);
    }
  }

  /**
   * Show a transient toast notification.
   * @param {string} msg
   */
  function showHoloToast(msg) {
    if (!els.holoToast) return;
    els.holoToast.textContent = msg;
    els.holoToast.hidden = false;
    clearTimeout(els.holoToast._t);
    els.holoToast._t = setTimeout(() => { els.holoToast.hidden = true; }, 2200);
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Cache DOM refs for the new boundary UI.
  els.holoBreadcrumb = document.getElementById("holo-breadcrumb");
  els.holoWatermark = document.getElementById("holo-watermark");
  els.holoStarfield = document.getElementById("holo-starfield");
  els.holoDetail = document.getElementById("holo-detail");
  els.holoToast = document.getElementById("holo-toast");
  els.stageHolo = document.getElementById("stage-holo");
  els.catalogSidebar = document.getElementById("catalog-sidebar");
  els.sidebarToggle = document.getElementById("sidebar-toggle");
  els.loadBoundary = document.getElementById("load-boundary");
  els.asmFilterBar = document.getElementById("asm-filter-bar");
  els.holoViewHint = document.getElementById("holo-view-hint");

  // Assembly-level filter toolbar (multi-select pills).
  const asmSelected = new Set();
  if (els.asmFilterBar) {
    els.asmFilterBar.addEventListener("click", (e) => {
      const pill = e.target.closest(".asm-pill");
      if (!pill) return;
      const v = pill.getAttribute("data-asm");
      if (v === "all") {
        asmSelected.clear();
        els.asmFilterBar.querySelectorAll(".asm-pill").forEach((p) => p.classList.remove("is-active"));
        pill.classList.add("is-active");
      } else {
        const lvl = Number(v);
        if (asmSelected.has(lvl)) asmSelected.delete(lvl);
        else asmSelected.add(lvl);
        pill.classList.toggle("is-active", asmSelected.has(lvl));
        const allPill = els.asmFilterBar.querySelector('[data-asm="all"]');
        if (allPill) allPill.classList.toggle("is-active", asmSelected.size === 0);
      }
      applyAssemblyFilterBothViews(asmSelected.size ? asmSelected : null);
    });
  }

  /**
   * Apply the assembly-level filter to whichever view is active (the 2D
   * SVG nodes and/or the 3D holographic meshes).
   * @param {Set<number>|null} sel
   */
  function applyAssemblyFilterBothViews(sel) {
    if (window.AwsHoloViz && window.AwsHoloViz.applyAssemblyFilter) {
      window.AwsHoloViz.applyAssemblyFilter(sel);
    }
    if (window.AwsHoloViz3D && window.AwsHoloViz3D.isReady() && window.AwsHoloViz3D.applyAssemblyFilter) {
      window.AwsHoloViz3D.applyAssemblyFilter(sel);
    }
  }

  // Wire up breadcrumb navigation.
  if (els.holoBreadcrumb) {
    els.holoBreadcrumb.addEventListener("click", (e) => {
      const t = e.target.closest("[data-level]");
      if (!t) return;
      const lvl = Number(t.getAttribute("data-level"));
      if (lvl === 0) holoNavigate(0, null, null);
      else if (lvl === 1 && currentHolonicId) holoNavigate(1, currentHolonicId, null);
      else if (lvl === 2 && currentHolonId) holoNavigate(2, currentHolonicId, currentHolonId);
    });
    const back = document.getElementById("holo-back");
    if (back) back.addEventListener("click", () => {
      if (ZoomLevel === 2) holoNavigate(1, currentHolonicId, null);
      else if (ZoomLevel === 1) holoNavigate(0, null, null);
    });
    const exit = document.getElementById("holo-exit");
    if (exit) exit.addEventListener("click", async () => {
      exitBoundaryMode();
      try {
        const res = await fetch("sample-network.json");
        if (res.ok) { loadData(await res.json()); return; }
      } catch (_) { /* offline / file:// */ }
      if (typeof EMBEDDED_SAMPLE !== "undefined") loadData(EMBEDDED_SAMPLE);
      showHoloToast("Returned to network view");
    });
  }
  if (els.holoDetail) {
    const close = document.getElementById("holo-detail-close");
    if (close) close.addEventListener("click", () => { els.holoDetail.hidden = true; });
  }

  // Catalog sidebar toggle.
  if (els.sidebarToggle && els.catalogSidebar) {
    els.sidebarToggle.addEventListener("click", () => {
      els.catalogSidebar.hidden = !els.catalogSidebar.hidden;
      document.body.classList.toggle("sidebar-open", !els.catalogSidebar.hidden);
    });
    const closeBtn = document.getElementById("catalog-close");
    if (closeBtn) closeBtn.addEventListener("click", () => {
      els.catalogSidebar.hidden = true;
      document.body.classList.remove("sidebar-open");
    });
  }

  // Load boundary button — fetches the sample boundary JSON.
  if (els.loadBoundary) {
    els.loadBoundary.addEventListener("click", async () => {
      try {
        const res = await fetch("data/sample-boundary.json");
        const data = await res.json();
        loadData(data);
      } catch (err) {
        alert("Could not load sample boundary: " + err.message);
      }
    });
  }

  // Hook holographic renderer events into the app shell.
  if (window.AwsHoloViz) {
    window.AwsHoloViz.onLevelChange = (lvl, holonicId, holonId) => {
      ZoomLevel = lvl;
      currentHolonicId = holonicId;
      currentHolonId = holonId;
      updateBreadcrumb();
      if (lvl !== 2 && els.holoDetail) els.holoDetail.hidden = true;
      // Mirror in 3D if active.
      if (mode === "3d" && window.AwsHoloViz3D && window.AwsHoloViz3D.isReady()) {
        if (lvl === 0) window.AwsHoloViz3D.renderHolonicControlView(currentBoundary);
        else if (lvl === 1) window.AwsHoloViz3D.renderHolonicView(holonicId, currentBoundary);
        else window.AwsHoloViz3D.renderHolonDetailView(holonId, currentBoundary);
      }
    };
    window.AwsHoloViz.onSelectHolon = (holon) => {
      currentHolonId = holon.id;
      renderHolonDetail(holon);
      updateBreadcrumb();
    };
  }
  // The 3D module loads asynchronously; poll briefly until it's there.
  (function bindHolo3DEvents(retries) {
    if (window.AwsHoloViz3D) {
      window.AwsHoloViz3D.onLevelChange = (lvl, holonicId, holonId) => {
        ZoomLevel = lvl;
        currentHolonicId = holonicId;
        currentHolonId = holonId;
        updateBreadcrumb();
        if (lvl !== 2 && els.holoDetail) els.holoDetail.hidden = true;
        if (mode === "2d" && window.AwsHoloViz) {
          if (lvl === 0) window.AwsHoloViz.renderHolonicControlView(currentBoundary);
          else if (lvl === 1) window.AwsHoloViz.renderHolonicView(holonicId, currentBoundary);
          else window.AwsHoloViz.renderHolonDetailView(holonId, currentBoundary);
        }
      };
      window.AwsHoloViz3D.onSelectHolon = (holon) => {
        currentHolonId = holon.id;
        renderHolonDetail(holon);
        updateBreadcrumb();
      };
    } else if (retries > 0) {
      setTimeout(() => bindHolo3DEvents(retries - 1), 100);
    }
  })(30);

  // Patch setMode so it also routes holographic data correctly between stages.
  const _origSetMode = setMode;
  setMode = function (next) {
    _origSetMode(next);
    // Show / hide holographic stages alongside the legacy stage-3d toggling.
    if (els.stageHolo) {
      const showHolo = currentBoundary && next === "3d";
      els.stageHolo.hidden = !showHolo;
      // The legacy AWS 3D city is for legacy AWS data only.
      if (currentBoundary) els.stage3d.hidden = true;
    }
    if (currentBoundary) {
      els.diagram.style.display = next === "2d" ? "" : "none";
      if (next === "3d") {
        ensureHolo3DReady().then(() => {
          if (ZoomLevel === 0) window.AwsHoloViz3D.renderHolonicControlView(currentBoundary);
          else if (ZoomLevel === 1) window.AwsHoloViz3D.renderHolonicView(currentHolonicId, currentBoundary);
          else window.AwsHoloViz3D.renderHolonDetailView(currentHolonId, currentBoundary);
        });
      } else if (next === "2d") {
        if (ZoomLevel === 0) window.AwsHoloViz.renderHolonicControlView(currentBoundary);
        else if (ZoomLevel === 1) window.AwsHoloViz.renderHolonicView(currentHolonicId, currentBoundary);
        else window.AwsHoloViz.renderHolonDetailView(currentHolonId, currentBoundary);
      }
    }
  };

  // Catalog: wire up the catalog renderer once both this script and
  // catalog.js have loaded.
  if (window.AwsCatalog) {
    window.AwsCatalog.mount({
      onLoad: (data) => loadData(data),
      onToast: showHoloToast,
    });
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      if (window.AwsCatalog) {
        window.AwsCatalog.mount({
          onLoad: (data) => loadData(data),
          onToast: showHoloToast,
        });
      }
    });
  }

  // Wizard → Visualizer handoff. When the user clicks "Load into Visualizer"
  // in the wizard, the generated JSON is parked in sessionStorage; on the
  // next page load we pick it up and route it through loadData.
  function consumeWizardHandoff() {
    try {
      const raw = sessionStorage.getItem("holo-wizard-pending");
      if (!raw) return false;
      sessionStorage.removeItem("holo-wizard-pending");
      const data = JSON.parse(raw);
      loadData(data);
      showHoloToast("Loaded wizard integration.");
      return true;
    } catch (_) {
      return false;
    }
  }

  // Auto-load the sample on first paint so the page never starts empty.
  window.addEventListener("DOMContentLoaded", async () => {
    if (consumeWizardHandoff()) return;
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
