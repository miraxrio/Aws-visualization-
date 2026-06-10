// ZeroBias GraphQL client + AWS-inventory → visualizer mapping.
//
// The ZeroBias "boundaries" GraphQL API returns native AWS inventory that was
// ingested from a cloud account (AwsVpc, AwsSubnet, AwsEc2Instance,
// AwsSecurityGroup, AwsIamUser, …). Those map almost 1:1 onto this visualizer's
// own model, so this path is more faithful than the generic asset adapter.
//
// Transport (confirmed from a working call):
//   PUT https://<host>/graphql/boundaries/<boundaryId>?pageSize=<n>
//   headers: Authorization: APIKey <key>, dana-org-id: <org>, Content-Type: application/json
//   body:    { "query": "<graphql>" }
//   filter DSL: Field(arg: ".eq.value")  e.g. AwsIamUser(mfaEnabled: ".eq.false")
//
// NOTE: only AwsIamUser's fields are confirmed. The other selection sets use
// standard AWS field names and should be confirmed against the live schema with
// `introspectQueryFields()` / `--introspect`; the normalizer is alias-tolerant
// so minor naming differences still resolve.
// Runs in Node (CLI, via module.exports) and in the browser (window.ZeroBiasGraphQL),
// so the static visualizer can reuse the exact same AWS-inventory → visualizer
// mapping the CLI uses. The transport functions use the global `fetch` (present
// in modern Node and every browser); only `connFromEnv` touches `process`.
"use strict";
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZeroBiasGraphQL = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

const DEFAULT_HOST = "api.uat.zerobias.com";

// ---- transport --------------------------------------------------------

function connFromEnv(env) {
  env = env || (typeof process !== "undefined" && process.env) || {};
  return {
    host: env.ZEROBIAS_GQL_HOST || DEFAULT_HOST,
    boundaryId: env.ZEROBIAS_BOUNDARY_ID || null,
    apiKey: env.ZEROBIAS_API_KEY || null,
    orgId: env.ZEROBIAS_ORG_ID || null,
    pageSize: Number(env.ZEROBIAS_PAGE_SIZE) || 100,
  };
}

