// Builder mode: a draggable inventory of cloud services (AWS or Azure
// depending on the loaded network) plus a "simulation" pass that wires
// dropped resources into the existing topology and animates the new flows.
//
// Hooks into AwsApp (getData / applyData / detectCloud) and AwsViz (layout)
// from app.js + visualizer.js — keeps all rendering inside the existing
// pipeline so 3D, sidebar summary, brand detection and version-diff
// highlights all light up automatically when a node is added.

(function () {
  const els = {
    btn: document.getElementById("builder-btn"),
    drawer: document.getElementById("builder-drawer"),
    closeBtn: document.getElementById("builder-close"),
    resetBtn: document.getElementById("builder-reset"),
    undoBtn: document.getElementById("builder-undo"),
    inventory: document.getElementById("builder-inventory"),
    sub: document.getElementById("builder-sub"),
    eyebrow: document.getElementById("builder-eyebrow"),
    stage: document.getElementById("stage"),
    diagram: document.getElementById("diagram"),
    simHud: document.getElementById("sim-hud"),
    simIcon: document.getElementById("sim-hud-icon"),
    simName: document.getElementById("sim-hud-name"),
    simWhere: document.getElementById("sim-hud-where"),
    simFlows: document.getElementById("sim-hud-flows"),
    simClose: document.getElementById("sim-hud-close"),
  };

  // Inventory catalogs. allowedTiers controls which subnets light up as
  // valid drop targets during drag. `kind` distinguishes resources (the
  // default) from gateways (NAT specifically — IGWs live above the VPC).
  const AWS_INVENTORY = [
    { category: "Compute", items: [
      { type: "ec2",    label: "EC2",       allowedTiers: ["public","private"] },
      { type: "asg",    label: "Auto Scaling", allowedTiers: ["private"] },
      { type: "ecs",    label: "ECS / Fargate", allowedTiers: ["private"] },
      { type: "eks",    label: "EKS",       allowedTiers: ["private"] },
      { type: "lambda", label: "Lambda",    allowedTiers: ["private"] },
    ]},
    { category: "Database", items: [
      { type: "rds",      label: "RDS",      allowedTiers: ["data"] },
      { type: "aurora",   label: "Aurora",   allowedTiers: ["data"] },
      { type: "dynamodb", label: "DynamoDB", allowedTiers: ["data","private"] },
    ]},
    { category: "Networking", items: [
      { type: "alb",        label: "ALB",         allowedTiers: ["public"] },
      { type: "nlb",        label: "NLB",         allowedTiers: ["public"] },
      { type: "nat",        label: "NAT GW",      allowedTiers: ["public"], kind: "gateway" },
      { type: "endpoint",   label: "VPC Endpoint",allowedTiers: ["private","data"] },
      { type: "cloudfront", label: "CloudFront",  allowedTiers: ["public"] },
      { type: "apigw",      label: "API Gateway", allowedTiers: ["public"] },
      { type: "route53",    label: "Route 53",    allowedTiers: ["public","private"] },
    ]},
    { category: "Security", items: [
      { type: "waf", label: "WAF", allowedTiers: ["public"] },
    ]},
    { category: "Storage", items: [
      { type: "s3", label: "S3", allowedTiers: ["private","data"] },
    ]},
  ];

  const AZURE_INVENTORY = [
    { category: "Compute", items: [
      { type: "vm",           label: "VM",           allowedTiers: ["public","private"] },
      { type: "vmss",         label: "VM Scale Set", allowedTiers: ["private"] },
      { type: "appservice",   label: "App Service",  allowedTiers: ["private","public"] },
      { type: "function",     label: "Functions",    allowedTiers: ["private"] },
      { type: "containerapp", label: "Container App",allowedTiers: ["private"] },
      { type: "aks",          label: "AKS",          allowedTiers: ["private"] },
    ]},
    { category: "Database", items: [
      { type: "sql",        label: "Azure SQL",    allowedTiers: ["data"] },
      { type: "postgresql", label: "PostgreSQL",   allowedTiers: ["data"] },
      { type: "mysql",      label: "MySQL",        allowedTiers: ["data"] },
      { type: "cosmosdb",   label: "Cosmos DB",    allowedTiers: ["data","private"] },
      { type: "redis",      label: "Redis Cache",  allowedTiers: ["data","private"] },
    ]},
    { category: "Networking", items: [
      { type: "appgw",           label: "App Gateway",      allowedTiers: ["public"] },
      { type: "frontdoor",       label: "Front Door",       allowedTiers: ["public"] },
      { type: "vpngw",           label: "VPN Gateway",      allowedTiers: ["public"], kind: "gateway" },
      { type: "expressroute",    label: "ExpressRoute",     allowedTiers: ["public"], kind: "gateway" },
      { type: "bastion",         label: "Bastion",          allowedTiers: ["public"] },
      { type: "privateendpoint", label: "Private Endpoint", allowedTiers: ["private","data"] },
      { type: "azuredns",        label: "Azure DNS",        allowedTiers: ["public","private"] },
      { type: "cdn",             label: "CDN",              allowedTiers: ["public"] },
    ]},
    { category: "Security", items: [
      { type: "nsg",           label: "NSG",            allowedTiers: ["public","private","data"] },
      { type: "azurewaf",      label: "Azure WAF",      allowedTiers: ["public"] },
      { type: "azurefirewall", label: "Azure Firewall", allowedTiers: ["public"] },
    ]},
    { category: "Integration", items: [
      { type: "apim", label: "API Management", allowedTiers: ["public"] },
    ]},
    { category: "Storage", items: [
      { type: "blob", label: "Blob Storage", allowedTiers: ["private","data"] },
    ]},
  ];

  const COMPUTE_TYPES = new Set([
    "ec2","asg","ecs","eks","lambda",
    "vm","vmss","appservice","function","containerapp","aks",
  ]);
  const DB_TYPES = new Set([
    "rds","aurora","dynamodb",
    "sql","postgresql","mysql","cosmosdb",
  ]);
  const CACHE_TYPES = new Set(["redis"]);
  const LB_TYPES = new Set(["alb","nlb","appgw"]);
  const CDN_TYPES = new Set(["cloudfront","frontdoor","cdn"]);
  const WAF_TYPES = new Set(["waf","azurewaf","azurefirewall"]);
  const APIGW_TYPES = new Set(["apigw","apim"]);
  const STORAGE_TYPES = new Set(["s3","blob"]);

  // Per-DB type, the canonical wire-protocol port that shows up on the flow
  // label so the rendered diagram reads like a real architecture diagram.
  const DB_PORT = {
    rds: "5432", aurora: "5432", dynamodb: "HTTPS",
    sql: "1433", postgresql: "5432", mysql: "3306", cosmosdb: "HTTPS",
    redis: "6379",
  };

  // Snapshot of the network when builder mode is opened, so Reset can
  // undo every addition the user made in one go. Stored by deep clone so
  // later mutations to currentData don't poison this baseline.
  let baselineData = null;
  // Stack of additions so Undo peels off one drop at a time.
  let undoStack = [];
  let counter = 1;
  let isOpen = false;

  // -------------------------------------------------------------------
  // Inventory rendering
  // -------------------------------------------------------------------

  function pickInventory(data) {
    const cloud = window.AwsApp && data ? window.AwsApp.detectCloud(data) : "aws";
    return cloud === "azure"
      ? { items: AZURE_INVENTORY, cloud: "azure" }
      : { items: AWS_INVENTORY, cloud: "aws" };
  }

  function renderInventory() {
    const data = window.AwsApp && window.AwsApp.getData();
    if (!data) {
      els.inventory.innerHTML =
        `<div class="muted" style="padding:8px 4px;font-size:12px;">
           Load a network first, then come back to drag in services.
         </div>`;
      return;
    }
    const { items, cloud } = pickInventory(data);
    els.eyebrow.textContent = cloud === "azure" ? "Azure inventory" : "AWS inventory";

    els.inventory.innerHTML = items
      .map((section) => `
        <div class="inv-section">
          <div class="inv-section-title">${escapeHtml(section.category)}</div>
          <div class="inv-grid">
            ${section.items
              .map((item) => {
                const meta = (window.AWS_EXPLAIN && window.AWS_EXPLAIN[item.type]) || {};
                const colors = (window.AWS_COLORS && window.AWS_COLORS[item.type]) || window.AWS_COLORS.unknown;
                const glyph = meta.glyph || item.type.toUpperCase().slice(0, 3);
                return `
                  <button class="inv-tile" type="button" draggable="true"
                          data-type="${escapeHtml(item.type)}"
                          data-kind="${escapeHtml(item.kind || "resource")}"
                          data-tiers="${escapeHtml((item.allowedTiers || []).join(","))}"
                          title="${escapeHtml(meta.title || item.label)}">
                    <span class="inv-tile-icon" style="background:linear-gradient(135deg, ${colors.a}, ${colors.b})">${escapeHtml(glyph)}</span>
                    <span class="inv-tile-label">${escapeHtml(item.label)}</span>
                  </button>`;
              })
              .join("")}
          </div>
        </div>
      `)
      .join("");

    bindDragSources();
  }

  // -------------------------------------------------------------------
  // Drag / drop
  // -------------------------------------------------------------------

  let dragSpec = null; // { type, kind, allowedTiers }
  let lastHoverSubnet = null;
  let dropToast = null;

  function bindDragSources() {
    els.inventory.querySelectorAll(".inv-tile").forEach((tile) => {
      tile.addEventListener("dragstart", (e) => {
        const allowedTiers = (tile.getAttribute("data-tiers") || "")
          .split(",")
          .filter(Boolean);
        dragSpec = {
          type: tile.getAttribute("data-type"),
          kind: tile.getAttribute("data-kind") || "resource",
          allowedTiers,
        };
        // Setting some data is required to make Firefox fire dragover/drop
        // on the destination. The actual payload is read from dragSpec —
        // dataTransfer is unreliable across iframes/SVG in some browsers.
        try {
          e.dataTransfer.setData("application/x-aws-builder", JSON.stringify(dragSpec));
          e.dataTransfer.effectAllowed = "copy";
        } catch (_) { /* ignore */ }
        document.body.classList.add("builder-dragging");
        markDropTargets(allowedTiers);
        showDropToast(`Drop on a ${allowedTiers.join(" or ")} subnet to add ${dragSpec.type.toUpperCase()}`);
      });
      tile.addEventListener("dragend", () => {
        cleanupDragState();
      });
    });
  }

  function cleanupDragState() {
    document.body.classList.remove("builder-dragging");
    document.querySelectorAll(".subnet.drop-eligible, .subnet.drop-active, .subnet.drop-ineligible")
      .forEach((el) => el.classList.remove("drop-eligible", "drop-active", "drop-ineligible"));
    hideDropToast();
    lastHoverSubnet = null;
    dragSpec = null;
  }

  function markDropTargets(allowedTiers) {
    const allowed = new Set(allowedTiers);
    document.querySelectorAll("#diagram .subnet").forEach((el) => {
      const tier = el.getAttribute("data-tier") || "private";
      if (allowed.has(tier)) el.classList.add("drop-eligible");
      else el.classList.add("drop-ineligible");
    });
  }

  function showDropToast(text, cls) {
    if (!dropToast) {
      dropToast = document.createElement("div");
      dropToast.className = "builder-drop-toast";
      els.stage.appendChild(dropToast);
    }
    dropToast.textContent = text;
    dropToast.classList.toggle("warn", cls === "warn");
    dropToast.style.display = "";
  }
  function hideDropToast() {
    if (dropToast) dropToast.style.display = "none";
  }

  // Walk up from the topmost element under the cursor to find a subnet
  // group (each subnet rect is tagged with data-type="subnet"). Works
  // across d3-zoom transforms because elementFromPoint operates on the
  // rendered DOM coordinates.
  function findSubnetUnderPoint(x, y) {
    const stack = document.elementsFromPoint(x, y);
    for (const el of stack) {
      if (el && el.getAttribute && el.getAttribute("data-type") === "subnet") {
        return {
          id: el.getAttribute("data-id"),
          tier: el.getAttribute("data-tier") || "private",
          el,
        };
      }
      // SVG <rect> sits inside a <g> that also carries data-type.
      const parent = el && el.closest && el.closest('[data-type="subnet"]');
      if (parent) {
        return {
          id: parent.getAttribute("data-id"),
          tier: parent.getAttribute("data-tier") || "private",
          el: parent,
        };
      }
    }
    return null;
  }

  function handleStageDragOver(e) {
    if (!dragSpec) return; // not our drag — let the JSON-file dropzone handle it
    e.preventDefault();
    e.stopPropagation();
    try { e.dataTransfer.dropEffect = "copy"; } catch (_) {}
    const target = findSubnetUnderPoint(e.clientX, e.clientY);
    if (lastHoverSubnet && (!target || target.id !== lastHoverSubnet.id)) {
      lastHoverSubnet.el.classList.remove("drop-active");
      lastHoverSubnet = null;
    }
    if (target && dragSpec.allowedTiers.includes(target.tier)) {
      target.el.classList.add("drop-active");
      lastHoverSubnet = target;
      showDropToast(`Drop into ${target.el.getAttribute("data-id")} (${target.tier})`);
    } else if (target) {
      showDropToast(
        `${dragSpec.type.toUpperCase()} only belongs in: ${dragSpec.allowedTiers.join(", ")}`,
        "warn",
      );
    } else {
      showDropToast(`Drop on a ${dragSpec.allowedTiers.join(" or ")} subnet`);
    }
  }

  function handleStageDrop(e) {
    if (!dragSpec) return; // JSON file drop — leave it to app.js
    e.preventDefault();
    e.stopPropagation();
    const target = findSubnetUnderPoint(e.clientX, e.clientY);
    const spec = dragSpec;
    if (!target) {
      flashToast("Drop on a subnet to place the service.", "warn");
      cleanupDragState();
      return;
    }
    if (!spec.allowedTiers.includes(target.tier)) {
      flashToast(`${spec.type.toUpperCase()} can't live in a ${target.tier} subnet.`, "warn");
      cleanupDragState();
      return;
    }
    addService(spec, target);
    cleanupDragState();
  }

  function flashToast(text, kind) {
    showDropToast(text, kind);
    setTimeout(hideDropToast, 1800);
  }

  // -------------------------------------------------------------------
  // Add + simulate
  // -------------------------------------------------------------------

  function addService(spec, target) {
    const data = window.AwsApp.getData();
    if (!data) return;

    // Deep-clone via JSON so we never mutate the snapshot referenced by
    // version history (the timeline panel shows version data by reference).
    const next = JSON.parse(JSON.stringify(data));
    const vpc = findVpcForSubnet(next, target.id);
    if (!vpc) {
      flashToast("Couldn't resolve VPC for that subnet.", "warn");
      return;
    }

    const id = generateId(next, spec.type);
    const node = {
      id,
      type: spec.type,
      name: buildFriendlyName(spec.type),
      subnet: target.id,
    };

    if (spec.kind === "gateway" && spec.type === "nat") {
      vpc.gateways = vpc.gateways || [];
      vpc.gateways.push(node);
    } else {
      vpc.resources = vpc.resources || [];
      vpc.resources.push(node);
    }

    // Infer plausible flows before we add the node so the inference sees
    // the previous state of the topology (avoids matching the new node
    // against itself).
    const newFlows = inferFlowsForNew(node, data, target.tier);
    next.flows = (next.flows || []).concat(newFlows);

    undoStack.push({ nodeId: id, kind: spec.kind, vpcId: vpc.id, flows: newFlows });

    window.AwsApp.applyData(next, {
      diff: {
        addedNodes: [id],
        removedNodes: [],
        addedFlows: newFlows,
        removedFlows: [],
      },
    });

    // After re-render we still know the spec, so push a sim HUD that
    // explains what just happened in plain English.
    renderSimHud(node, newFlows, target);
    speak(buildNarration(node, newFlows, target));
  }

  function inferFlowsForNew(newNode, data, tier) {
    // Constrain to the VPC the node was dropped into — cross-VPC flows
    // are unusual without a TGW/peering and would clutter the diagram.
    const vpc = findVpcForSubnet(data, newNode.subnet) || { resources: [], gateways: [] };
    const allResources = vpc.resources || [];
    const allGateways = vpc.gateways || [];
    const flows = [];
    const type = newNode.type;

    const computeNodes = allResources.filter((r) => COMPUTE_TYPES.has(r.type));
    const dbNodes = allResources.filter((r) => DB_TYPES.has(r.type));
    const cacheNodes = allResources.filter((r) => CACHE_TYPES.has(r.type));
    const lbNodes = allResources.filter((r) => LB_TYPES.has(r.type));
    const cdnNodes = allResources.filter((r) => CDN_TYPES.has(r.type));
    const wafNodes = allResources.filter((r) => WAF_TYPES.has(r.type));
    const apigwNodes = allResources.filter((r) => APIGW_TYPES.has(r.type));
    const igw = allGateways.find((g) => g.type === "igw");
    const sameAzNat = (subnetId) => {
      const az = subnetAz(data, subnetId);
      return allGateways.find((g) => g.type === "nat" && subnetAz(data, g.subnet) === az)
        || allGateways.find((g) => g.type === "nat"); // fall back to any NAT
    };

    if (LB_TYPES.has(type)) {
      flows.push({ from: "internet", to: newNode.id, label: "HTTPS 443", kind: "internet" });
      computeNodes.slice(0, 3).forEach((c) => {
        flows.push({ from: newNode.id, to: c.id, label: "HTTP" });
      });
    }

    if (CDN_TYPES.has(type)) {
      flows.push({ from: "internet", to: newNode.id, label: "HTTPS edge", kind: "internet" });
      const origin = lbNodes[0] || computeNodes.find((c) => c.type === "appservice") || computeNodes[0];
      if (origin) flows.push({ from: newNode.id, to: origin.id, label: "origin" });
    }

    if (APIGW_TYPES.has(type)) {
      flows.push({ from: "internet", to: newNode.id, label: "API call", kind: "internet" });
      const backend = computeNodes.find((c) => c.type === "lambda" || c.type === "function")
        || computeNodes[0];
      if (backend) flows.push({ from: newNode.id, to: backend.id, label: "/v1" });
    }

    if (WAF_TYPES.has(type)) {
      // WAF inspects traffic in front of an LB / CDN / API gateway.
      flows.push({ from: "internet", to: newNode.id, label: "inspect", kind: "internet" });
      const downstream = cdnNodes[0] || lbNodes[0] || apigwNodes[0];
      if (downstream) flows.push({ from: newNode.id, to: downstream.id, label: "clean" });
    }

    if (type === "nsg") {
      // NSGs attach to subnets in Azure — represent as an inspect flow to
      // a same-tier resource so the visual shows it's in-line.
      const sameTierResource = allResources.find((r) => subnetTier(data, r.subnet) === tier);
      if (sameTierResource) {
        flows.push({ from: newNode.id, to: sameTierResource.id, label: "filter" });
      }
    }

    if (COMPUTE_TYPES.has(type)) {
      // Inbound from a load balancer in front of similar services.
      const lb = lbNodes[0] || cdnNodes[0];
      if (lb) flows.push({ from: lb.id, to: newNode.id, label: "HTTP" });
      else if (allGateways.find((g) => g.type === "igw") && tier === "public") {
        flows.push({ from: "internet", to: newNode.id, label: "HTTPS 443", kind: "internet" });
      }

      // Outbound to data layer + cache.
      dbNodes.slice(0, 2).forEach((db) => {
        flows.push({ from: newNode.id, to: db.id, label: DB_PORT[db.type] || "db" });
      });
      cacheNodes.slice(0, 1).forEach((c) => {
        flows.push({ from: newNode.id, to: c.id, label: "cache GET" });
      });

      // Egress through nearest NAT (private tier only).
      if (tier === "private") {
        const nat = sameAzNat(newNode.subnet);
        if (nat) flows.push({ from: newNode.id, to: nat.id, label: "egress", kind: "egress" });
      }
    }

    if (DB_TYPES.has(type)) {
      computeNodes.slice(0, 3).forEach((c) => {
        flows.push({ from: c.id, to: newNode.id, label: DB_PORT[type] || "db" });
      });
    }

    if (CACHE_TYPES.has(type)) {
      computeNodes.slice(0, 3).forEach((c) => {
        flows.push({ from: c.id, to: newNode.id, label: "cache GET" });
      });
    }

    if (STORAGE_TYPES.has(type)) {
      computeNodes.slice(0, 2).forEach((c) => {
        flows.push({ from: c.id, to: newNode.id, label: type === "s3" ? "PUT/GET" : "blob R/W" });
      });
    }

    if (type === "endpoint" || type === "privateendpoint") {
      // Private endpoint typically used by compute to reach a managed
      // service privately — represent as one inbound flow from each app.
      computeNodes.slice(0, 2).forEach((c) => {
        flows.push({ from: c.id, to: newNode.id, label: "private link" });
      });
    }

    if (type === "nat") {
      if (igw) flows.push({ from: newNode.id, to: igw.id, label: "0.0.0.0/0", kind: "egress" });
      const az = subnetAz(data, newNode.subnet);
      const peers = computeNodes.filter(
        (c) => subnetTier(data, c.subnet) === "private" && subnetAz(data, c.subnet) === az,
      );
      peers.slice(0, 2).forEach((c) => {
        flows.push({ from: c.id, to: newNode.id, label: "egress", kind: "egress" });
      });
    }

    if (type === "vpngw" || type === "expressroute") {
      flows.push({ from: "internet", to: newNode.id, label: "on-prem", kind: "internet" });
      const targetCompute = computeNodes[0];
      if (targetCompute) flows.push({ from: newNode.id, to: targetCompute.id, label: "private" });
    }

    if (type === "bastion") {
      flows.push({ from: "internet", to: newNode.id, label: "RDP/SSH", kind: "internet" });
      const vm = computeNodes.find((c) => c.type === "vm" || c.type === "ec2") || computeNodes[0];
      if (vm) flows.push({ from: newNode.id, to: vm.id, label: "session" });
    }

    if (type === "route53" || type === "azuredns") {
      // DNS is a pure resolver — show it answering for the LB / app endpoint.
      const facing = lbNodes[0] || cdnNodes[0] || apigwNodes[0] || computeNodes[0];
      if (facing) flows.push({ from: newNode.id, to: facing.id, label: "ALIAS" });
    }

    if (type === "azurefirewall") {
      flows.push({ from: "internet", to: newNode.id, label: "ingress", kind: "internet" });
      computeNodes.slice(0, 1).forEach((c) => {
        flows.push({ from: newNode.id, to: c.id, label: "filtered" });
      });
    }

    return flows;
  }

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------

  function findVpcForSubnet(data, subnetId) {
    return (data.vpcs || []).find((v) =>
      (v.subnets || []).some((s) => s.id === subnetId),
    );
  }
  function subnetTier(data, subnetId) {
    for (const v of data.vpcs || []) {
      for (const s of v.subnets || []) if (s.id === subnetId) return s.tier || "private";
    }
    return "private";
  }
  function subnetAz(data, subnetId) {
    for (const v of data.vpcs || []) {
      for (const s of v.subnets || []) if (s.id === subnetId) return s.az;
    }
    return null;
  }

  function generateId(data, type) {
    const existing = new Set();
    (data.vpcs || []).forEach((v) => {
      (v.resources || []).forEach((r) => existing.add(r.id));
      (v.gateways || []).forEach((g) => existing.add(g.id));
      (v.subnets || []).forEach((s) => existing.add(s.id));
      existing.add(v.id);
    });
    let id;
    do {
      id = `${type}-bld-${counter++}`;
    } while (existing.has(id));
    return id;
  }

  function buildFriendlyName(type) {
    const meta = (window.AWS_EXPLAIN && window.AWS_EXPLAIN[type]) || {};
    const base = meta.glyph || type.toUpperCase();
    return `New ${base}`;
  }

  // -------------------------------------------------------------------
  // Simulation HUD
  // -------------------------------------------------------------------

  function renderSimHud(node, flows, target) {
    const meta = (window.AWS_EXPLAIN && window.AWS_EXPLAIN[node.type]) || {};
    els.simIcon.textContent = meta.glyph || node.type.toUpperCase().slice(0, 3);
    els.simName.textContent = `Simulating ${meta.title || node.type.toUpperCase()}`;
    els.simWhere.textContent = `${node.name} · ${target.id} (${target.tier})`;

    const data = window.AwsApp.getData();
    els.simFlows.innerHTML = flows.length
      ? flows.map((f) => {
          const isOut = f.from === node.id;
          const other = isOut ? f.to : f.from;
          const otherName = nodeNameById(data, other) || other;
          return `<li>
            <span class="dir">${isOut ? "→" : "←"}</span>
            <span>${escapeHtml(otherName)}</span>
            <span class="lbl">${escapeHtml(f.label || "")}</span>
          </li>`;
        }).join("")
      : `<li><span class="dir">·</span><span class="muted">No automatic flows — dropped service is standalone.</span></li>`;

    els.simHud.hidden = false;
  }

  function nodeNameById(data, id) {
    if (id === "internet") return "Internet";
    for (const v of data.vpcs || []) {
      if (v.id === id) return v.name || id;
      for (const r of v.resources || []) if (r.id === id) return r.name || id;
      for (const g of v.gateways || []) if (g.id === id) return g.name || id;
      for (const s of v.subnets || []) if (s.id === id) return s.name || id;
    }
    return null;
  }

  function buildNarration(node, flows, target) {
    const meta = (window.AWS_EXPLAIN && window.AWS_EXPLAIN[node.type]) || {};
    const title = meta.title || node.type.toUpperCase();
    if (!flows.length) return `Placed a new ${title} in ${target.tier} subnet ${target.id}. No automatic flows added.`;
    const out = flows.filter((f) => f.from === node.id).length;
    const inb = flows.length - out;
    const parts = [`Placed a new ${title} in subnet ${target.id}.`];
    if (out && inb) parts.push(`It now sends ${out} outbound and receives ${inb} inbound flows.`);
    else if (out) parts.push(`It now sends ${out} outbound flow${out !== 1 ? "s" : ""}.`);
    else if (inb) parts.push(`It now receives ${inb} inbound flow${inb !== 1 ? "s" : ""}.`);
    return parts.join(" ");
  }

  function speak(text) {
    if (window.AwsSpeak && window.AwsSpeak.enabled() && text) {
      window.AwsSpeak.speak(text);
    }
  }

  // -------------------------------------------------------------------
  // Open / close / reset
  // -------------------------------------------------------------------

  function open() {
    if (!window.AwsApp || !window.AwsApp.getData()) {
      flashToast("Load a network first (Import or Load sample).", "warn");
      return;
    }
    if (window.AwsMode && window.AwsMode.is3D()) {
      // The drag-drop wiring targets the SVG layer. Bounce 3D users to 2D.
      window.AwsMode.set("2d");
    }
    isOpen = true;
    baselineData = JSON.parse(JSON.stringify(window.AwsApp.getData()));
    undoStack = [];
    els.drawer.hidden = false;
    els.btn.setAttribute("aria-pressed", "true");
    renderInventory();
  }

  function close() {
    isOpen = false;
    els.drawer.hidden = true;
    els.btn.setAttribute("aria-pressed", "false");
    els.simHud.hidden = true;
    cleanupDragState();
  }

  function reset() {
    if (!baselineData) return;
    window.AwsApp.applyData(JSON.parse(JSON.stringify(baselineData)));
    undoStack = [];
    els.simHud.hidden = true;
    flashToast("Reverted to the originally imported network.");
  }

  function undo() {
    if (!undoStack.length) {
      flashToast("Nothing to undo.", "warn");
      return;
    }
    const last = undoStack.pop();
    const data = window.AwsApp.getData();
    const next = JSON.parse(JSON.stringify(data));
    const vpc = (next.vpcs || []).find((v) => v.id === last.vpcId);
    if (vpc) {
      vpc.resources = (vpc.resources || []).filter((r) => r.id !== last.nodeId);
      vpc.gateways = (vpc.gateways || []).filter((g) => g.id !== last.nodeId);
    }
    const removedFlowKeys = new Set(
      last.flows.map((f) => `${f.from}|${f.to}|${f.label || ""}`),
    );
    const beforeFlows = next.flows || [];
    next.flows = beforeFlows.filter(
      (f) => !removedFlowKeys.has(`${f.from}|${f.to}|${f.label || ""}`),
    );
    const removedFlows = beforeFlows.filter(
      (f) => removedFlowKeys.has(`${f.from}|${f.to}|${f.label || ""}`),
    );
    window.AwsApp.applyData(next, {
      diff: {
        addedNodes: [],
        removedNodes: [last.nodeId],
        addedFlows: [],
        removedFlows,
      },
    });
    els.simHud.hidden = true;
  }

  // -------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------

  if (els.btn) {
    els.btn.addEventListener("click", () => {
      if (isOpen) close();
      else open();
    });
  }

  // Drop the drawer when the user flips to 3D — the SVG drop zones
  // disappear behind the WebGL canvas and the drawer would float over
  // a view it can't interact with.
  const mode3dBtn = document.getElementById("mode-3d");
  if (mode3dBtn) mode3dBtn.addEventListener("click", () => {
    if (isOpen) close();
  });
  if (els.closeBtn) els.closeBtn.addEventListener("click", close);
  if (els.resetBtn) els.resetBtn.addEventListener("click", reset);
  if (els.undoBtn) els.undoBtn.addEventListener("click", undo);
  if (els.simClose) els.simClose.addEventListener("click", () => (els.simHud.hidden = true));

  // Stage drag/drop wiring. We coexist with app.js's JSON-file dropzone:
  // when dragSpec is null we no-op and let the file handler fire.
  if (els.stage) {
    els.stage.addEventListener("dragover", handleStageDragOver);
    els.stage.addEventListener("drop", handleStageDrop);
    els.stage.addEventListener("dragleave", (e) => {
      // A leave that isn't actually leaving the stage (just entering a
      // child) gets a target inside the stage — ignore those.
      if (e.target === els.stage) hideDropToast();
    });
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
