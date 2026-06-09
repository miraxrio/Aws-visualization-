// ZeroBias → AWS/Azure Network Visualizer adapter.
//
// Pure, dependency-free transform. Takes a ZeroBias AuditgraphDB-style export
// (assets + network interfaces + routes + firewall rules + endpoints, plus
// optional accounts/principals) and emits the JSON shape the visualizer's
// loadData() expects: { name, region, vpcs:[{ subnets, gateways, resources }], flows }.
//
// The input contract mirrors the real open `@zerobias-org/schema` (AuditgraphDB
// base): networkInterface / ipInterface / ipRoute / firewall.rule / endpoint /
// permissionSet documents and the asset.type / accountType / principalType enums.
// See adapter/README.md for the field-by-field mapping and the verification notes.
//
// Works in Node (module.exports) and in the browser (window.ZeroBiasAdapter).
(function (root) {
  "use strict";

  // --- Mapping tables ----------------------------------------------------

  // asset.type (open schema enum) → visualizer resource `type`. The open
  // schema's asset.type is endpoint/device-centric (no native VPC/EC2), so we
  // map devices to the closest compute box and refine with listening ports.
  const ASSET_TYPE_TO_VIZ = {
    FIREWALL: "waf",
    LAPTOP: "ec2",
    DESKTOP: "ec2",
    MOBILE: "ec2",
    TABLET: "ec2",
    CA: "endpoint",
    ENTITY: "endpoint",
    UNKNOWN: "ec2",
  };

  // Listening port → a more specific visualizer type. Applied when the asset
  // is a generic host so a Postgres box reads as a database, a 6379 box as a
  // cache, etc. Keeps the diagram legible.
  const PORT_TO_VIZ = {
    443: "alb", 80: "alb", 8080: "alb",
    5432: "rds", 3306: "rds", 1433: "rds", 5433: "rds",
    9200: "rds", 9300: "rds", 27017: "rds",
    6379: "redis",
    53: "route53",
  };

  // Ports that mark a host as a data-tier service (used for tier inference).
  const DATA_PORTS = new Set([5432, 3306, 1433, 5433, 6379, 9200, 9300, 27017, 1521]);
  // Public-facing ingress ports (used to detect a public/DMZ segment).
  const WEB_PORTS = new Set([80, 443, 8080, 8443]);
  const ANY_CIDR = new Set(["0.0.0.0/0", "0.0.0.0", "::/0", "any", "ANY", "*"]);

  // --- Small helpers -----------------------------------------------------

  const isDataType = (t) => t === "rds" || t === "aurora" || t === "redis" || t === "dynamodb" || t === "s3";
  const norm = (v) => (v == null ? "" : String(v));
  const lc = (v) => norm(v).toLowerCase();

  // Parse a dotted-quad netmask (255.255.255.0) into a prefix length (24).
  function maskToPrefix(mask) {
    if (mask == null) return null;
    if (/^\d{1,2}$/.test(String(mask))) return Number(mask); // already a prefix
    const parts = String(mask).split(".").map(Number);
    if (parts.length !== 4 || parts.some((n) => isNaN(n))) return null;
    return parts.reduce((acc, n) => acc + ((n >>> 0).toString(2).match(/1/g) || []).length, 0);
  }

  // Network address of an IPv4 given a prefix, e.g. 10.0.1.37/24 -> "10.0.1.0".
  function networkOf(ip, prefix) {
    const o = norm(ip).split(".").map(Number);
    if (o.length !== 4 || o.some(isNaN) || prefix == null) return null;
    const ipNum = ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    const net = (ipNum & mask) >>> 0;
    return [(net >>> 24) & 255, (net >>> 16) & 255, (net >>> 8) & 255, net & 255].join(".");
  }

  // Collect every ipInterface address declared on an asset's NICs.
  function assetAddresses(asset) {
    const out = [];
    (asset.networkInterfaces || []).forEach((nic) => {
      const ifaces = nic.ipInterface || nic.ipInterfaces || [];
      ifaces.forEach((ip) => {
        if (ip && ip.address) out.push({ address: ip.address, netmask: ip.netmask, gateway: ip.gateway });
      });
    });
    // Some exports attach addresses directly on endpoints rather than NICs.
    (asset.endpoints || []).forEach((e) => e && e.address && out.push({ address: e.address }));
    return out;
  }

  function assetPorts(asset) {
    return (asset.endpoints || [])
      .map((e) => Number(e && e.port))
      .filter((p) => !isNaN(p));
  }

  // Does this asset accept inbound traffic from the public internet?
  function hasInternetIngress(asset) {
    return (asset.firewallRules || []).some((r) => {
      const allow = lc(r.action) === "allow" || lc(r.action) === "accept" || lc(r.effect) === "allow";
      const fromAny = (r.addresses || [r.address]).some((a) => ANY_CIDR.has(norm(a)));
      const port = Number(String(r.portRange || r.port || "").split("-")[0]);
      return allow && fromAny && (WEB_PORTS.has(port) || isNaN(port));
    });
  }

  // A default route (0.0.0.0/0) means the asset has egress to a gateway.
  function defaultRoute(asset) {
    return (asset.ipRoutes || []).find(
      (r) => ANY_CIDR.has(norm(r.destination)) || norm(r.destination) === "default",
    );
  }

  // --- Classification ----------------------------------------------------

  // Decide the visualizer `type` for an asset: start from asset.type, then
  // refine using listening ports and the asset name.
  function classifyAsset(asset) {
    const base = ASSET_TYPE_TO_VIZ[norm(asset.type).toUpperCase()] || "ec2";
    if (base === "waf" || base === "endpoint") return base; // firewalls / certs are unambiguous
    const name = lc(asset.name);
    const ports = assetPorts(asset);

    // Database / cache ports win first — they're the most informative.
    for (const p of ports) {
      const m = PORT_TO_VIZ[p];
      if (m && m !== "alb") return m;
    }
    if (/(^|[-_ ])(alb|elb|lb|balancer|ingress|gateway)([-_ ]|$)/.test(name)) return "alb";
    if (/(nat)/.test(name)) return "nat";
    if (/(lambda|fn|function|worker)/.test(name)) return "lambda";
    if (/(ecs|fargate|container|svc|service|api|app)/.test(name)) return "ecs";
    if (/(cache|redis)/.test(name)) return "redis";
    if (/(db|sql|postgres|aurora|mysql|rds)/.test(name)) return "rds";
    if (/(bucket|s3|object|storage)/.test(name)) return "s3";
    // A host that only serves web ports and nothing else is most likely an app box.
    if (ports.some((p) => WEB_PORTS.has(p))) return "ecs";
    return base;
  }

  // --- Subnet / tier model ----------------------------------------------

  // Build the subnet list, resolving each asset to a segment. Segments may be
  // declared explicitly; otherwise we derive them from asset IP/netmask.
  function buildSegments(zb) {
    const segments = new Map(); // id -> segment record
    const assetSegment = new Map(); // assetId -> segId

    (zb.segments || []).forEach((s) => {
      segments.set(s.id, {
        id: s.id,
        networkId: s.networkId || (zb.networks && zb.networks[0] && zb.networks[0].id) || "net",
        name: s.name || s.id,
        cidr: s.cidr || null,
        tier: s.tier || null,
        az: s.zone || s.az || null,
        vlanId: s.vlanId,
        assets: [],
      });
    });

    // Resolve each asset to a segment: explicit segmentId, then CIDR match,
    // then a derived /24 segment.
    (zb.assets || []).forEach((asset) => {
      let segId = asset.segmentId || asset.subnetId || null;

      if (!segId) {
        const addrs = assetAddresses(asset);
        // Try to land the asset in a declared segment by CIDR containment.
        for (const seg of segments.values()) {
          if (!seg.cidr) continue;
          const [base, pfx] = seg.cidr.split("/");
          const prefix = Number(pfx);
          if (addrs.some((a) => networkOf(a.address, prefix) === networkOf(base, prefix))) {
            segId = seg.id;
            break;
          }
        }
      }

      if (!segId) {
        // Derive a /24 segment from the first address.
        const a = assetAddresses(asset)[0];
        if (a) {
          const prefix = maskToPrefix(a.netmask) || 24;
          const net = networkOf(a.address, prefix);
          segId = net ? `seg-${net}-${prefix}` : "seg-unzoned";
          if (!segments.has(segId)) {
            segments.set(segId, {
              id: segId,
              networkId: (zb.networks && zb.networks[0] && zb.networks[0].id) || "net",
              name: net ? `${net}/${prefix}` : "Unzoned",
              cidr: net ? `${net}/${prefix}` : null,
              tier: null,
              az: a.gateway ? null : null,
              assets: [],
            });
          }
        } else {
          segId = "seg-unzoned";
          if (!segments.has(segId)) {
            segments.set(segId, { id: segId, networkId: (zb.networks && zb.networks[0] && zb.networks[0].id) || "net", name: "Unzoned", cidr: null, tier: null, az: null, assets: [] });
          }
        }
      }

      assetSegment.set(asset.id, segId);
      const seg = segments.get(segId);
      if (seg) seg.assets.push(asset);
    });

    // Infer a tier for any segment that didn't declare one.
    for (const seg of segments.values()) {
      if (seg.tier) continue;
      seg.tier = inferTier(seg);
    }

    return { segments, assetSegment };
  }

  function inferTier(seg) {
    const name = lc(seg.name) + " " + lc(seg.id);
    if (/(public|dmz|edge|external|ingress)/.test(name)) return "public";
    if (/(data|db|database|storage|persistence)/.test(name)) return "data";
    if (/(private|app|internal|backend|compute)/.test(name)) return "private";

    const assets = seg.assets || [];
    if (assets.some(hasInternetIngress)) return "public";
    const allData =
      assets.length > 0 &&
      assets.every((a) => assetPorts(a).some((p) => DATA_PORTS.has(p)) || isDataType(classifyAsset(a)));
    if (allData) return "data";
    return "private";
  }

  // --- Main transform ----------------------------------------------------

  function transform(zb, opts) {
    opts = opts || {};
    if (!zb || typeof zb !== "object") throw new Error("transform: expected a ZeroBias export object");

    const networks =
      zb.networks && zb.networks.length
        ? zb.networks
        : [{ id: "net", name: zb.org ? `${zb.org} network` : "Network", cidr: null, region: zb.region || null }];
    const region = zb.region || networks[0].region || null;

    const { segments, assetSegment } = buildSegments(zb);

    // Group segments under their network → VPCs.
    const vpcMap = new Map();
    networks.forEach((n) => {
      vpcMap.set(n.id, {
        id: n.id,
        name: n.name || n.id,
        cidr: n.cidr || undefined,
        region: n.region || region || undefined,
        subnets: [],
        gateways: [],
        resources: [],
      });
    });
    const firstVpcId = networks[0].id;
    const vpcOf = (segId) => {
      const seg = segments.get(segId);
      const nid = (seg && seg.networkId) || firstVpcId;
      return vpcMap.get(nid) || vpcMap.get(firstVpcId);
    };

    // Subnets, with a stable AZ per segment.
    let azCursor = 0;
    const azFor = (seg) => seg.az || `${region || networks[0].id}-${String.fromCharCode(97 + (azCursor++ % 3))}`;
    for (const seg of segments.values()) {
      const vpc = vpcMap.get(seg.networkId) || vpcMap.get(firstVpcId);
      if (!vpc) continue;
      vpc.subnets.push({
        id: seg.id,
        name: seg.name,
        cidr: seg.cidr || undefined,
        tier: seg.tier,
        az: azFor(seg),
      });
    }

    // Resources (assets) placed in their segment.
    const nodeType = new Map(); // id -> viz type (for flow inference)
    (zb.assets || []).forEach((asset) => {
      const segId = assetSegment.get(asset.id);
      const vpc = vpcOf(segId);
      const type = classifyAsset(asset);
      nodeType.set(asset.id, type);
      vpc.resources.push({
        id: asset.id,
        type,
        name: asset.name || asset.id,
        subnet: segId,
      });
    });

    // Gateways synthesised from routing: one IGW per VPC that has a public
    // subnet; a NAT per non-public subnet that has egress, anchored to a
    // public subnet in the same VPC.
    const flows = [];
    const seenFlow = new Set();
    const pushFlow = (f) => {
      const key = `${f.from}|${f.to}|${f.label || ""}`;
      if (seenFlow.has(key)) return;
      seenFlow.add(key);
      flows.push(f);
    };

    vpcMap.forEach((vpc) => {
      const publicSubnets = vpc.subnets.filter((s) => s.tier === "public");
      const igwId = `igw-${vpc.id}`;
      if (publicSubnets.length) {
        vpc.gateways.push({ id: igwId, type: "igw", name: "Internet Gateway" });
      }
      // One NAT per public subnet (HA pattern), used as egress anchor.
      const natBySubnet = new Map();
      publicSubnets.forEach((ps) => {
        const natId = `nat-${ps.id}`;
        vpc.gateways.push({ id: natId, type: "nat", name: `NAT ${ps.az || ps.name}`, subnet: ps.id });
        natBySubnet.set(ps.az, natId);
        if (publicSubnets.length) pushFlow({ from: natId, to: igwId, label: "0.0.0.0/0", kind: "egress" });
      });

      // Egress: non-public assets with a default route hop through a NAT.
      vpc.resources.forEach((r) => {
        const sub = vpc.subnets.find((s) => s.id === r.subnet);
        if (!sub || sub.tier === "public") return;
        const asset = (zb.assets || []).find((a) => a.id === r.id);
        if (!asset || !defaultRoute(asset)) return;
        const nat = natBySubnet.get(sub.az) || [...natBySubnet.values()][0];
        if (nat) pushFlow({ from: r.id, to: nat, label: "egress", kind: "egress" });
      });
    });

    // Internet ingress flows for public-facing assets.
    (zb.assets || []).forEach((asset) => {
      if (!hasInternetIngress(asset)) return;
      const port = assetPorts(asset).find((p) => WEB_PORTS.has(p));
      pushFlow({ from: "internet", to: asset.id, label: port ? `:${port}` : "inbound", kind: "internet" });
    });

    // Explicit collected connections (relationships) → east-west flows.
    (zb.relationships || zb.connections || []).forEach((rel) => {
      if (!rel || !rel.from || !rel.to) return;
      const label = rel.label || [rel.protocol, rel.port].filter(Boolean).join(" ") || undefined;
      pushFlow({ from: rel.from, to: rel.to, label });
    });

    const result = {
      name: zb.name || (zb.org ? `${zb.org} — ZeroBias import` : "ZeroBias import"),
      region: region || undefined,
      vpcs: [...vpcMap.values()].filter((v) => v.subnets.length || v.resources.length),
      flows,
    };

    // Optional identity overlay: render principals/accounts as their own VPC
    // with permission-set edges to the resources they can reach. This is an
    // EXTENSION beyond the tool's native network model (no first-class user
    // node) — see README.
    if (opts.identity && (zb.accounts || zb.principals || []).length) {
      applyIdentityOverlay(result, zb, opts);
    }

    return result;
  }

  function applyIdentityOverlay(result, zb, opts) {
    const principals = zb.accounts || zb.principals || [];
    const principalType = opts.identityType || "ec2"; // no native "user" type in the palette
    const idVpc = {
      id: "iam",
      name: "Identity & Access",
      subnets: [{ id: "principals", name: "Principals", tier: "private", az: "identity" }],
      gateways: [],
      resources: [],
    };
    const knownIds = new Set();
    result.vpcs.forEach((v) => v.resources.forEach((r) => knownIds.add(r.id)));

    principals.forEach((p) => {
      idVpc.resources.push({
        id: p.id,
        type: principalType,
        name: p.name || p.id,
        subnet: "principals",
      });
      (p.permissionSets || []).forEach((ps) => {
        const target = ps.resourceId || ps.resource || ps.to;
        if (!target || !knownIds.has(target)) return;
        const allow = (ps.allow || []).join("/");
        result.flows.push({ from: p.id, to: target, label: allow ? `allow ${allow}` : "access" });
      });
    });

    result.vpcs.push(idVpc);
  }

  // --- Validation (handy for callers / CLI) ------------------------------

  // Light structural check against what loadData() needs. Returns a list of
  // human-readable problems (empty == good).
  function validate(net) {
    const problems = [];
    if (!net || !Array.isArray(net.vpcs) || !net.vpcs.length) {
      problems.push("no vpcs[] produced");
      return problems;
    }
    const ids = new Set();
    net.vpcs.forEach((v) => {
      (v.subnets || []).forEach((s) => {
        ids.add(s.id);
        if (!["public", "private", "data"].includes(s.tier)) {
          problems.push(`subnet ${s.id} has non-standard tier "${s.tier}"`);
        }
      });
      (v.gateways || []).forEach((g) => ids.add(g.id));
      (v.resources || []).forEach((r) => ids.add(r.id));
    });
    (net.flows || []).forEach((f) => {
      if (f.from !== "internet" && !ids.has(f.from)) problems.push(`flow.from "${f.from}" is not a known node`);
      if (f.to !== "internet" && !ids.has(f.to)) problems.push(`flow.to "${f.to}" is not a known node`);
    });
    return problems;
  }

  const api = { transform, validate, classifyAsset, inferTier };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZeroBiasAdapter = api;
})(typeof window !== "undefined" ? window : globalThis);