async function gql(conn, query) {
  if (!conn.apiKey || !conn.orgId || !conn.boundaryId) {
    throw new Error("GraphQL needs apiKey, orgId and boundaryId (ZEROBIAS_API_KEY/ORG_ID/BOUNDARY_ID).");
  }
  const url = `https://${conn.host}/graphql/boundaries/${conn.boundaryId}?pageSize=${conn.pageSize || 100}`;
  const res = await fetch(url, {
    method: "PUT", // the boundaries endpoint uses PUT for queries
    headers: {
      Authorization: `APIKey ${conn.apiKey}`,
      "dana-org-id": conn.orgId,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok) throw new Error(`GraphQL ${res.status} ${res.statusText}: ${text.slice(0, 400)}`);
  if (json && json.errors && json.errors.length) {
    throw new Error("GraphQL errors: " + json.errors.map((e) => e.message).join("; "));
  }
  return (json && json.data) || {};
}

// ---- queries ----------------------------------------------------------

// Lists every top-level query field (the available Aws* entry points). Run this
// first against a real tenant to confirm exact type names.
const INTROSPECT_FIELDS = `query { __schema { queryType { fields { name } } } }`;
// Fields of one type: introspectType("AwsSubnet")
const introspectType = (name) =>
  `query { __type(name: "${name}") { name fields { name type { name kind ofType { name kind } } } } }`;

// Inventory selection sets. The live boundary API returns the Auditmation
// AuditgraphDB ontology (verified against a real tenant): types are `AwsVPC` /
// `AwsInstance` / `AwsFunction` (not `AwsVpc` / `AwsEc2Instance` / …) and fields
// are `id` / `name` / `cidr` / `awsRegion` (not `vpcId` / `cidrBlock` / …).
// awsInventoryToVisualizer() below is alias-tolerant so it also still maps the
// AWS-API-shaped offline sample (adapter/sample-aws-inventory.json).
// (Nested `networkInterface { subnet }` selections 500 on the live API, so
// instance→subnet is left to synthesis.)
const QUERIES = {
  iamUsers: `query { AwsIamUser { name arn mfaEnabled awsAccountId } }`,
  vpcs: `query { AwsVPC { id name awsRegion awsAccountId } }`,
  subnets: `query { AwsSubnet { id name cidr awsRegion awsAccountId availabilityZone { name } } }`,
  internetGateways: `query { AwsInternetGateway { id name } }`,
  natGateways: `query { AwsNatGateway { id name } }`,
  instances: `query { AwsInstance { id name awsRegion awsAccountId vpc { id } } }`,
  securityGroups: `query { AwsSecurityGroup { id name vpc { id } } }`,
  lambdas: `query { AwsFunction { id name awsRegion awsAccountId } }`,
  ecs: `query { AwsEcsService { id name awsRegion awsAccountId } }`,
};

async function fetchInventory(conn, only) {
  const want = only && only.length ? only : Object.keys(QUERIES);
  const raw = {};
  const warnings = [];
  for (const key of want) {
    try {
      const data = await gql(conn, QUERIES[key]);
      // top-level field name is the Aws* type; grab the first array in data.
      const arr = Object.values(data).find(Array.isArray) || [];
      raw[key] = arr;
    } catch (err) {
      warnings.push(`${key}: ${err.message.split("\n")[0]}`);
      raw[key] = [];
    }
  }
  if (warnings.length) raw._warnings = warnings;
  return raw;
}

// ---- mapping: AWS inventory → visualizer JSON -------------------------

const tagName = (o) => {
  const tags = (o && o.tags) || [];
  const hit = tags.find((t) => (t.key || t.Key) === "Name");
  return (hit && (hit.value || hit.Value)) || null;
};
const ANY = new Set(["0.0.0.0/0", "0.0.0.0", "::/0"]);
const WEB = new Set([80, 443, 8080, 8443]);

// --- field accessors: tolerant of both the AWS-API shape (offline sample) and
// the AuditgraphDB shape returned by the live boundary API --------------------
const norm = (v) => (v == null ? "" : String(v));
// AuditgraphDB encodes regions as enums like "US_EAST2" / "EU_WEST1"; convert to
// the standard "us-east-2" / "eu-west-1" the map view understands.
function normalizeRegion(r) {
  if (!r) return undefined;
  let s = norm(r).trim();
  if (/^[a-z]{2}-[a-z]+-\d/.test(s)) return s; // already standard
  s = s.toLowerCase().replace(/_/g, "-").replace(/([a-z])(\d)/g, "$1-$2");
  return s || undefined;
}
const vpcIdOf = (o) => (o && (o.vpcId || (o.vpc && (o.vpc.id || o.vpc.vpcId)) || null)) || null;
const regionOf = (o) => (o && (o.region || normalizeRegion(o.awsRegion))) || undefined;
// availabilityZone is a plain string in the AWS-API shape, an object {name} live.
const azNameOf = (o) => {
  const a = o && o.availabilityZone;
  return a == null ? undefined : typeof a === "object" ? a.name : a;
};
// instance → subnet id, if a network interface carries it (best-effort).
const nicSubnet = (i) => {
  const n = i && (i.networkInterface || i.networkInterfaces);
  const first = Array.isArray(n) ? n[0] : n;
  return (first && first.subnet && (first.subnet.id || first.subnet.subnetId)) || undefined;
};

// destination of a subnet's 0.0.0.0/0 route: { igw:true } | { nat:id } | null
function subnetEgress(subnetId, routeTables) {
  let mainRoute = null;
  for (const rt of routeTables || []) {
    const assoc = (rt.associations || []).find((a) => a.subnetId === subnetId);
    const isMain = (rt.associations || []).some((a) => a.main);
    const def = (rt.routes || []).find((r) => ANY.has(r.destinationCidrBlock));
    if (!def) continue;
    const target = def.gatewayId && /^igw-/.test(def.gatewayId) ? { igw: true } : def.natGatewayId ? { nat: def.natGatewayId } : null;
    if (assoc) return target;          // explicit association wins
    if (isMain && !mainRoute) mainRoute = target;
  }
  return mainRoute;                     // fall back to the VPC main route table
}

function subnetTier(sn, routeTables) {
  const name = (tagName(sn) || sn.name || sn.subnetId || sn.id || "").toLowerCase();
  if (/(data|db|database)/.test(name)) return "data";
  if (/public|dmz/.test(name)) return "public";
  if (/private|app|internal/.test(name)) return "private";
  if (sn.mapPublicIpOnLaunch === true) return "public";
  const eg = subnetEgress(sn.subnetId || sn.id, routeTables);
  if (eg && eg.igw) return "public";
  if (eg && eg.nat) return "private";
  return "private";
}

function awsInventoryToVisualizer(raw, opts) {
  opts = opts || {};
  const vpcsIn = raw.vpcs || [];
  const subnetsIn = raw.subnets || [];
  const routeTables = raw.routeTables || [];

  // VPCs
  const vpcMap = new Map();
  const ensureVpc = (vpcId) => {
    if (!vpcId) vpcId = "vpc-unknown";
    if (!vpcMap.has(vpcId)) {
      const v = vpcsIn.find((x) => (x.vpcId || x.id) === vpcId);
      vpcMap.set(vpcId, {
        id: vpcId,
        name: (v && (tagName(v) || v.name)) || vpcId,
        cidr: (v && (v.cidrBlock || v.cidr)) || undefined,
        region: (v && regionOf(v)) || undefined,
        subnets: [],
        gateways: [],
        resources: [],
      });
    }
    return vpcMap.get(vpcId);
  };
  vpcsIn.forEach((v) => ensureVpc(v.vpcId || v.id));

  // When a resource has no VPC (the live boundary often ingests compute/identity
  // without the network layer), synthesise a VPC per AWS account+region so the
  // resources still have a home and land on the right spot on the map.
  const ensureSynthVpc = (o) => {
    const acct = (o && o.awsAccountId) || "account";
    const region = regionOf(o) || "";
    const id = `aws-${acct}${region ? "-" + region : ""}`;
    if (!vpcMap.has(id)) {
      vpcMap.set(id, {
        id,
        name: `AWS account ${acct}${region ? " · " + region : ""}`,
        cidr: undefined,
        region: region || undefined,
        subnets: [],
        gateways: [],
        resources: [],
      });
    }
    return vpcMap.get(id);
  };

  // Subnets
  const subnetVpc = new Map();
  subnetsIn.forEach((sn) => {
    const sId = sn.subnetId || sn.id;
    const vId = vpcIdOf(sn) || ensureSynthVpc(sn).id;
    const vpc = ensureVpc(vId);
    subnetVpc.set(sId, vpc.id);
    vpc.subnets.push({
      id: sId,
      name: tagName(sn) || sn.name || sId,
      cidr: sn.cidrBlock || sn.cidr || undefined,
      tier: subnetTier(sn, routeTables),
      az: azNameOf(sn) || undefined,
    });
  });

  // Gateways
  (raw.internetGateways || []).forEach((ig) => {
    const vpcId = (ig.attachments && ig.attachments[0] && ig.attachments[0].vpcId) || vpcIdOf(ig);
    const vpc = vpcId && vpcMap.get(vpcId);
    if (vpc) vpc.gateways.push({ id: ig.internetGatewayId || ig.id, type: "igw", name: "Internet Gateway" });
  });
  (raw.natGateways || []).forEach((ng) => {
    const vpc = vpcMap.get(vpcIdOf(ng)) || (ng.subnetId && vpcMap.get(subnetVpc.get(ng.subnetId)));
    if (vpc) vpc.gateways.push({ id: ng.natGatewayId || ng.id, type: "nat", name: "NAT Gateway", subnet: ng.subnetId });
  });

  // Resources
  const nodeVpc = new Map(); // resourceId -> vpc
  const place = (id, type, name, subnetId, vpcId, src) => {
    let vpc = (vpcId && vpcMap.get(vpcId)) || (subnetId && vpcMap.get(subnetVpc.get(subnetId)));
    if (!vpc) vpc = src ? ensureSynthVpc(src) : ensureVpc(vpcId);
    // Ensure the resource has a subnet to live in — synthesise a default one
    // when the boundary didn't ingest the network layer.
    let sub = subnetId && subnetVpc.get(subnetId) === vpc.id ? subnetId : vpc.subnets[0] && vpc.subnets[0].id;
    if (!sub) {
      sub = `${vpc.id}-default`;
      vpc.subnets.push({ id: sub, name: "default", tier: "private", az: vpc.region || "—" });
      subnetVpc.set(sub, vpc.id);
    }
    vpc.resources.push({ id, type, name: name || id, subnet: sub });
    nodeVpc.set(id, vpc);
  };
  (raw.instances || []).forEach((i) => {
    const iId = i.instanceId || i.id;
    place(iId, "ec2", tagName(i) || i.name || iId, i.subnetId || nicSubnet(i), vpcIdOf(i), i);
  });
  (raw.loadBalancers || []).forEach((lb) =>
    place(lb.loadBalancerArn || lb.name || lb.id, /network/i.test(lb.type) ? "nlb" : "alb", lb.name, (lb.subnets || [])[0], vpcIdOf(lb), lb),
  );
  (raw.rds || []).forEach((db) =>
    place(db.dbInstanceIdentifier || db.id, /aurora/i.test(db.engine || "") ? "aurora" : "rds", db.dbInstanceIdentifier || db.name, (db.subnetIds || [])[0], vpcIdOf(db), db),
  );
  (raw.lambdas || []).forEach((fn) =>
    place(fn.functionName || fn.id, "lambda", fn.functionName || fn.name, (fn.subnetIds || [])[0], vpcIdOf(fn), fn),
  );
  (raw.ecs || []).forEach((s) =>
    place(s.id || s.name, "ecs", s.name || s.id, undefined, vpcIdOf(s), s),
  );

  // Flows
  const flows = [];
  const seen = new Set();
  const push = (f) => { const k = `${f.from}|${f.to}|${f.label || ""}`; if (!seen.has(k)) { seen.add(k); flows.push(f); } };

  // map securityGroupId -> node ids, across every resource that carries SGs
  // (instances, load balancers, databases) so SG-referenced rules connect the
  // whole path (internet → ALB → app → db), not just EC2-to-EC2.
  const sgNodes = [
    ...(raw.instances || []).map((i) => ({ id: i.instanceId || i.id, sgs: i.securityGroupIds })),
    ...(raw.loadBalancers || []).map((lb) => ({ id: lb.loadBalancerArn || lb.name || lb.id, sgs: lb.securityGroupIds })),
    ...(raw.rds || []).map((db) => ({ id: db.dbInstanceIdentifier || db.id, sgs: db.securityGroupIds })),
  ];
  const sgToNodes = new Map();
  sgNodes.forEach((n) =>
    (n.sgs || []).forEach((sg) => {
      if (!sgToNodes.has(sg)) sgToNodes.set(sg, []);
      sgToNodes.get(sg).push(n.id);
    }),
  );

  (raw.securityGroups || []).forEach((sg) => {
    const targets = sgToNodes.get(sg.groupId) || [];
    if (!targets.length) return;
    (sg.ipPermissions || []).forEach((perm) => {
      const port = perm.fromPort;
      const label = port != null ? `:${port}` : perm.ipProtocol || "allow";
      // internet ingress
      const fromAny = (perm.ipRanges || []).some((r) => ANY.has(r.cidrIp));
      if (fromAny && (port == null || WEB.has(port))) {
        targets.forEach((t) => push({ from: "internet", to: t, label, kind: "internet" }));
      }
      // SG-to-SG references → node-to-node (ALB → app → db, etc.)
      (perm.userIdGroupPairs || []).forEach((pair) => {
        (sgToNodes.get(pair.groupId) || []).forEach((src) =>
          targets.forEach((t) => { if (src !== t) push({ from: src, to: t, label }); }),
        );
      });
    });
  });

  // Egress chain from route tables: instance → nat → igw
  vpcMap.forEach((vpc) => {
    const igw = vpc.gateways.find((g) => g.type === "igw");
    (raw.instances || []).forEach((i) => {
      const iId = i.instanceId || i.id;
      const sId = i.subnetId || nicSubnet(i);
      if (subnetVpc.get(sId) !== vpc.id) return;
      const eg = subnetEgress(sId, routeTables);
      if (eg && eg.nat) {
        push({ from: iId, to: eg.nat, label: "egress", kind: "egress" });
        if (igw) push({ from: eg.nat, to: igw.id, label: "0.0.0.0/0", kind: "egress" });
      }
    });
  });

  const result = {
    name: opts.name || "AWS inventory (ZeroBias)",
    region: regionOf(vpcsIn[0]) || ([...vpcMap.values()].find((v) => v.region) || {}).region,
    vpcs: [...vpcMap.values()].filter((v) => v.subnets.length || v.resources.length),
    flows,
  };

  // IAM users → identity overlay (findings: e.g. MFA-disabled users).
  if (opts.identity && (raw.iamUsers || []).length) {
    const idVpc = { id: "iam", name: "IAM Users", subnets: [{ id: "iam-users", name: "Users", tier: "private", az: "global" }], gateways: [], resources: [] };
    (raw.iamUsers || []).forEach((u) => {
      const flagged = u.mfaEnabled === false ? " ⚠no-MFA" : "";
      idVpc.resources.push({ id: u.arn || u.name, type: opts.identityType || "ec2", name: (u.name || u.arn) + flagged, subnet: "iam-users" });
    });
    result.vpcs.push(idVpc);
  }

  return result;
}

  return {
    connFromEnv, gql, fetchInventory, awsInventoryToVisualizer,
    QUERIES, INTROSPECT_FIELDS, introspectType, DEFAULT_HOST,
  };
});
