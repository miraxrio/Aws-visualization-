# ZeroBias → Network Visualizer adapter

Turns a [ZeroBias](https://auditmation.io/) (Auditmation) data export into the
JSON this visualizer renders, so collected audit/infrastructure evidence can be
viewed as a 2D/3D network topology.

```bash
node adapter/cli.js                 # sample export → adapter/zerobias-network.json
node adapter/cli.js --identity      # + identity/access overlay (principals & permissions)
node adapter/cli.js --live          # pull from a live tenant (needs API key, see below)
```

Then open `index.html` → **Import network** → pick the generated file (or drag it
onto the canvas).

---

## What ZeroBias actually exposes (verification)

Checked against the public `@zerobias-org/schema` (AuditgraphDB base) and a real
integration module (`@zerobias-org/module-avigilon-alta-access`):

| You asked | In ZeroBias | Source of truth |
|-----------|-------------|-----------------|
| **Networks** | `networkInterface`, `ipInterface`, `ipRoute`, `firewall.rule`, `endpoint`, `ServiceEndpoint`, `asset.type` (`FIREWALL`, devices) | `schema/.../zerobias/base/documents/*`, `enums/asset.type.yml` |
| **Users** | `accountType`, `accountStatus`, `principalType`, `partyType`, `partyRole`, `permissionSet`, `role.*`, `passwordPolicy`; module `user`/`group`/`role` ops | `schema .../enums`, `documents/permissionSet.yml`, module `api.yml` tags |
| **Logins** | `authType`, `accessCredential.*`; module `auth` + **`audit`** log operations | `schema .../enums/authType.yml`, module `api.yml` |
| **Tasks** | Not in the open content schema — a platform/workflow concept in the proprietary SDK (~1,200 ops) | `zb` MCP (`@zerobias-com/zerobias-mcp`) |

**Key caveat.** The open schema is **host/interface centric**, not cloud-native:
`asset.type` is `LAPTOP / DESKTOP / MOBILE / TABLET / FIREWALL / CA / ENTITY /
UNKNOWN` — there is no first-class `VPC` / `EC2` / `Subnet` class in the public
schema. Native cloud-resource classes and the AWS/Azure collector modules live
in ZeroBias's **proprietary `@auditlogic` scope**. This adapter therefore maps
the *open* evidence model (hosts + interfaces + routes + firewall rules +
identities) onto the visualizer's VPC/subnet/resource/flow model, inferring the
cloud structure. When you point `--live` at a tenant that has the cloud modules,
confirm the exact field/endpoint names (via the `zb` MCP's `zerobias_describe`)
and adjust the path overrides — the transform itself stays the same.

---

## Input contract

A ZeroBias export (`adapter/sample-zerobias-export.json` is a worked example):

```jsonc
{
  "org": "acme", "name": "...", "region": "us-east-1",
  "networks":  [ { "id", "name", "cidr", "region" } ],          // → VPCs
  "segments":  [ { "id", "networkId", "name", "cidr",           // → subnets
                   "tier?", "zone?", "vlanId?" } ],
  "assets":    [ {                                               // → resources
      "id", "name", "type",                  // asset.type enum
      "segmentId?",                          // explicit subnet, else inferred from IP
      "networkInterfaces": [ { "ipInterface": [ { "address", "netmask", "gateway" } ] } ],
      "ipRoutes":      [ { "destination", "genmask", "gateway", "iface" } ],
      "firewallRules": [ { "protocol", "portRange", "addresses", "action" } ],
      "endpoints":     [ { "address", "port", "ipProtocol" } ]
  } ],
  "relationships": [ { "from", "to", "protocol?", "port?", "label?" } ], // → flows
  "accounts":      [ { "id", "name", "type",                    // → identity overlay
                       "permissionSets": [ { "resourceId", "allow", "deny" } ] } ]
}
```

Field names mirror the AuditgraphDB documents. `live.js` `normalize()` is tolerant
of common aliases (`nics`, `routes`, `listeners`, `ip`, `mask`, …).

## Mapping rules

- **VPC** ← `network`. **Subnet** ← `segment` (or a `/24` derived from asset IPs).
- **Tier** ← explicit `segment.tier`, else inferred: public if a member asset
  allows inbound from `0.0.0.0/0` on a web port (or the name says dmz/edge);
  data if members are all DB/cache services (or the name says data/db);
  otherwise private.
- **Resource type** ← `asset.type`, refined by listening port and name
  (`FIREWALL→waf`, `5432→rds`, `6379→redis`, `:443 + lb-ish name→alb`,
  `api/svc→ecs`, host → `ec2`).
- **Gateways** are synthesised from routing: one **IGW** per VPC with a public
  subnet; a **NAT** per public subnet; private/data assets with a default route
  get an `egress` flow to a NAT, and each NAT an `egress` flow to the IGW.
- **Flows** ← `relationships` (east-west), `firewall.rule` allowing the internet
  (ingress), and the synthesised egress chain.
- **Identity overlay** (`--identity`) ← `accounts`/`permissionSets`, rendered as
  a separate `Identity & Access` VPC with `principal → resource` access edges.
  This is an **extension** beyond the tool's native network model (the palette
  has no first-class user node); principal nodes default to the `ec2` shape
  (`--identity-type` to change).

## Live mode

```bash
export ZEROBIAS_API_KEY=...        # → Authorization: ApiKey <key>
export ZEROBIAS_ORG_ID=...         # → dana-org-id: <org>
# export ZEROBIAS_BASE_URL=https://api.app.zerobias.com   # (default)
node adapter/cli.js --live --pretty
```

Auth mirrors the documented ZeroBias MCP setup. Collection paths are
configurable because the tenant query API is proprietary:

```bash
node adapter/cli.js --live --endpoint assets=/your/assets/path \
                           --endpoint accounts=/your/accounts/path
```

A tenant that doesn't expose a given collection just yields a warning and an
empty set — the rest still renders.

## Files

| File | Purpose |
|------|---------|
| `zerobias-adapter.js` | pure transform (`transform`, `validate`) — Node + browser |
| `live.js` | live tenant fetch + `normalize()` to the input contract |
| `cli.js` | command-line entry point |
| `sample-zerobias-export.json` | worked example input |
| `zerobias-network.json` | generated output (load this in the app) |
