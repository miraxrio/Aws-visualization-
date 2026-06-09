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
"use strict";

const DEFAULT_HOST = "api.uat.zerobias.com";

// ---- transport --------------------------------------------------------

function connFromEnv(env) {
  env = env || process.env;
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

// Inventory selection sets (best-effort standard AWS field names).
const QUERIES = {
  iamUsers: `query { AwsIamUser { name arn mfaEnabled awsAccountId } }`,
  vpcs: `query { AwsVpc { vpcId cidrBlock region awsAccountId tags { key value } } }`,
  subnets: `query { AwsSubnet { subnetId vpcId cidrBlock availabilityZone mapPublicIpOnLaunch tags { key value } } }`,
  internetGateways: `query { AwsInternetGateway { internetGatewayId attachments { vpcId } } }`,
  natGateways: `query { AwsNatGateway { natGatewayId subnetId vpcId } }`,
  routeTables: `query { AwsRouteTable { routeTableId vpcId associations { subnetId main } routes { destinationCidrBlock gatewayId natGatewayId } } }`,
  instances: `query { AwsEc2Instance { instanceId subnetId vpcId privateIpAddress publicIpAddress securityGroupIds tags { key value } } }`,
  securityGroups: `query { AwsSecurityGroup { groupId vpcId ipPermissions { fromPort toPort ipProtocol ipRanges { cidrIp } userIdGroupPairs { groupId } } } }`,
  loadBalancers: `query { AwsLoadBalancer { loadBalancerArn name type scheme vpcId subnets } }`,
  rds: `query { AwsRdsInstance { dbInstanceIdentifier engine vpcId subnetIds tags { key value } } }`,
  lambdas: `query { AwsLambdaFunction { functionName vpcId subnetIds } }`,
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
  const name = (tagName(sn) || sn.subnetId || "").toLowerCase();
  if (/(data|db|database)/.test(name)) return "data";
  if (/public|dmz/.test(name)) return "public";
  if (/private|app|internal/.test(name)) return "private";
  if (sn.mapPublicIpOnLaunch === true) return "public";
  const eg = subnetEgress(sn.subnetId, routeTables);
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
      const v = vpcsIn.find((x) => x.vpcId === vpcId);
      vpcMap.set(vpcId, {
        id: vpcId,
        name: (v && tagName(v)) || vpcId,
        cidr: (v && v.cidrBlock) || undefined,
        region: (v && v.region) || undefined,
        subnets: [],
        gateways: [],
        resources: [],
      });
    }
    return vpcMap.get(vpcId);
  };
  vpcsIn.forEach((v) => ensureVpc(v.vpcId));

  // Subnets
  const subnetVpc = new Map();
  subnetsIn.forEach((sn) => {
    const vpc = ensureVpc(sn.vpcId);
    subnetVpc.set(sn.subnetId, sn.vpcId);
    vpc.subnets.push({
      id: sn.subnetId,
      name: tagName(sn) || sn.subnetId,
      cidr: sn.cidrBlock || undefined,
      tier: subnetTier(sn, routeTables),
      az: sn.availabilityZone || undefined,
    });
  });

  // Gateways
  (raw.internetGateways || []).forEach((ig) => {
    const vpcId = (ig.attachments && ig.attachments[0] && ig.attachments[0].vpcId) || ig.vpcId;
    const vpc = vpcId && vpcMap.get(vpcId);
    if (vpc) vpc.gateways.push({ id: ig.internetGatewayId, type: "igw", name: "Internet Gateway" });
  });
  (raw.natGateways || []).forEach((ng) => {
    const vpc = vpcMap.get(ng.vpcId) || (ng.subnetId && vpcMap.get(subnetVpc.get(ng.subnetId)));
    if (vpc) vpc.gateways.push({ id: ng.natGatewayId, type: "nat", name: "NAT Gateway", subnet: ng.subnetId });
  });

  // Resources
  const nodeVpc = new Map(); // resourceId -> vpc
  const place = (id, type, name, subnetId, vpcId) => {
    const vpc = vpcMap.get(vpcId) || (subnetId && vpcMap.get(subnetVpc.get(subnetId))) || ensureVpc(vpcId);
    vpc.resources.push({ id, type, name: name || id, subnet: subnetId || (vpc.subnets[0] && vpc.subnets[0].id) });
    nodeVpc.set(id, vpc);
  };
  (raw.instances || []).forEach((i) =>
    place(i.instanceId, "ec2", tagName(i) || i.instanceId, i.subnetId, i.vpcId),
  );
  (raw.loadBalancers || []).forEach((lb) =>
    place(lb.loadBalancerArn || lb.name, /network/i.test(lb.type) ? "nlb" : "alb", lb.name, (lb.subnets || [])[0], lb.vpcId),
  );
  (raw.rds || []).forEach((db) =>
    place(db.dbInstanceIdentifier, /aurora/i.test(db.engine || "") ? "aurora" : "rds", db.dbInstanceIdentifier, (db.subnetIds || [])[0], db.vpcId),
  );
  (raw.lambdas || []).forEach((fn) =>
    place(fn.functionName, "lambda", fn.functionName, (fn.subnetIds || [])[0], fn.vpcId),
  );

  // Flows
  const flows = [];
  const seen = new Set();
  const push = (f) => { const k = `${f.from}|${f.to}|${f.label || ""}`; if (!seen.has(k)) { seen.add(k); flows.push(f); } };

  // map securityGroupId -> node ids, across every resource that carries SGs
  // (instances, load balancers, databases) so SG-referenced rules connect the
  // whole path (internet → ALB → app → db), not just EC2-to-EC2.
  const sgNodes = [
    ...(raw.instances || []).map((i) => ({ id: i.instanceId, sgs: i.securityGroupIds })),
    ...(raw.loadBalancers || []).map((lb) => ({ id: lb.loadBalancerArn || lb.name, sgs: lb.securityGroupIds })),
    ...(raw.rds || []).map((db) => ({ id: db.dbInstanceIdentifier, sgs: db.securityGroupIds })),
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
      if (subnetVpc.get(i.subnetId) !== vpc.id) return;
      const eg = subnetEgress(i.subnetId, routeTables);
      if (eg && eg.nat) {
        push({ from: i.instanceId, to: eg.nat, label: "egress", kind: "egress" });
        if (igw) push({ from: eg.nat, to: igw.id, label: "0.0.0.0/0", kind: "egress" });
      }
    });
  });

  const result = {
    name: opts.name || "AWS inventory (ZeroBias)",
    region: vpcsIn[0] && vpcsIn[0].region,
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

module.exports = {
  connFromEnv, gql, fetchInventory, awsInventoryToVisualizer,
  QUERIES, INTROSPECT_FIELDS, introspectType, DEFAULT_HOST,
};
