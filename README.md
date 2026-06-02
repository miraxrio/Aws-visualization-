# AWS Network Visualizer + OSIRIS

This repository is a **monorepo** containing two independent applications:

| App | Path | Stack | Purpose |
|-----|------|-------|---------|
| **AWS Network Visualizer** | repository root | Static HTML / CSS / vanilla JS (D3 + Three.js via CDN) | Interactive 2D / 3D visualization of AWS network topologies, with guided tours, a build wizard, and attack simulation. |
| **OSIRIS** | [`osiris/`](osiris/) | Next.js 16 + TypeScript + MapLibre GL | Real-time global OSINT dashboard — live flights, CCTV, earthquakes, fires, news, conflict zones, and a RECON toolkit. |

The two apps are linked from the Visualizer header via the **🌐 Global Intel**
button, which opens the running OSIRIS instance (defaults to
`http://localhost:3000`).

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
