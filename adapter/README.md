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

**Two access shapes.** The open schema is **host/interface centric**
(`asset.type` is `LAPTOP / DESKTOP / FIREWALL / …`, no first-class `VPC`/`EC2`).
But a tenant that has ingested a cloud account exposes **native AWS types** via
the boundaries **GraphQL** API — confirmed live: `AwsIamUser { name arn
mfaEnabled awsAccountId }`, and by extension `AwsVpc` / `AwsSubnet` /
`AwsEc2Instance` / `AwsSecurityGroup` / …. Those map almost 1:1 onto this
visualizer, so the GraphQL path (below) is the recommended one for AWS
inventory; the generic asset path is the fallback for non-cloud evidence.

## Native AWS inventory via GraphQL (recommended for AWS)

```bash
# discover the exact Aws* types your boundary exposes
ZEROBIAS_API_KEY=… ZEROBIAS_ORG_ID=… ZEROBIAS_BOUNDARY_ID=… \
  node adapter/cli.js --introspect

# pull inventory and render it
node adapter/cli.js --graphql --boundary <id> --identity --pretty --out adapter/aws-network.json

# offline: map a saved inventory dump (no network)
node adapter/cli.js --graphql --in adapter/sample-aws-inventory.json --identity --pretty
```

Transport (verified): `PUT https://<host>/graphql/boundaries/<boundaryId>?pageSize=<n>`
with headers `Authorization: APIKey <key>` and `dana-org-id: <org>`, body
`{ "query": "<graphql>" }`; filters use the DSL `Field(arg: ".eq.value")`.
Default host `api.uat.zerobias.com` (override with `--host`).

`zb-graphql.sh` is a curl wrapper for the same API — run it where ZeroBias is
reachable to `introspect`, inspect a `type`, run an arbitrary `q`, or dump the
whole `inventory` as a file for `--graphql --in`.

**AWS → visualizer mapping:** `AwsVpc`→VPC, `AwsSubnet`→subnet (tier from route
table / `mapPublicIpOnLaunch` / Name tag), `AwsInternetGateway`/`AwsNatGateway`→
gateways, `AwsEc2Instance`→`ec2`, `AwsLoadBalancer`→`alb`/`nlb`, `AwsRdsInstance`→
`rds`/`aurora`, `AwsLambdaFunction`→`lambda`; **flows** from security-group rules
(internet ingress + SG-to-SG east-west) and the route-table egress chain
(instance → NAT → IGW). **Identity & Access overlay** (`--identity`): `AwsIamUser`
/ `AwsIamRole` / `AwsIamGroup` / `AwsIamManagedPolicy` / `AwsIamCustomerPolicy`
become a dedicated `iam` VPC with a subnet per kind (Users / Groups / Roles /
Policies) and the access graph as flows — user→group (`member`), user→role
(`assumes`, incl. `canAssume`), user→policy (`inline` / `boundary`). Risk flags
ride the labels (`⚠no-MFA`, `★priv`, `⛔<status>`), a per-principal `note`
(account, status, MFA, access-key count, group/role counts) shows in the detail
panel, and the VPC label carries a posture summary (e.g. `Identity & Access · 8
users · 8 no-MFA`). **IAM ↔ compute:** an **account hub** ties identities and
resources that share an AWS account — `principal → account` (`iam`) and
`account → resource` (`account`) — so the overlay links to the actual EC2/Lambda/
ECS nodes (a hub is only created for accounts that own a resource). Where the
boundary ingested them, `principal → policy` (`attached`) and `policy → resource`
(`grants`) edges complete the user → policy → resource authorization path.

> **Confirmed live schema (Auditmation AuditgraphDB).** Verified against a real
> UAT boundary: the live API does **not** use raw AWS-API names. Types are
> `AwsVPC` / `AwsInstance` / `AwsFunction` / `AwsEcsService` (not `AwsVpc` /
> `AwsEc2Instance` / …) and fields are `id` / `name` / `cidr` / `awsRegion`
> (enum form `US_EAST2`) / `awsAccountId` — not `vpcId` / `cidrBlock` / `region`.
> Relationships go through network interfaces (`AwsInstance.vpc`,
> `AwsNetworkInterface { vpc subnet }`); `AwsSubnet` has **no** `vpc` field and
> `AwsVPC` has **no** `cidr`. `AwsLoadBalancer` / `AwsRdsInstance` don't exist;
> ELB/RDS aren't first-class here. The `QUERIES` in `zerobias-graphql.js` now
> match this schema, and `awsInventoryToVisualizer()` is **alias-tolerant** so it
> still maps the AWS-API-shaped offline sample too. When the boundary ingested
> compute/identity without the network layer (common), VPCs/subnets are
> **synthesised per account+region** so the topology still renders (e.g. 5 EC2 +
> 8 IAM users → one `us-east-2` VPC + an IAM overlay). Run `--introspect` (and
> `zb-graphql.sh type AwsInstance`) against your own boundary to confirm.

### Generic asset path (non-cloud evidence)

The open host/interface/route/firewall/identity model is mapped onto the
visualizer by inferring cloud structure. Point `--live` at a tenant and confirm
field/endpoint names via the `zb` MCP's `zerobias_describe`; the transform stays
the same.

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
| `zerobias-graphql.js` | **AWS path** — boundaries GraphQL client + `awsInventoryToVisualizer()` |
| `zb-graphql.sh` | curl wrapper (introspect / type / q / inventory) for the same API |
| `sample-aws-inventory.json` | mock AWS inventory for offline testing |
| `aws-network.json` | generated AWS output (load this in the app) |
| `zerobias-adapter.js` | generic transform (`transform`, `validate`) — Node + browser |
| `live.js` | generic live tenant fetch + `normalize()` |
| `cli.js` | command-line entry point (both paths) |
| `sample-zerobias-export.json` / `zerobias-network.json` | generic worked example |

### Heads-up: this web environment can't reach ZeroBias

This Claude Code web environment's egress allowlist blocks `*.zerobias.com`
(`api.app.zerobias.com` and `api.uat.zerobias.com` both return HTTP 403
`host_not_allowed`). Run the live `--graphql` / `--introspect` / `zb-graphql.sh`
commands from a network that can reach ZeroBias, or allowlist the host in the
environment's network policy. The offline `--graphql --in <file>` path needs no
network.
