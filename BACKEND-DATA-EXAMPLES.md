# Data examples for the Network Visualizer + Map

This is a hand-off spec for generating data the app can load. It covers the
three shapes the **Map** view uses:

1. **AWS network** — rendered as a 3D **cube** anchored at **Cochabamba**.
2. **Azure network** — rendered as a 3D **cube** anchored at **Austin**.
3. **Guild boundary** — rendered as a 3D **atom** scattered across US cities.

> **How the Map picks files.** The Map shows a *fixed fleet*:
> - Networks: `complex-network.json` (AWS) and `azure-network.json` (Azure).
> - Boundaries: every entry in `data/guild-catalog.json` (each entry points to a
>   boundary file via `dataFile`).
>
> To put new data on the map, either **overwrite those files**, or tell us the
> new filenames and we'll add them to the fleet list (`EXTRA_FILES` /
> `GUILD_FILE` in `map.js`).

---

## 1. AWS network

Provider is detected from the **`region`** code: an AWS-style code
(`us-east-1`, `us-west-2`, `eu-west-1`, …) → AWS cube at Cochabamba. Each
**VPC** becomes one cube; `flows` become dashed links between cubes.

```json
{
  "name": "Acme Cloud — Production",
  "region": "us-east-1",
  "vpcs": [
    {
      "id": "vpc-prod",
      "name": "Production",
      "cidr": "10.0.0.0/16",
      "region": "us-east-1",
      "subnets": [
        { "id": "pub-1a", "name": "Public 1a",  "cidr": "10.0.1.0/24",  "tier": "public",  "az": "us-east-1a" },
        { "id": "app-1a", "name": "App 1a",     "cidr": "10.0.11.0/24", "tier": "private", "az": "us-east-1a" },
        { "id": "db-1a",  "name": "Data 1a",    "cidr": "10.0.21.0/24", "tier": "data",    "az": "us-east-1a" }
      ],
      "gateways": [
        { "id": "igw",  "type": "igw", "name": "Internet GW" },
        { "id": "natA", "type": "nat", "name": "NAT GW A", "subnet": "pub-1a" }
      ],
      "resources": [
        { "id": "alb",  "type": "alb",     "name": "App LB",     "subnet": "pub-1a" },
        { "id": "ecs",  "type": "ecs",     "name": "App (ECS)",  "subnet": "app-1a" },
        { "id": "rds",  "type": "rds",     "name": "Orders DB",  "subnet": "db-1a" },
        { "id": "s3",   "type": "s3",      "name": "Assets",     "subnet": "app-1a" }
      ]
    }
  ],
  "flows": [
    { "from": "internet", "to": "alb", "label": "HTTPS" },
    { "from": "alb",  "to": "ecs", "label": "HTTP" },
    { "from": "ecs",  "to": "rds", "label": "5432" },
    { "from": "ecs",  "to": "natA", "label": "egress" },
    { "from": "natA", "to": "igw",  "label": "egress" }
  ]
}
```

**Valid AWS `type` values** (resources): `ec2`, `ecs`, `eks`, `lambda`, `alb`,
`nlb`, `elb`, `rds`, `aurora`, `dynamodb`, `redis`, `s3`, `cloudfront`, `apigw`,
`route53`, `waf`, `sg`, `asg`. **Gateways** (`gateways[].type`): `igw`, `nat`,
`endpoint`, `tgw`, `vgw`.

---

## 2. Azure network

Same shape, but use an **Azure `region`** code (`eastus`, `westus3`,
`westeurope`, …) → Azure cube at Austin. Use Azure resource types; subnet `az`
uses the Azure form (`eastus-1`).

```json
{
  "name": "Contoso Retail — Azure Platform",
  "region": "eastus",
  "vpcs": [
    {
      "id": "vnet-prod",
      "name": "vnet-prod (East US)",
      "cidr": "10.20.0.0/16",
      "region": "eastus",
      "subnets": [
        { "id": "edge-1", "name": "Edge",  "cidr": "10.20.1.0/24",  "tier": "public",  "az": "eastus-1" },
        { "id": "app-1",  "name": "App",   "cidr": "10.20.11.0/24", "tier": "private", "az": "eastus-1" },
        { "id": "data-1", "name": "Data",  "cidr": "10.20.21.0/24", "tier": "data",    "az": "eastus-2" }
      ],
      "gateways": [
        { "id": "agw",  "type": "appgw",        "name": "App Gateway", "subnet": "edge-1" },
        { "id": "fw",   "type": "azurefirewall", "name": "Azure FW",   "subnet": "edge-1" }
      ],
      "resources": [
        { "id": "aks",   "type": "aks",     "name": "AKS cluster", "subnet": "app-1" },
        { "id": "sql",   "type": "sql",     "name": "SQL DB",      "subnet": "data-1" },
        { "id": "blob",  "type": "blob",    "name": "Blob store",  "subnet": "app-1" },
        { "id": "nsg-app","type": "nsg",    "name": "App NSG",     "subnet": "app-1" }
      ]
    }
  ],
  "flows": [
    { "from": "internet", "to": "agw", "label": "HTTPS" },
    { "from": "agw", "to": "aks", "label": "HTTP" },
    { "from": "aks", "to": "sql", "label": "1433" },
    { "from": "aks", "to": "blob", "label": "443" }
  ]
}
```

