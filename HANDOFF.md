# HANDOFF — finish the ZeroBias live AWS-inventory pull

**Branch:** `claude/zen-albattani-ibmtlv`
**Status:** Adapter built + tested offline. OSIRIS integration merged in. The only
thing left is to run the **live** ZeroBias GraphQL pull — which this previous
environment could not do because its network policy blocked `*.zerobias.com`.

> **Why this is a new session:** the network-access options only appear when you
> create/edit a cloud environment. The old environment used the default
> **Trusted** policy, whose allowlist excludes ZeroBias. You're now in a new
> session where you can set a **Custom** policy. Everything below picks up from
> there.

---

## ▶ Do this first (environment config)

When creating/editing this environment, set:

1. **Network access → Custom**, and under **Allowed domains** add:
   ```
   *.zerobias.com
   ```
   Keep **“Also include default list of common package managers”** checked (so
   GitHub/npm still work). Docs:
   https://code.claude.com/docs/en/claude-code-on-the-web#network-access
2. **Environment variables** (so no secret goes in chat, and `--graphql` reads
   them automatically):
   ```
   ZEROBIAS_API_KEY     = <freshly rotated key>     # rotate the old one first!
   ZEROBIAS_ORG_ID      = <org id from prior session / ZeroBias console>
   ZEROBIAS_BOUNDARY_ID = <boundary id, e.g. the AWS boundary>
   ZEROBIAS_GQL_HOST    = api.uat.zerobias.com      # (default; prod = api.app.zerobias.com)
   ```

---

## ▶ Then run these (ask Claude to)

```bash
# 0) sanity: confirm the host is now reachable (expect HTTP 200, not 403 host_not_allowed)
curl -sS -o /dev/null -w "%{http_code}\n" "https://$ZEROBIAS_GQL_HOST/graphql/boundaries/$ZEROBIAS_BOUNDARY_ID?pageSize=1" \
  -X PUT -H "Authorization: APIKey $ZEROBIAS_API_KEY" -H "dana-org-id: $ZEROBIAS_ORG_ID" \
  -H "Content-Type: application/json" -d '{"query":"query { AwsIamUser { name } }"}'

# 1) discover the REAL Aws* type + field names for this boundary
node adapter/cli.js --introspect
#    (or, for field detail:  ./adapter/zb-graphql.sh type AwsSubnet )

# 2) if any field names differ from the AWS-standard guesses, fix the selection
#    sets in adapter/zerobias-graphql.js (the QUERIES object). Only AwsIamUser
#    is confirmed today; vpc/subnet/instance/sg/etc. are best-effort.

# 3) pull live inventory, render, and write the network file
node adapter/cli.js --graphql --identity --pretty --out adapter/aws-network.json

# 4) commit the real output
git add adapter/aws-network.json && git commit -m "adapter: real AWS inventory from ZeroBias boundary" \
  && git push -u origin claude/zen-albattani-ibmtlv
```

Then load `adapter/aws-network.json` in the app (open `index.html` → **Import
network**, or drag the file onto the canvas).

---

## What's already built (in `adapter/`)

| File | Purpose |
|------|---------|
| `zerobias-graphql.js` | **AWS path** — `PUT /graphql/boundaries/<id>` client, inventory queries, `--introspect`, and `awsInventoryToVisualizer()` |
| `zb-graphql.sh` | curl wrapper: `introspect` / `type <Name>` / `q '<graphql>'` / `inventory` |
| `sample-aws-inventory.json` | mock AWS inventory — offline test of the mapping |
| `aws-network.json` | generated **from the mock** (replace with the real pull in step 3) |
| `zerobias-adapter.js` | generic host/asset → visualizer transform + `validate()` |
| `live.js` | generic (non-cloud) live fetch + `normalize()` |
| `cli.js` | entry point — `--graphql`/`--introspect`/`--boundary`/`--host`, `--live`, `--identity` |
| `README.md` | full mapping tables + verification notes |

Offline the mapping already reconstructs a full topology from the mock:
`internet → ALB → app → DB` plus the `instance → NAT → IGW` egress chain, with
MFA-disabled IAM users flagged. Validated against the visualizer schema.

## API shape (confirmed from a working call)

```
PUT https://<host>/graphql/boundaries/<boundaryId>?pageSize=<n>
  Authorization: APIKey <key>
  dana-org-id:   <org>
  Content-Type:  application/json
  body: {"query":"query { AwsIamUser(mfaEnabled: \".eq.false\") { name arn mfaEnabled awsAccountId } }"}
filter DSL: Field(arg: ".eq.value")
```

## AWS → visualizer mapping (in `zerobias-graphql.js`)

- `AwsVpc`→VPC · `AwsSubnet`→subnet (tier from route table / `mapPublicIpOnLaunch` / Name tag)
- `AwsInternetGateway`/`AwsNatGateway`→gateways
- `AwsEc2Instance`→`ec2` · `AwsLoadBalancer`→`alb`/`nlb` · `AwsRdsInstance`→`rds`/`aurora` · `AwsLambdaFunction`→`lambda`
- **flows**: security-group rules (internet ingress + SG-to-SG east-west) + route-table egress chain
- `AwsIamUser`→ identity overlay (`--identity`), MFA-disabled flagged

## Background (verified earlier)

ZeroBias = Auditmation IT-audit data platform. Open `@zerobias-org/schema` is
host/interface centric (no native VPC class); **native AWS types live in the
boundary GraphQL API** for a tenant that ingested a cloud account — which yours
did (confirmed `AwsIamUser`). Two MCPs also exist (`zb-knowledge` HTTP,
`zb` npm `@zerobias-com/zerobias-mcp`) per `zerobias-org/zerobias` `docs/MCPs.md`.

**Network block evidence (old env):** `api.uat.zerobias.com` and
`api.app.zerobias.com` both returned `HTTP 403 host_not_allowed` (sandboxed and
unsandboxed) — proxy allowlist, not credentials.

## ⚠ Security

- **Rotate** the API key that was shared in the prior chat session and use the
  new one via `ZEROBIAS_API_KEY`. Never commit the key. The secret scan in this
  repo is clean — keep it that way.

## Note on the OSIRIS merge

This branch now also contains `claude/osiris-integration-3SN62` (Map / Builder /
Catalog / holographic views + a vendored `osiris/` Next.js app). It merged
cleanly (no overlap with `adapter/`). Heads-up: it added
`.github/workflows/pages.yml`, which may run on push.
