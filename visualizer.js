// AWS Network Visualizer — SVG renderer (vanilla D3).
// Lays out a hierarchical view: VPC > AZ columns > subnet tiers > resources,
// then draws animated flows between elements. Exposes window.AwsViz.render(data).

(function () {
  const TIER_ORDER = { public: 0, private: 1, data: 2 };

  const NODE_W = 150;
  const NODE_H = 56;
  const NODE_GAP_Y = 14;
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

  function render(data) {
    lastData = data;
    const lay = layout(data);
    lastLayout = lay;

    svg = d3.select("#diagram");
    svg.selectAll("*").remove();

    // ViewBox padded
    const padding = 40;
    svg.attr(
      "viewBox",
      `${-padding} ${-padding} ${lay.width + padding * 2} ${lay.height + padding * 2}`,
    );
    svg.attr("preserveAspectRatio", "xMidYMid meet");

    const defs = svg.append("defs");
    defs
      .append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 9)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-4L8,0L0,4")
      .attr("fill", "rgba(120, 160, 220, 0.6)");

    rootG = svg.append("g").attr("class", "root");

    zoomBehavior = d3
      .zoom()
      .scaleExtent([0.3, 3])
      .on("zoom", (event) => rootG.attr("transform", event.transform));
    svg.call(zoomBehavior);

    drawInternet(rootG, lay.internet);
    lay.vpcs.forEach((v) => drawVpc(rootG, v));
    drawFlows(rootG, lay, data.flows || []);

    bindHoverInteractions(lay);
  }

  function drawInternet(g, n) {
    const grp = g
      .append("g")
      .attr("class", "node-group internet-group")
      .attr("data-id", "internet")
      .attr("data-type", "internet");

    grp
      .append("rect")
      .attr("class", "internet-cloud")
      .attr("x", n.x)
      .attr("y", n.y)
      .attr("width", n.w)
      .attr("height", n.h);

    grp
      .append("text")
      .attr("class", "internet-label")
      .attr("x", n.x + n.w / 2)
      .attr("y", n.y + n.h / 2 + 5)
      .attr("text-anchor", "middle")
      .text("INTERNET");
  }

  function drawVpc(g, v) {
    const vpcG = g.append("g").attr("class", "vpc-group");

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
    const sg = g.append("g").attr("class", "subnet-group");

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
    const grp = g
      .append("g")
      .attr("class", "node-group")
      .attr("data-id", n.id)
      .attr("data-type", n.type);

    grp
      .append("circle")
      .attr("class", "pulse")
      .attr("cx", n.x + n.w / 2)
      .attr("cy", n.y + n.h / 2)
      .attr("r", n.h / 2 + 6);

    grp
      .append("rect")
      .attr("class", "node-bg")
      .attr("x", n.x)
      .attr("y", n.y)
      .attr("width", n.w)
      .attr("height", n.h);

    // Icon
    const cy = n.y + n.h / 2;
    grp
      .append("circle")
      .attr("class", "icon-circle")
      .attr("cx", n.x + 22)
      .attr("cy", cy)
      .attr("r", 16);

    grp
      .append("text")
      .attr("class", "icon-glyph")
      .attr("x", n.x + 22)
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
    svg.transition().duration(400).call(zoomBehavior.transform, d3.zoomIdentity);
  }

  window.AwsViz = {
    render,
    resetZoom,
    onSelect: null,
    onSelectFlow: null,
  };
})();
