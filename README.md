# AWS Network Visualizer + OSIRIS

This repository is a **monorepo** containing two independent applications:

| App | Path | Stack | Purpose |
|-----|------|-------|---------|
| **AWS Network Visualizer** | repository root | Static HTML / CSS / vanilla JS (D3 + Three.js + MapLibre GL via CDN) | Interactive 2D / 3D / **geographic Map** visualization of AWS & Azure network topologies, with guided tours, a build wizard, and attack simulation. |
| **OSIRIS** | [`osiris/`](osiris/) | Next.js 16 + TypeScript + MapLibre GL | Real-time global OSINT dashboard — live flights, CCTV, earthquakes, fires, news, conflict zones, and a RECON toolkit. |

The two apps are linked from the Visualizer header via the **🌐 Global Intel**
button, which opens the running OSIRIS instance (defaults to
`http://localhost:3000`).

### Map view (OSIRIS-style globe, no API keys)

The Visualizer's **Map** tab renders a fixed **fleet** of networks
(`complex-network.json` and `azure-network.json`) onto a MapLibre GL globe —
one cluster per provider, stable regardless of what's loaded elsewhere in the
app. By default networks are placed by their `region` code (both AWS —
`us-east-1`, … — and Azure — `eastus`, … — are supported), but **provider
anchors** override this: AWS networks are pinned to **Cochabamba, Bolivia** and
Azure networks to **Austin, Texas** (configurable via `PROVIDER_ANCHORS` in
`map.js`).

**Markers:** each network is a **3D rotating cube** branded with its provider
(AWS / Azure) icon; each **guild boundary** (from `data/guild-catalog.json`) is
a **3D animated atom** (nucleus + orbiting electrons), coloured by assessment
type (STIG/CVE/CIS/NIST/custom) and scattered across US cities.

**Zoom-to-drill:** click a marker to fly closer, then keep zooming — past a
(deliberately high) zoom threshold the map "falls into" the scene and hands off
to that item's **holographic (3D) view**: a network opens its 3D topology, a
guild boundary opens its holographic assessment. Switching back to the **Map**
tab zooms back out and re-arms the effect.

It reuses the same **keyless** map stack OSIRIS uses, so **no API keys are
required**:

- **MapLibre GL JS** — WebGL globe engine
- **CARTO dark-matter / positron** — base map styles (keyless)
- **ESRI World Imagery** — optional satellite imagery toggle (keyless)

OSIRIS's own `OsirisMap` is a React/Next component that can't run in this
static app, so `map.js` is a small vanilla port of the same technique rather
than a direct file reuse. The OSINT data-feed keys OSIRIS documents (FIRMS,
OpenSky, …) are **not** needed here — we plot your own network, not live feeds.

### ZeroBias integration (in-app)

The Visualizer is wired directly into **ZeroBias** (the Auditmation IT-audit
data platform) so the whole tenant — inventory, boundaries, accounts, users and
tasks — flows into every view. It's branded throughout (the **⬡ ZeroBias** mark
in the header). **The app starts empty** and stays that way until you connect to
ZeroBias (or import / load something manually); connecting then pulls your data
in. It surfaces in:

- **Import network ▾** — a split menu with two sources:
  - **From ZeroBias** — pulls **live** native AWS inventory from your boundary's
    GraphQL API (`AwsVpc` / `AwsSubnet` / `AwsEc2Instance` / `AwsIamUser` / …) and
    maps it 1:1 onto the topology, reusing the **exact same** mapping the Node
    adapter uses (`adapter/zerobias-graphql.js`, now UMD).
  - **Downloaded network** — load a `.json` topology you exported earlier
    (the original file import).
- **Connect ZeroBias** — a connect / **sign-in** modal: enter your host, org id
  (`dana-org-id`), boundary id and API key, or pick a **user to sign in as**.
  Each user scopes the boundaries and tasks shown, and connecting auto-pulls the
  network. A user can carry a saved **connection target** (host/org/boundary in
  `data/zerobias/users.json`); the matching **API key** is read at runtime from
  `data/zerobias/credentials.local.json` (**gitignored — never committed**) or
  typed once into the modal (opt-in `localStorage`, off on shared machines).