**Valid Azure `type` values**: `vm`, `vmss`, `aks`, `appservice`, `function`,
`containerapp`, `sql`, `postgresql`, `mysql`, `cosmosdb`, `redis`, `blob`,
`vnet`, `nsg`, `appgw`, `frontdoor`, `azurewaf`, `azurefirewall`, `vpngw`,
`expressroute`, `bastion`, `azuredns`, `apim`, `privateendpoint`, `publicip`,
`entra`, `cdn`.

> **Multi-version (optional).** To get the version timeline + boundary
> scrubber, wrap the same payload in a `versions` array. The Map always uses the
> **latest** version. Example:

```json
{
  "name": "Acme Cloud",
  "versions": [
    {
      "id": "v1",
      "name": "Acme Cloud · v1",
      "author": "alice@acme.com",
      "timestamp": "2026-01-15T10:00:00Z",
      "status": "ok",
      "note": "initial",
      "data": {
        "name": "Acme Cloud · v1",
        "region": "us-east-1",
        "vpcs": [],
        "flows": []
      }
    }
  ]
}
```

---

## 3. Guild boundary (the atoms)

A boundary is the **holographic assessment** an atom drills into. It is a tree
of **holonics** (groups) over **holons** (individual findings). Atom **colour**
comes from the holon/holonic `assessmentType` via the catalog (below).

Top-level boundary file:

```json
{
  "id": "checkout-service-q2",
  "entityType": "boundary",
  "label": "Checkout service · Q2 attestation",
  "environment": "prod",
  "role": "supplier",
  "snapshotAt": "2026-05-19T06:00:00Z",
  "schemaVersion": "1.0.0",
  "entityClass": "AssessmentBoundary",
  "entityCategory": "ASSESSMENT",
  "provider": "agnostic",
  "ontologyVersion": "1.0.0",
  "assemblyLevel": 3,
  "holonics": [
    {
      "id": "holonic-container-stigs",
      "entityType": "holonic",
      "label": "Container STIGs",
      "holonType": "control",
      "holons": ["stig-nginx-base", "cve-openssl-2025-9999"],
      "childHolonics": [],
      "aggregateStatus": "partial-fail",
      "aggregateScore": 62,
      "boundary": { "shape": "cluster", "color": "#f97316" },
      "timestamp": "2026-05-19T06:00:00Z",
      "projection": "both",
      "entityClass": "AssessmentControl",
      "entityCategory": "ASSESSMENT",
      "provider": "agnostic",
      "ontologyVersion": "1.0.0",
      "assemblyLevel": 1
    }
  ],
  "loose_holons": [
    {
      "id": "stig-nginx-base",
      "entityType": "holon",
      "assessmentType": "STIG",
      "subtype": "container",
      "label": "STIG · nginx base image hardening",
      "target": "nginx:1.25-alpine",
      "status": "pass",
      "severity": "medium",
      "score": 92,
      "timestamp": "2026-05-19T06:00:00Z",
      "hash": "9f4a1c2e7b5d6f803a1bc92d4e7f0a13b58e3c1f4a9d7b8c6e5f201938abcdef",
      "source": "0bias",
      "immutable": true,
      "provenance": {
        "collectedAt": "2026-05-19T06:00:00Z",
        "collectedBy": "0bias-scanner@v3.2",
        "verifiedAt": "2026-05-19T09:00:00Z",
        "chain": ["scan-job-44812"]
      },
      "meta": {
        "description": "DISA STIG V-72081 container base image hardening.",
        "remediation": null,
        "references": ["https://public.cyber.mil/stigs/"]
      },
      "projection": "both",
      "entityClass": "SecurityControl",
      "entityCategory": "SECURITY",
      "provider": "agnostic",
      "ontologyVersion": "1.0.0",
      "assemblyLevel": 0
    },
    {
      "id": "cve-openssl-2025-9999",
      "entityType": "holon",
      "assessmentType": "CVE",
      "subtype": "container",
      "label": "CVE-2025-9999 · OpenSSL",
      "target": "openssl 3.0.11",
      "status": "fail",
      "severity": "high",
      "score": 18,
      "timestamp": "2026-05-19T06:00:00Z",
      "hash": "a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00",
      "source": "tenable",
      "immutable": true,
      "provenance": {
        "collectedAt": "2026-05-19T06:00:00Z",
        "collectedBy": "tenable-io",
        "verifiedAt": null,
        "chain": ["scan-job-44813"]
      },
      "meta": {
        "description": "Vulnerable OpenSSL version in the runtime image.",
        "remediation": "Rebuild on a patched base image (openssl >= 3.0.14).",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2025-9999"]
      },
      "projection": "both",
      "entityClass": "Vulnerability",
      "entityCategory": "SECURITY",
      "provider": "agnostic",
      "ontologyVersion": "1.0.0",
      "assemblyLevel": 0
    }
  ],
  "meta": {}
}
```

