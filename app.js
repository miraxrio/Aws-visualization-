// Glue layer: file import, drag-drop, sidebar updates, control buttons.
(function () {
  const els = {
    fileInput: document.getElementById("file-input"),
    loadSample: document.getElementById("load-sample"),
    toggleFlow: document.getElementById("toggle-flow"),
    resetZoom: document.getElementById("reset-zoom"),
    stage: document.getElementById("stage"),
    netName: document.getElementById("net-name"),
    netMeta: document.getElementById("net-meta"),
    detailTitle: document.getElementById("detail-title"),
    detailSummary: document.getElementById("detail-summary"),
    detailProps: document.getElementById("detail-props"),
    detailExplainer: document.getElementById("detail-explainer"),
    hint: document.getElementById("hint"),
  };

  let currentData = null;
  let paused = false;

  function loadData(data) {
    if (!data || !data.vpcs) {
      alert("That JSON doesn't look like a network topology — expected a top-level 'vpcs' array.");
      return;
    }
    currentData = data;
    AwsViz.render(data);
    updateSummary(data);
    fadeHint();
  }

  function updateSummary(data) {
    els.netName.textContent = data.name || "Unnamed network";
    const counts = countResources(data);
    const region = data.region || (data.vpcs[0] && data.vpcs[0].region) || "—";
    els.netMeta.textContent =
      `${data.vpcs.length} VPC${data.vpcs.length !== 1 ? "s" : ""} · ` +
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
  // Mirrors sample-network.json.
  const EMBEDDED_SAMPLE = {
    name: "Three-Tier Web App",
    region: "us-east-1",
    vpcs: [
      {
        id: "vpc-prod",
        name: "Production",
        cidr: "10.0.0.0/16",
        region: "us-east-1",
        subnets: [
          { id: "pub-1a", name: "Public 1a", cidr: "10.0.1.0/24",  tier: "public",  az: "us-east-1a" },
          { id: "prv-1a", name: "App 1a",    cidr: "10.0.11.0/24", tier: "private", az: "us-east-1a" },
          { id: "db-1a",  name: "Data 1a",   cidr: "10.0.21.0/24", tier: "data",    az: "us-east-1a" },
          { id: "pub-1b", name: "Public 1b", cidr: "10.0.2.0/24",  tier: "public",  az: "us-east-1b" },
          { id: "prv-1b", name: "App 1b",    cidr: "10.0.12.0/24", tier: "private", az: "us-east-1b" },
          { id: "db-1b",  name: "Data 1b",   cidr: "10.0.22.0/24", tier: "data",    az: "us-east-1b" },
        ],
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
      },
    ],
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
