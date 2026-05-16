// AWS Network Visualizer — SVG renderer (vanilla D3).
// Lays out a hierarchical view: VPC > AZ columns > subnet tiers > resources,
// then draws animated flows between elements. Exposes window.AwsViz.render(data).

(function () {
  const TIER_ORDER = { public: 0, private: 1, data: 2 };

  const NODE_W = 150;
  const NODE_H = 56;
  const NODE_GAP_Y = 30;
  const SUBNET_PAD_X = 18;
  const SUBNET_PAD_TOP = 38;
  const SUBNET_PAD_BOTTOM = 18;
  const SUBNET_GAP_Y = 22;
  const AZ_GAP_X = 36;
  const VPC_PAD_X = 26;
  const VPC_PAD_TOP = 116;
  const VPC_PAD_BOTTOM = 28;
  const INTERNET_W = 220;
  const INTERNET_H = 72;
  const INTERNET_GAP = 60;

  const FLOW_KIND_CLASS = (kind) =>
    kind === "internet" ? "internet" : kind === "egress" ? "egress" : "";

  // --- Layout -----------------------------------------------------------

  function layout(data) {
    const vpcs = data.vpcs || [];
    if (!vpcs.length) {
      return { width: 800, height: 400, vpcs: [], internet: null, nodes: new Map() };
    }

    const nodes = new Map(); // id -> { x, y, w, h, type, ref }
    const vpcLayouts = [];

    let xCursor = 0;

    vpcs.forEach((vpc) => {
      const subnets = vpc.subnets || [];
      const gateways = vpc.gateways || [];
      const resources = vpc.resources || [];

      // Group subnets by AZ
      const azs = {};
      subnets.forEach((s) => {
        const az = s.az || "default";
        (azs[az] ||= []).push(s);
      });
      const azKeys = Object.keys(azs).sort();

      // Sort subnets within each AZ by tier
      azKeys.forEach((az) => {
        azs[az].sort(
          (a, b) =>
            (TIER_ORDER[a.tier] ?? 99) - (TIER_ORDER[b.tier] ?? 99) ||
            String(a.name || a.id).localeCompare(String(b.name || b.id)),
        );
      });

      // Group resources & gateways by parent subnet
      const childrenBySubnet = new Map();
      resources.forEach((r) => {
        const k = r.subnet || "_floating";
        (childrenBySubnet.get(k) || childrenBySubnet.set(k, []).get(k)).push({
          ...r,
          _kind: "resource",
        });
      });
      gateways.forEach((g) => {
        if (g.type === "nat" && g.subnet) {
          (childrenBySubnet.get(g.subnet) || childrenBySubnet.set(g.subnet, []).get(g.subnet)).push({
            ...g,
            _kind: "gateway",
          });
        }
      });

      // Compute subnet heights based on children count
      const subnetSize = (s) => {
        const kids = childrenBySubnet.get(s.id) || [];
        const inner = Math.max(1, kids.length) * NODE_H + Math.max(0, kids.length - 1) * NODE_GAP_Y;
        return {
          w: NODE_W + 2 * SUBNET_PAD_X,
          h: inner + SUBNET_PAD_TOP + SUBNET_PAD_BOTTOM,
        };
      };

      // Per-AZ column width = subnet width (single column of subnets per AZ)
      const azColumnWidth = NODE_W + 2 * SUBNET_PAD_X;
      const azColumnHeights = azKeys.map((az) =>
        azs[az].reduce((acc, s, i) => acc + subnetSize(s).h + (i ? SUBNET_GAP_Y : 0), 0),
      );
      const innerHeight = Math.max(...azColumnHeights, 1);
      const innerWidth = azKeys.length * azColumnWidth + (azKeys.length - 1) * AZ_GAP_X;
      const vpcWidth = innerWidth + 2 * VPC_PAD_X;
      const vpcHeight = innerHeight + VPC_PAD_TOP + VPC_PAD_BOTTOM;

      const vpcX = xCursor;
      const vpcY = INTERNET_H + INTERNET_GAP;

      // Place subnets and their children
      const placedSubnets = [];
      azKeys.forEach((az, i) => {
        const colX = vpcX + VPC_PAD_X + i * (azColumnWidth + AZ_GAP_X);
        let y = vpcY + VPC_PAD_TOP;
        azs[az].forEach((s) => {
          const { w, h } = subnetSize(s);
          const subnet = {
            ...s,
            x: colX,
            y,
            w,
            h,
            az,
            parent: vpc.id,
            children: [],
          };
          // place children (resources/gateways) inside
          const kids = childrenBySubnet.get(s.id) || [];
          let cy = y + SUBNET_PAD_TOP;
          kids.forEach((k) => {
            const node = {
              ...k,
              x: colX + SUBNET_PAD_X,
              y: cy,
              w: NODE_W,
              h: NODE_H,
              parent: s.id,
            };
            subnet.children.push(node);
            nodes.set(k.id, node);
            cy += NODE_H + NODE_GAP_Y;
          });
          placedSubnets.push(subnet);
          nodes.set(s.id, { ...subnet, type: "subnet" });
          y += h + SUBNET_GAP_Y;
        });
      });

      // Place IGW and standalone gateways at the top of the VPC
      const igws = gateways.filter((g) => g.type !== "nat");
      const igwY = vpcY + 44;
      const totalIgwWidth = igws.length * NODE_W + Math.max(0, igws.length - 1) * 24;
      let igwX = vpcX + (vpcWidth - totalIgwWidth) / 2;
      const igwPlaced = [];
      igws.forEach((g) => {
        const node = {
          ...g,
          _kind: "gateway",
          x: igwX,
          y: igwY,
          w: NODE_W,
          h: NODE_H,
          parent: vpc.id,
        };
        igwPlaced.push(node);
        nodes.set(g.id, node);
        igwX += NODE_W + 24;
      });

      vpcLayouts.push({
        ...vpc,
        x: vpcX,
        y: vpcY,
        w: vpcWidth,
        h: vpcHeight,
        subnets: placedSubnets,
        igws: igwPlaced,
      });

      nodes.set(vpc.id, {
        ...vpc,
        x: vpcX,
        y: vpcY,
        w: vpcWidth,
        h: vpcHeight,
        type: "vpc",
      });

      xCursor += vpcWidth + 80;
    });

    const totalWidth = Math.max(xCursor - 80, INTERNET_W + 200);
    const totalHeight = INTERNET_H + INTERNET_GAP + Math.max(...vpcLayouts.map((v) => v.h), 200);

    // Internet "cloud" centered above
    const internet = {
      id: "internet",
      type: "internet",
      x: totalWidth / 2 - INTERNET_W / 2,
      y: 0,
      w: INTERNET_W,
      h: INTERNET_H,
    };
    nodes.set("internet", internet);

    return {
      width: totalWidth,
      height: totalHeight,
      vpcs: vpcLayouts,
      internet,
      nodes,
    };
  }

  // --- Rendering --------------------------------------------------------

  let zoomBehavior;
  let rootG;
  let svg;
  let lastLayout;
  let lastData;
  let lastViewBox;
  let spotlight;
  let diffCleanupTimer = null;

  function render(data, opts) {
    const diff = opts && opts.diff;
    const baselineDiff = opts && opts.baselineDiff;
    const baselineLayout = opts && opts.baselineLayout;
    // Capture the previous layout *before* we replace it, so we can position
    // "ghost" markers for removed elements at the spots they used to occupy.
    const prevLayout = lastLayout;
    lastData = data;
    const lay = layout(data);
    lastLayout = lay;

    svg = d3.select("#diagram");
    svg.selectAll("*").remove();

    // ViewBox padded
    const padding = 40;
    const vb = {
      x: -padding,
      y: -padding,
      w: lay.width + padding * 2,
      h: lay.height + padding * 2,
    };
    svg.attr("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    svg.attr("preserveAspectRatio", "xMidYMid meet");
    lastViewBox = vb;

    const defs = svg.append("defs");
    buildDefs(defs);

    rootG = svg.append("g").attr("class", "root");

    // Spotlight overlay (used by tour) – sits above main content but below tooltip
    spotlight = svg.append("rect")
      .attr("class", "spotlight")
      .attr("x", vb.x).attr("y", vb.y)
      .attr("width", vb.w).attr("height", vb.h)
      .style("opacity", 0)
      .style("pointer-events", "none");

    zoomBehavior = d3
      .zoom()
      .scaleExtent([0.3, 3])
      .on("zoom", (event) => rootG.attr("transform", event.transform));
    svg.call(zoomBehavior);

    drawInternet(rootG, lay.internet);
    lay.vpcs.forEach((v) => drawVpc(rootG, v));
    drawFlows(rootG, lay, data.flows || []);

    bindHoverInteractions(lay);

    if (diff) applyVersionDiff(diff, prevLayout);
    if (baselineDiff) applyBaselineDiff(baselineDiff, baselineLayout);
  }

  // Persistent "vs initial state" highlight. Unlike applyVersionDiff, this
  // does NOT animate or self-clean — it stays on every node that's been
  // added since the first recorded version. Removed-since-baseline elements
  // get a red ghost at the position they occupied in the baseline layout.
  function applyBaselineDiff(diff, baselineLayout) {
    const addedNodeSet = new Set(diff.addedNodes || []);
    addedNodeSet.forEach((id) => {
      d3.selectAll(`.node-group[data-id="${id}"]`).classed("boundary-added", true);
      d3.selectAll(`.subnet-group[data-id="${id}"]`).classed("boundary-added", true);
      d3.selectAll(`.vpc-group[data-id="${id}"]`).classed("boundary-added", true);
    });
    (diff.addedFlows || []).forEach((f) => {
      d3.selectAll(`.flow-group[data-from="${f.from}"][data-to="${f.to}"]`)
        .classed("boundary-added", true);
    });

    if (!baselineLayout) return;
    const removedNodes = (diff.removedNodes || []).filter((id) => baselineLayout.nodes.has(id));
    if (!removedNodes.length) return;

    const ghostLayer = rootG.append("g").attr("class", "boundary-ghost-layer");
    removedNodes.forEach((id) => {
      const prev = baselineLayout.nodes.get(id);
      if (!prev) return;
      const g = ghostLayer
        .append("g")
        .attr("class", "boundary-ghost")
        .attr("data-id", id);
      g.append("rect")
        .attr("x", prev.x)
        .attr("y", prev.y)
        .attr("width", prev.w)
        .attr("height", prev.h);
      const cx = prev.x + prev.w / 2;
      const cy = prev.y + prev.h / 2;
      const half = Math.min(prev.w, prev.h) / 2 - 8;
      g.append("line")
        .attr("class", "ghost-x")
        .attr("x1", cx - half).attr("y1", cy - half)
        .attr("x2", cx + half).attr("y2", cy + half);
      g.append("line")
        .attr("class", "ghost-x")
        .attr("x1", cx - half).attr("y1", cy + half)
        .attr("x2", cx + half).attr("y2", cy - half);
      g.append("text")
        .attr("x", prev.x + prev.w / 2)
        .attr("y", prev.y - 6)
        .attr("text-anchor", "middle")
        .text(`since-initial: ${truncate(prev.name || prev.id, 22)}`);
    });
  }

  // Highlight freshly added nodes/flows and draw fade-out "ghosts" for the
  // elements that disappeared compared to the previous version.
  function applyVersionDiff(diff, prevLayout) {
    // Cancel any pending cleanup from a prior diff render so the new
    // .v-added classes don't get wiped before their animation completes.
    if (diffCleanupTimer) {
      clearTimeout(diffCleanupTimer);
      diffCleanupTimer = null;
    }
    const addedNodeSet = new Set(diff.addedNodes || []);
    const removedNodeSet = new Set(diff.removedNodes || []);

    // Mark added elements so CSS plays the pop-in / glow animation.
    addedNodeSet.forEach((id) => {
      d3.selectAll(`.node-group[data-id="${id}"]`).classed("v-added", true);
      d3.selectAll(`.subnet-group[data-id="${id}"]`).classed("v-added", true);
      d3.selectAll(`.vpc-group[data-id="${id}"]`).classed("v-added", true);
    });

    (diff.addedFlows || []).forEach((f) => {
      d3.selectAll(`.flow-group[data-from="${f.from}"][data-to="${f.to}"]`)
        .classed("v-added", true);
    });

    // Draw red dashed "tombstones" at the previous positions of removed
    // nodes so the user can see *where* something just left the diagram.
    if (prevLayout) {
      const ghostLayer = rootG.append("g").attr("class", "ghost-layer");

      removedNodeSet.forEach((id) => {
        const prev = prevLayout.nodes.get(id);
        if (!prev) return;
        const g = ghostLayer
          .append("g")
          .attr("class", "ghost-removed")
          .attr("data-id", id);
        g.append("rect")
          .attr("x", prev.x)
          .attr("y", prev.y)
          .attr("width", prev.w)
          .attr("height", prev.h);
        const cx = prev.x + prev.w / 2;
        const cy = prev.y + prev.h / 2;
        const half = Math.min(prev.w, prev.h) / 2 - 8;
        g.append("line")
          .attr("class", "ghost-x")
          .attr("x1", cx - half).attr("y1", cy - half)
          .attr("x2", cx + half).attr("y2", cy + half);
        g.append("line")
          .attr("class", "ghost-x")
          .attr("x1", cx - half).attr("y1", cy + half)
          .attr("x2", cx + half).attr("y2", cy - half);
        g.append("text")
          .attr("x", prev.x + prev.w / 2)
          .attr("y", prev.y - 6)
          .attr("text-anchor", "middle")
          .text(`removed: ${truncate(prev.name || prev.id, 22)}`);
      });

      (diff.removedFlows || []).forEach((f) => {
        const a = prevLayout.nodes.get(f.from);
        const b = prevLayout.nodes.get(f.to);
        if (!a || !b) return;
        const p = curvePath(a, b);
        ghostLayer
          .append("path")
          .attr("class", "ghost-flow-removed")
          .attr("d", p.d);
      });

      // Self-clean once the fade animation finishes (animations are ~2.6s).
      setTimeout(() => {
        ghostLayer.remove();
      }, 3000);
    }

    // Remove the v-added class after the animation completes so subsequent
    // interactions (hover, tour) don't fight it.
    diffCleanupTimer = setTimeout(() => {
      diffCleanupTimer = null;
      d3.selectAll(".v-added").classed("v-added", false);
    }, 3200);
  }

  // Build per-type gradients, drop-shadow and glow filters once per render.
  function buildDefs(defs) {
    const colors = window.AWS_COLORS || {};

    Object.keys(colors).forEach((type) => {
      const c = colors[type];
      const grad = defs
        .append("linearGradient")
        .attr("id", `grad-${type}`)
        .attr("x1", "0%").attr("y1", "0%")
        .attr("x2", "0%").attr("y2", "100%");
      grad.append("stop").attr("offset", "0%").attr("stop-color", c.a);
      grad.append("stop").attr("offset", "100%").attr("stop-color", c.b);

      // Radial halo for the icon disc
      const halo = defs
        .append("radialGradient")
        .attr("id", `halo-${type}`)
        .attr("cx", "50%").attr("cy", "40%").attr("r", "60%");
      halo.append("stop").attr("offset", "0%").attr("stop-color", c.a).attr("stop-opacity", 1);
      halo.append("stop").attr("offset", "70%").attr("stop-color", c.b).attr("stop-opacity", 0.95);
      halo.append("stop").attr("offset", "100%").attr("stop-color", c.b).attr("stop-opacity", 0.6);

      // Per-type glow
      const glow = defs.append("filter")
        .attr("id", `glow-${type}`)
        .attr("x", "-40%").attr("y", "-40%")
        .attr("width", "180%").attr("height", "180%");
      glow.append("feGaussianBlur").attr("stdDeviation", 4).attr("result", "blur");
      const flood = glow.append("feFlood").attr("flood-color", c.glow).attr("flood-opacity", 0.85);
      glow.append("feComposite").attr("in", "blur").attr("in2", "blur").attr("operator", "in");
      const merge = glow.append("feMerge");
      merge.append("feMergeNode");
      merge.append("feMergeNode").attr("in", "SourceGraphic");
    });

    // Generic drop shadow
    const ds = defs.append("filter")
      .attr("id", "drop-shadow")
      .attr("x", "-20%").attr("y", "-20%")
      .attr("width", "140%").attr("height", "160%");
    ds.append("feGaussianBlur").attr("in", "SourceAlpha").attr("stdDeviation", 4);
    ds.append("feOffset").attr("dx", 0).attr("dy", 4).attr("result", "off");
    const dsMerge = ds.append("feMerge");
    dsMerge.append("feMergeNode").attr("in", "off");
    dsMerge.append("feMergeNode").attr("in", "SourceGraphic");

    // Subnet soft-glow
    const sg = defs.append("filter")
      .attr("id", "subnet-glow")
      .attr("x", "-10%").attr("y", "-10%")
      .attr("width", "120%").attr("height", "120%");
    sg.append("feGaussianBlur").attr("stdDeviation", 8).attr("result", "b");
    const sgMerge = sg.append("feMerge");
    sgMerge.append("feMergeNode").attr("in", "b");
    sgMerge.append("feMergeNode").attr("in", "SourceGraphic");

    // Arrow marker
    defs
      .append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 9).attr("refY", 0)
      .attr("markerWidth", 6).attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-4L8,0L0,4")
      .attr("fill", "rgba(160, 200, 255, 0.7)");

    // Gloss highlight gradient (top sheen on cards)
    const gloss = defs.append("linearGradient")
      .attr("id", "gloss")
      .attr("x1", "0%").attr("y1", "0%")
      .attr("x2", "0%").attr("y2", "100%");
    gloss.append("stop").attr("offset", "0%").attr("stop-color", "#ffffff").attr("stop-opacity", 0.28);
    gloss.append("stop").attr("offset", "100%").attr("stop-color", "#ffffff").attr("stop-opacity", 0);
  }

  function drawInternet(g, n) {
    const grp = g
      .append("g")
      .attr("class", "node-group internet-group")
      .attr("data-id", "internet")
      .attr("data-type", "internet")
      .attr("filter", "url(#drop-shadow)");

    grp
      .append("rect")
      .attr("class", "internet-cloud")
      .attr("x", n.x)
      .attr("y", n.y)
      .attr("width", n.w)
      .attr("height", n.h)
      .attr("fill", "url(#grad-internet)");

    grp
      .append("rect")
      .attr("class", "internet-gloss")
      .attr("x", n.x).attr("y", n.y)
      .attr("width", n.w).attr("height", n.h * 0.5)
      .attr("rx", 28).attr("ry", 28)
      .attr("fill", "url(#gloss)");

    // Orbiting dots to suggest "global"
    const cx = n.x + n.w / 2;
    const cy = n.y + n.h / 2;
    const orbit = grp.append("g").attr("class", "orbit").attr("transform", `translate(${cx} ${cy})`);
    orbit.append("ellipse")
      .attr("class", "orbit-ring")
      .attr("rx", n.w / 2 - 14).attr("ry", n.h / 2 - 6)
      .attr("fill", "none")
      .attr("stroke", "rgba(255,255,255,0.25)")
      .attr("stroke-dasharray", "2 6");
    [0, 120, 240].forEach((deg, i) => {
      orbit.append("circle")
        .attr("class", "orbit-dot")
        .attr("r", 3)
        .attr("cx", (n.w / 2 - 14) * Math.cos((deg * Math.PI) / 180))
        .attr("cy", (n.h / 2 - 6) * Math.sin((deg * Math.PI) / 180))
        .attr("fill", "#fff")
        .style("animation-delay", `${i * -1.2}s`);
    });

    grp
      .append("text")
      .attr("class", "internet-label")
      .attr("x", cx).attr("y", cy + 5)
      .attr("text-anchor", "middle")
      .text("INTERNET");
  }

  function drawVpc(g, v) {
    const vpcG = g
      .append("g")
      .attr("class", "vpc-group")
      .attr("data-id", v.id)
      .attr("data-type", "vpc");

    vpcG
      .append("rect")
      .attr("class", "vpc-bg node-target")
      .attr("data-id", v.id)
      .attr("data-type", "vpc")
      .attr("x", v.x)
      .attr("y", v.y)
      .attr("width", v.w)
      .attr("height", v.h);

    vpcG
      .append("text")
      .attr("class", "vpc-label")
      .attr("x", v.x + 18)
      .attr("y", v.y + 24)
      .text(`VPC · ${v.name || v.id}${v.cidr ? "  " + v.cidr : ""}`);

    if (v.region) {
      vpcG
        .append("text")
        .attr("class", "subnet-cidr")
        .attr("x", v.x + v.w - 18)
        .attr("y", v.y + 24)
        .attr("text-anchor", "end")
        .text(v.region);
    }

    v.igws.forEach((node) => drawNode(vpcG, node));
    v.subnets.forEach((s) => drawSubnet(vpcG, s));
  }

  function drawSubnet(g, s) {
    const tier = s.tier || "private";
    const sg = g
      .append("g")
      .attr("class", "subnet-group")
      .attr("data-id", s.id)
      .attr("data-type", "subnet")
      .attr("data-tier", tier);

    sg
      .append("rect")
      .attr("class", `subnet ${tier} node-target`)
      .attr("data-id", s.id)
      .attr("data-type", "subnet")
      .attr("data-tier", tier)
      .attr("x", s.x)
      .attr("y", s.y)
      .attr("width", s.w)
      .attr("height", s.h);

    // Top sheen for depth
    sg.append("rect")
      .attr("class", "subnet-gloss")
      .attr("x", s.x + 4).attr("y", s.y + 3)
      .attr("width", s.w - 8).attr("height", 18)
      .attr("rx", 10).attr("ry", 10)
      .attr("fill", "url(#gloss)")
      .style("pointer-events", "none");

    sg
      .append("text")
      .attr("class", `subnet-label ${tier}`)
      .attr("x", s.x + 14)
      .attr("y", s.y + 20)
      .text(`${tier.toUpperCase()} · ${s.name || s.id}`);

    sg
      .append("text")
      .attr("class", "subnet-cidr")
      .attr("x", s.x + s.w - 14)
      .attr("y", s.y + 20)
      .attr("text-anchor", "end")
      .text([s.cidr, s.az].filter(Boolean).join("  "));

    s.children.forEach((c) => drawNode(sg, c));
  }

  function drawNode(g, n) {
    const meta = window.AWS_EXPLAIN[n.type] || window.AWS_EXPLAIN.unknown;
    const colors = (window.AWS_COLORS && window.AWS_COLORS[n.type]) || window.AWS_COLORS.unknown;
    const grp = g
      .append("g")
      .attr("class", "node-group")
      .attr("data-id", n.id)
      .attr("data-type", n.type)
      .attr("filter", "url(#drop-shadow)");

    grp
      .append("circle")
      .attr("class", "pulse")
      .attr("cx", n.x + n.w / 2)
      .attr("cy", n.y + n.h / 2)
      .attr("r", n.h / 2 + 6)
      .attr("stroke", colors.glow);

    // Card body (gradient)
    grp
      .append("rect")
      .attr("class", "node-bg")
      .attr("x", n.x)
      .attr("y", n.y)
      .attr("width", n.w)
      .attr("height", n.h)
      .attr("fill", "#152139");

    grp
      .append("rect")
      .attr("class", "node-accent")
      .attr("x", n.x).attr("y", n.y)
      .attr("width", 4).attr("height", n.h)
      .attr("rx", 2).attr("ry", 2)
      .attr("fill", `url(#grad-${n.type in window.AWS_COLORS ? n.type : "unknown"})`);

    grp
      .append("rect")
      .attr("class", "node-gloss")
      .attr("x", n.x + 4).attr("y", n.y + 2)
      .attr("width", n.w - 8).attr("height", 14)
      .attr("rx", 8).attr("ry", 8)
      .attr("fill", "url(#gloss)")
      .style("pointer-events", "none");

    // Icon disc with halo + animated ring
    const cy = n.y + n.h / 2;
    const ix = n.x + 22;

    grp.append("circle")
      .attr("class", "icon-ring")
      .attr("cx", ix).attr("cy", cy).attr("r", 19)
      .attr("fill", "none")
      .attr("stroke", colors.glow)
      .attr("stroke-opacity", 0.55)
      .attr("stroke-width", 1.2)
      .attr("stroke-dasharray", "3 4");

    grp
      .append("circle")
      .attr("class", "icon-disc")
      .attr("cx", ix)
      .attr("cy", cy)
      .attr("r", 16)
      .attr("fill", `url(#halo-${n.type in window.AWS_COLORS ? n.type : "unknown"})`)
      .attr("stroke", "rgba(255,255,255,0.18)")
      .attr("stroke-width", 1);

    // Tiny glossy highlight on the icon disc (top-left)
    grp.append("ellipse")
      .attr("cx", ix - 4).attr("cy", cy - 5)
      .attr("rx", 6).attr("ry", 3)
      .attr("fill", "rgba(255,255,255,0.45)")
      .style("pointer-events", "none");

    grp
      .append("text")
      .attr("class", "icon-glyph")
      .attr("x", ix)
      .attr("y", cy + 1)
      .text(meta.glyph || (n.type || "?").toUpperCase().slice(0, 3));

    grp
      .append("text")
      .attr("class", "node-label")
      .attr("x", n.x + 46)
      .attr("y", cy - 3)
      .text(truncate(n.name || n.id, 16));

    grp
      .append("text")
      .attr("class", "node-sub")
      .attr("x", n.x + 46)
      .attr("y", cy + 13)
      .text((n.type || "").toUpperCase());
  }

  // --- Flows ------------------------------------------------------------

  function anchorPoint(node, side) {
    // side ∈ { 'top', 'bottom', 'left', 'right', 'center' }
    const cx = node.x + node.w / 2;
    const cy = node.y + node.h / 2;
    if (side === "top") return [cx, node.y];
    if (side === "bottom") return [cx, node.y + node.h];
    if (side === "left") return [node.x, cy];
    if (side === "right") return [node.x + node.w, cy];
    return [cx, cy];
  }

  function pickSides(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.abs(dx) > Math.abs(dy) * 1.4) {
      return dx > 0 ? ["right", "left"] : ["left", "right"];
    }
    return dy > 0 ? ["bottom", "top"] : ["top", "bottom"];
  }

  function curvePath(a, b) {
    const [sa, sb] = pickSides(a, b);
    const [ax, ay] = anchorPoint(a, sa);
    const [bx, by] = anchorPoint(b, sb);
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const horizontal = sa === "left" || sa === "right";
    let c1x, c1y, c2x, c2y;
    if (horizontal) {
      c1x = mx; c1y = ay;
      c2x = mx; c2y = by;
    } else {
      c1x = ax; c1y = my;
      c2x = bx; c2y = my;
    }
    return {
      d: `M${ax},${ay} C${c1x},${c1y} ${c2x},${c2y} ${bx},${by}`,
      mid: [(ax + bx) / 2, (ay + by) / 2],
    };
  }

  function drawFlows(g, lay, flows) {
    const layer = g.append("g").attr("class", "flows");

    flows.forEach((f, i) => {
      const a = lay.nodes.get(f.from);
      const b = lay.nodes.get(f.to);
      if (!a || !b) return;
      const path = curvePath(a, b);

      const fg = layer
        .append("g")
        .attr("class", "flow-group")
        .attr("data-from", f.from)
        .attr("data-to", f.to)
        .attr("data-index", i);

      fg.append("path")
        .attr("class", "flow-path")
        .attr("d", path.d)
        .attr("marker-end", "url(#arrow)");

      const kindClass = FLOW_KIND_CLASS(f.kind || inferFlowKind(f, a, b));
      fg.append("path")
        .attr("class", `flow-anim ${kindClass}`)
        .attr("d", path.d)
        .style("animation-delay", `${(i % 6) * -0.18}s`);

      if (f.label) {
        fg.append("text")
          .attr("class", "flow-label")
          .attr("x", path.mid[0])
          .attr("y", path.mid[1] - 6)
          .attr("text-anchor", "middle")
          .text(f.label);
      }
    });
  }

  function inferFlowKind(f, a, b) {
    if (a?.type === "internet" || b?.type === "internet") return "internet";
    if (a?.type === "nat" || b?.type === "igw") return "egress";
    return "internal";
  }

  // --- Hover interactions -----------------------------------------------

  function bindHoverInteractions(lay) {
    const tooltip = document.getElementById("tooltip");

    const showTooltip = (html, evt) => {
      tooltip.innerHTML = html;
      tooltip.classList.add("show");
      tooltip.setAttribute("aria-hidden", "false");
      moveTooltip(evt);
    };
    const hideTooltip = () => {
      tooltip.classList.remove("show");
      tooltip.setAttribute("aria-hidden", "true");
    };
    const moveTooltip = (evt) => {
      const pad = 14;
      const w = tooltip.offsetWidth || 200;
      const h = tooltip.offsetHeight || 40;
      let x = evt.clientX + pad;
      let y = evt.clientY + pad;
      if (x + w > window.innerWidth - 10) x = evt.clientX - w - pad;
      if (y + h > window.innerHeight - 10) y = evt.clientY - h - pad;
      tooltip.style.left = `${x}px`;
      tooltip.style.top = `${y}px`;
    };

    const focusElement = (id) => {
      d3.selectAll(".is-hover").classed("is-hover", false);
      d3.selectAll(".flow-anim.is-hot, .flow-path.is-hot").classed("is-hot", false);

      if (!id) {
        AwsViz.onSelect && AwsViz.onSelect(null);
        return;
      }
      const node = lay.nodes.get(id);
      if (!node) return;
      d3.selectAll(`[data-id="${id}"]`).classed("is-hover", true);

      // Highlight related flows
      d3.selectAll(".flow-group").each(function () {
        const from = this.getAttribute("data-from");
        const to = this.getAttribute("data-to");
        if (from === id || to === id) {
          d3.select(this).select(".flow-anim").classed("is-hot", true);
          d3.select(this).select(".flow-path").classed("is-hot", true);
        }
      });

      AwsViz.onSelect && AwsViz.onSelect(node);
    };

    // Bind on node groups, vpc rect, subnet rect
    svg
      .selectAll(".node-group, .node-target, .subnet, .internet-group")
      .on("mouseenter", function (evt) {
        const id = this.getAttribute("data-id");
        const type = this.getAttribute("data-type") || "unknown";
        focusElement(id);
        const meta =
          type === "subnet"
            ? window.AWS_TIER_EXPLAIN[this.getAttribute("data-tier")] || window.AWS_EXPLAIN.subnet
            : window.AWS_EXPLAIN[type] || window.AWS_EXPLAIN.unknown;
        const node = lay.nodes.get(id) || {};
        const title = node.name || node.id || meta.title;
        showTooltip(
          `<strong>${escapeHtml(title)}</strong>${escapeHtml(meta.title)}`,
          evt,
        );
      })
      .on("mousemove", moveTooltip)
      .on("mouseleave", function () {
        focusElement(null);
        hideTooltip();
      });

    // Flow hover
    svg
      .selectAll(".flow-group")
      .on("mouseenter", function (evt) {
        d3.select(this).select(".flow-anim").classed("is-hot", true);
        d3.select(this).select(".flow-path").classed("is-hot", true);
        const from = this.getAttribute("data-from");
        const to = this.getAttribute("data-to");
        const fromNode = lay.nodes.get(from);
        const toNode = lay.nodes.get(to);
        const flow = (lastData.flows || [])[+this.getAttribute("data-index")];
        showTooltip(
          `<strong>Traffic flow</strong>${escapeHtml(fromNode?.name || from)} → ${escapeHtml(
            toNode?.name || to,
          )}${flow?.label ? "<br><span style=\"color:#8b9bbb\">" + escapeHtml(flow.label) + "</span>" : ""}`,
          evt,
        );
        AwsViz.onSelectFlow && AwsViz.onSelectFlow(flow, fromNode, toNode);
      })
      .on("mousemove", moveTooltip)
      .on("mouseleave", function () {
        d3.select(this).select(".flow-anim").classed("is-hot", false);
        d3.select(this).select(".flow-path").classed("is-hot", false);
        hideTooltip();
        AwsViz.onSelectFlow && AwsViz.onSelectFlow(null);
      });
  }

  // --- Helpers ----------------------------------------------------------

  function truncate(s, n) {
    s = String(s || "");
    return s.length <= n ? s : s.slice(0, n - 1) + "…";
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function resetZoom() {
    if (!svg || !zoomBehavior) return;
    svg.transition().duration(500).call(zoomBehavior.transform, d3.zoomIdentity);
    clearHighlight();
  }

  // Focus the camera on a node by id, with optional padding around the node.
  function focus(id, opts = {}) {
    if (!svg || !zoomBehavior || !lastLayout) return;
    const node = lastLayout.nodes.get(id);
    if (!node) return;

    const pad = opts.pad ?? 80;
    const vb = lastViewBox;

    const targetW = node.w + pad * 2;
    const targetH = node.h + pad * 2;

    const k = Math.max(
      0.6,
      Math.min(2.4, Math.min(vb.w / targetW, vb.h / targetH) * 0.85),
    );

    // Center of the node in viewBox coords
    const cx = node.x + node.w / 2;
    const cy = node.y + node.h / 2;

    // We want T such that T(cx, cy) maps to the center of the visible area in SVG-pixel
    // space. After d3.zoom transform, an SVG point p maps to: T.k * p + (T.x, T.y)
    // expressed in *SVG user units* (viewBox), since rootG transforms in user units.
    // The center of the viewBox (in user units) is (vb.x + vb.w/2, vb.y + vb.h/2).
    const tx = vb.x + vb.w / 2 - cx * k;
    const ty = vb.y + vb.h / 2 - cy * k;

    svg
      .transition()
      .duration(opts.duration ?? 700)
      .call(zoomBehavior.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
  }

  function highlight(id) {
    if (!svg) return;
    clearHighlight();
    if (!id) return;

    d3.selectAll(`[data-id="${id}"]`).classed("is-tour", true);

    // Walk up to ancestor subnet/VPC and tag them as "context" so they don't
    // sit fully dimmed behind the focused element.
    const node = lastLayout && lastLayout.nodes.get(id);
    if (node) {
      if (node.parent && node.parent !== id) {
        d3.selectAll(`[data-id="${node.parent}"]`).classed("is-tour-context", true);
        const parentNode = lastLayout.nodes.get(node.parent);
        if (parentNode && parentNode.parent && parentNode.parent !== node.parent) {
          d3.selectAll(`[data-id="${parentNode.parent}"]`).classed("is-tour-context", true);
        }
      }
    }

    // Highlight related flows
    d3.selectAll(".flow-group").each(function () {
      const from = this.getAttribute("data-from");
      const to = this.getAttribute("data-to");
      if (from === id || to === id) {
        d3.select(this).classed("is-tour-flow", true);
      }
    });

    rootG.classed("tour-active", true);
  }

  function clearHighlight() {
    if (!svg) return;
    d3.selectAll(".is-tour, .is-tour-context").classed("is-tour is-tour-context", false);
    d3.selectAll(".is-tour-flow").classed("is-tour-flow", false);
    if (rootG) rootG.classed("tour-active", false);
  }

  function getLayout() {
    return lastLayout;
  }

  function getData() {
    return lastData;
  }

  window.AwsViz = {
    render,
    resetZoom,
    focus,
    highlight,
    clearHighlight,
    getLayout,
    getData,
    layout,
    onSelect: null,
    onSelectFlow: null,
  };
})();
