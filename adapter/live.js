// Live ZeroBias fetch — pulls tenant data from the ZeroBias platform and
// normalises it into the export shape that zerobias-adapter.transform() consumes.
//
// Auth mirrors the documented ZeroBias MCP setup (docs/MCPs.md in
// zerobias-org/zerobias): an API key + org id sent as headers.
//   ZEROBIAS_API_KEY   -> Authorization: ApiKey <key>
//   ZEROBIAS_ORG_ID    -> dana-org-id: <org>
//   ZEROBIAS_BASE_URL  -> defaults to https://api.app.zerobias.com
//
// NOTE: the exact tenant query path/params for AuditgraphDB assets live in
// ZeroBias's proprietary platform API, so the endpoints below are configurable
// and should be confirmed against a live tenant (e.g. via the `zb` MCP's
// `zerobias_describe`). Everything here is gated on credentials being present;
// with none set the CLI falls back to the local sample file.
"use strict";

const DEFAULT_BASE = "https://api.app.zerobias.com";

function creds(env) {
  env = env || process.env;
  return {
    apiKey: env.ZEROBIAS_API_KEY || env.DANA_API_KEY || null,
    orgId: env.ZEROBIAS_ORG_ID || env.DANA_ORG_ID || null,
    baseUrl: (env.ZEROBIAS_BASE_URL || DEFAULT_BASE).replace(/\/$/, ""),
  };
}

function hasCreds(env) {
  const c = creds(env);
  return Boolean(c.apiKey && c.orgId);
}

function headers(c) {
  return {
    Authorization: `ApiKey ${c.apiKey}`,
    "dana-org-id": c.orgId,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function getJson(url, c) {
  const res = await fetch(url, { headers: headers(c) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GET ${url} -> ${res.status} ${res.statusText}${body ? `\n${body.slice(0, 400)}` : ""}`);
  }
  return res.json();
}

// Pull the raw collections we need and hand them to normalize(). `paths` is
// overridable so you can point at whatever your tenant exposes without editing
// this file (CLI flag --endpoint name=path, or env ZEROBIAS_PATH_<NAME>).
async function fetchExport(opts) {
  opts = opts || {};
  const c = creds(opts.env);
  if (!c.apiKey || !c.orgId) {
    throw new Error("Live mode needs ZEROBIAS_API_KEY and ZEROBIAS_ORG_ID (see adapter/README.md).");
  }
  const paths = Object.assign(
    {
      assets: "/auditgraph/assets",
      accounts: "/auditgraph/accounts",
      networks: "/auditgraph/networks",
      relationships: "/auditgraph/relationships",
    },
    opts.paths || {},
  );

  const out = { org: c.orgId, source: "zerobias-live" };
  for (const [name, path] of Object.entries(paths)) {
    if (!path) continue;
    try {
      const data = await getJson(c.baseUrl + path, c);
      out[name] = Array.isArray(data) ? data : data.items || data.results || data.data || [];
    } catch (err) {
      // Non-fatal: a tenant may not expose every collection. Surface and skip.
      out._warnings = out._warnings || [];
      out._warnings.push(`${name}: ${err.message.split("\n")[0]}`);
      out[name] = [];
    }
  }
  return normalize(out);
}

// Map raw AuditgraphDB objects onto the adapter's input contract. AuditgraphDB
// nests network facts as documents on each asset; this flattens the field
// names the transform expects. Defensive about shape so partial data still
// produces something.
function normalize(raw) {
  const pick = (o, ...keys) => keys.map((k) => o && o[k]).find((v) => v != null);

  const assets = (raw.assets || []).map((a) => ({
    id: pick(a, "id", "_id", "key", "name"),
    name: pick(a, "name", "hostname", "displayName") || pick(a, "id"),
    type: pick(a, "type", "assetType") || "UNKNOWN",
    criticality: pick(a, "criticality"),
    status: pick(a, "status"),
    segmentId: pick(a, "segmentId", "subnetId", "networkSegment"),
    networkInterfaces: (a.networkInterfaces || a.nics || []).map((n) => ({
      deviceName: pick(n, "deviceName", "name"),
      macAddress: pick(n, "macAddress", "mac"),
      ipInterface: (n.ipInterface || n.ipInterfaces || n.addresses || []).map((ip) => ({
        address: pick(ip, "address", "ip", "ipAddress"),
        netmask: pick(ip, "netmask", "mask", "prefix"),
        gateway: pick(ip, "gateway"),
        hostname: pick(ip, "hostname"),
        ipVersion: pick(ip, "ipVersion"),
      })),
    })),
    ipRoutes: (a.ipRoutes || a.routes || []).map((r) => ({
      destination: pick(r, "destination", "dest"),
      gateway: pick(r, "gateway"),
      genmask: pick(r, "genmask", "mask"),
      iface: pick(r, "iface", "interface"),
      metric: pick(r, "metric"),
    })),
    firewallRules: (a.firewallRules || a.firewall || []).map((r) => ({
      protocol: pick(r, "protocol"),
      portRange: pick(r, "portRange", "ports", "port"),
      addresses: r.addresses || (r.address ? [r.address] : []),
      action: pick(r, "action", "effect"),
    })),
    endpoints: (a.endpoints || a.listeners || []).map((e) => ({
      address: pick(e, "address", "ip"),
      port: pick(e, "port"),
      ipProtocol: pick(e, "ipProtocol", "protocol"),
      hostname: pick(e, "hostname"),
    })),
  }));

  const accounts = (raw.accounts || raw.principals || []).map((p) => ({
    id: pick(p, "id", "_id", "username", "name"),
    name: pick(p, "name", "username", "displayName") || pick(p, "id"),
    type: pick(p, "type", "accountType") || "USER",
    principalType: pick(p, "principalType"),
    status: pick(p, "status", "accountStatus"),
    permissionSets: (p.permissionSets || p.permissions || []).map((ps) => ({
      resourceId: pick(ps, "resourceId", "resource", "to", "assetId"),
      allow: ps.allow || [],
      deny: ps.deny || [],
    })),
  }));

  return {
    org: raw.org,
    source: raw.source,
    region: raw.region,
    networks: raw.networks || [],
    segments: raw.segments || [],
    assets,
    accounts,
    relationships: raw.relationships || raw.connections || [],
    _warnings: raw._warnings,
  };
}

module.exports = { fetchExport, normalize, hasCreds, creds };