### Field notes (holons)
- **Required:** `id` (kebab-case, unique in the file), `entityType:"holon"`,
  `assessmentType`, `subtype`, `label`, `target`, `status`, `severity`, `score`
  (0–100), `timestamp` (ISO-8601), `hash` (64 hex chars), `source`, `immutable`,
  `provenance`, `meta`, `projection`, `entityClass`, `entityCategory`, `provider`,
  `ontologyVersion`, `assemblyLevel`.
- **`assessmentType`**: `STIG` | `CVE` | `CIS` | `NIST` | `custom`.
- **`subtype`**: `container` | `vm` | `service` | `repo` | `network` | `custom`.
- **`status`**: `pass` | `fail` | `pending` | `unknown`.
- **`severity`**: `critical` | `high` | `medium` | `low` | `info`.
- **`projection`**: `2d` | `3d` | `both`.
- **`entityCategory`**: `COMPUTE` | `STORAGE` | `NETWORK` | `IDENTITY` |
  `SECURITY` | `ASSESSMENT` | `ORGANIZATION`.
- **`provider`**: `aws` | `azure` | `gcp` | `on-prem` | `agnostic`.
- **`assemblyLevel`**: integer — `0` atom (holon), `1` component, `2` subsystem,
  `3` system, `4` system-of-systems (holonic).

### Field notes (holonics)
- **Required:** `id`, `entityType:"holonic"`, `label`, `holonType`
  (`control` | `boundary` | `guild` | `project`), `holons` (array of holon ids in
  this file), `childHolonics` (holonic ids), `aggregateStatus`
  (`pass`|`fail`|`partial-fail`|`pending`|`unknown`), `aggregateScore` (0–100),
  `boundary` (`{ "shape": "cluster"|"ring"|"tree"|"flat", "color": "#rrggbb" }`),
  `timestamp`, `projection`, plus the same entity fields as holons.

---

## 4. Guild catalog entry (registers a boundary as a map atom)

Each object in `data/guild-catalog.json` → **`{ "catalog": [ … ] }`** becomes one
atom on the map. `dataFile` points at the boundary file from §3. `assessmentType`
sets the atom **colour**; `author` is the guild name shown under the atom.

```json
{
  "catalog": [
    {
      "id": "checkout-service-q2",
      "name": "Checkout service · Q2 attestation",
      "description": "Full boundary snapshot of the checkout service.",
      "assessmentType": "custom",
      "author": "Acme Compliance",
      "publishedAt": "2026-05-19T06:00:00Z",
      "status": "published",
      "version": "1.0.1",
      "dataFile": "data/checkout-service-q2.json",
      "tags": ["boundary", "audit", "checkout"],
      "stats": { "totalHolons": 8, "passRate": 50, "lastRun": "2026-05-19T06:00:00Z" },
      "provider": "agnostic"
    }
  ]
}
```

### Atom colour by `assessmentType`
| assessmentType | colour |
|----------------|--------|
| `STIG`   | purple `#7c5cff` |
| `CVE`    | red `#ff4d6d` |
| `CIS`    | green `#22c55e` |
| `NIST`   | blue `#38bdf8` |
| `custom` | amber `#f59e0b` |

Atoms are spread across US cities (Seattle, New York, Chicago, Denver, Atlanta,
San Francisco, Miami, Boston) in catalog order — so list them in the order you
want them placed. Drilling an atom loads its `dataFile` into the holographic
assessment view (a `dataFile` that is a *network* opens the 3D network view
instead).