- **Sidebar panels** — **Organization** (org id, plan, compliance frameworks,
  cloud accounts, and a clickable **boundary list**) and **Tasks** (the signed-in
  user's ZeroBias remediation tasks; clicking one opens its boundary and drills
  to the exact finding/holon).
- **Map overlay + provider filter** — a ZeroBias panel on the Map tab summarising
  the org, boundaries, accounts, users, open tasks and findings; the atoms on the
  globe are the org's boundaries. An **All / AWS / Azure** segmented control
  filters the globe to one provider (and back to all).

> **Live vs. demo.** When the browser can reach `*.zerobias.com` and a key is
> present, the import pulls **live** (a green **● Live** badge). Otherwise
> everything falls back to the bundled sample tenant under
> [`data/zerobias/`](data/zerobias/) (an amber **Demo data** badge), so every
> panel is fully populated offline. (In-browser live pulls also depend on the
> ZeroBias API allowing CORS from the page origin; if it doesn't, generate a file
> with the CLI adapter and use **Import → Downloaded network**.) This is the same
> host the CLI adapter targets — see [`adapter/README.md`](adapter/README.md) and
> [`HANDOFF.md`](HANDOFF.md) for the live-pull setup and network-policy notes.

> **Credentials, briefly.** To make a one-click "sign in as <user>" go live on
> your own machine, create `data/zerobias/credentials.local.json` (gitignored):
> ```json
> { "credentials": { "u-gabriel": "<your-rotated-api-key>" } }
> ```
> Never commit a real key; rotate any key that has been shared in plaintext.

---

## 1. AWS Network Visualizer (root)

A zero-build static site. Just open `index.html`, or serve the root directory:

```bash
# from the repository root
python3 -m http.server 8000
# then open http://localhost:8000
```

This app is what GitHub Pages deploys (see `.github/workflows/pages.yml`).

> **Note:** GitHub Pages serves static files only, so it deploys the Visualizer
> but **cannot** run OSIRIS (which needs a Node server). The `osiris/` source is
> committed for development but is not executed by Pages — host OSIRIS
> separately (see below) and point the **🌐 Global Intel** link at it.

## 2. OSIRIS (`osiris/`)

A full Next.js application that must be built/run with Node. It works partially
without any API keys — all core feeds use public, keyless sources.

```bash
cd osiris
npm install
npm run dev          # http://localhost:3000
```

Production build / self-host:

```bash
cd osiris
npm run build && npm run start        # Node
# or
cp .env.template .env && docker compose up -d   # Docker
```

Optional API keys (NASA FIRMS, OpenSky, N2YO, AIS, RECON scanner backend) are
documented in [`osiris/.env.template`](osiris/.env.template) and
[`osiris/DOCKER.md`](osiris/DOCKER.md).

### Pointing the launcher at a hosted OSIRIS

The **🌐 Global Intel** button in the Visualizer (`index.html`) targets
`http://localhost:3000` by default. If you deploy OSIRIS elsewhere (Vercel,
Docker host, etc.), update the `href` of the `#osiris-link` anchor in
`index.html` to that URL.

---

## Repository layout

```
.
├── index.html, app.js, visualizer.js, ...   # AWS Network Visualizer (static)
├── data/  ontology/  schema/                 # Visualizer data & schemas
├── .github/workflows/pages.yml               # GitHub Pages deploy (Visualizer)
└── osiris/                                    # Vendored OSIRIS Next.js app
    ├── src/  public/  scripts/
    ├── package.json, next.config.ts, Dockerfile, docker-compose.yml
    └── README.md, DOCKER.md, .env.template
```

OSIRIS is **vendored** (its original `.git` history was removed) so both apps
live under one repository. See [`osiris/README.md`](osiris/README.md) for the
full OSIRIS feature list, architecture, and license (MIT).
