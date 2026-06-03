// Geographic map view: plots the loaded AWS / Azure network onto a MapLibre GL
// globe, tying each VPC / VNet to the real-world coordinates of its region.
//
// This reuses the exact same *keyless* approach OSIRIS uses for its
// "Google-Earth" style map — no API keys required:
//   • MapLibre GL JS            — WebGL globe engine
//   • CARTO dark-matter style   — base map (basemaps.cartocdn.com, keyless)
//   • ESRI World Imagery tiles  — optional satellite imagery (keyless)
//
// OSIRIS's map is a React/Next component, which can't run in this static app,
// so this is a small vanilla port of the same technique.
(function () {
  const BASE_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
  const LIGHT_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
  const SATELLITE_TILES =
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

  const COLOR_AWS = "#ff9900";
  const COLOR_AZURE = "#2f9bff";
  const COLOR_OTHER = "#9aa4b2";

  // Named city anchors. When a provider has an anchor here, its networks are
  // pinned to that city on the map instead of being placed by region code.
  const PLACES = {
    cochabamba: { coord: [-66.1568, -17.3935], name: "Cochabamba, Bolivia" },
    austin: { coord: [-97.7431, 30.2672], name: "Austin, Texas" },
  };
  const PROVIDER_ANCHORS = {
    aws: { coord: PLACES.cochabamba.coord, place: PLACES.cochabamba.name },
    azure: { coord: PLACES.austin.coord, place: PLACES.austin.name },
  };

  // Past this zoom, zooming into a network/boundary drills into its
  // holographic (3D) view — Google-Earth-style "fall into the scene". Set high
  // so it takes a deliberate close zoom to enter.
  const ZOOM_DRILL = 9.2;

  // Guild boundaries (compliance assessments) loaded from the catalog and
  // scattered across US cities, each shown as an animated atom.
  const GUILD_FILE = "data/guild-catalog.json";
  const GUILD_CITIES = [
    { coord: [-122.3321, 47.6062], name: "Seattle, WA" },
    { coord: [-73.9857, 40.7484], name: "New York, NY" },
    { coord: [-87.6298, 41.8781], name: "Chicago, IL" },
    { coord: [-104.9903, 39.7392], name: "Denver, CO" },
    { coord: [-84.388, 33.749], name: "Atlanta, GA" },
    { coord: [-122.4194, 37.7749], name: "San Francisco, CA" },
    { coord: [-80.1918, 25.7617], name: "Miami, FL" },
    { coord: [-71.0589, 42.3601], name: "Boston, MA" },
  ];
  // Atom colour per assessment type.
  const ASSESSMENT_COLORS = {
    STIG: "#7c5cff",
    CVE: "#ff4d6d",
    CIS: "#22c55e",
    NIST: "#38bdf8",
    custom: "#f59e0b",
  };

  // Region → [lng, lat]. Approximate location of each cloud region's datacenter
  // cluster — accurate enough to place a network on the right city.
  const AWS_REGIONS = {
    "us-east-1": [-78.45, 38.95], "us-east-2": [-83.0, 40.0],
    "us-west-1": [-121.96, 37.35], "us-west-2": [-119.7, 45.84],
    "ca-central-1": [-73.6, 45.5], "ca-west-1": [-114.07, 51.05],
    "sa-east-1": [-46.63, -23.55],
    "eu-west-1": [-8.24, 53.41], "eu-west-2": [-0.13, 51.51], "eu-west-3": [2.35, 48.86],
    "eu-central-1": [8.68, 50.11], "eu-central-2": [8.54, 47.38],
    "eu-north-1": [18.07, 59.33], "eu-south-1": [9.19, 45.46], "eu-south-2": [-3.7, 40.42],
    "me-south-1": [50.55, 26.07], "me-central-1": [54.37, 24.47],
    "il-central-1": [34.78, 32.08], "af-south-1": [18.42, -33.92],
    "ap-south-1": [72.87, 19.07], "ap-south-2": [78.48, 17.38],
    "ap-southeast-1": [103.82, 1.35], "ap-southeast-2": [151.21, -33.86],
    "ap-southeast-3": [106.85, -6.21], "ap-southeast-4": [144.96, -37.81],
    "ap-northeast-1": [139.69, 35.68], "ap-northeast-2": [126.98, 37.57],
    "ap-northeast-3": [135.5, 34.69], "ap-east-1": [114.17, 22.32],
    "cn-north-1": [116.4, 39.9], "cn-northwest-1": [105.19, 37.5],
    "us-gov-west-1": [-119.7, 45.84], "us-gov-east-1": [-83.0, 40.0],
  };
  const AZURE_REGIONS = {
    eastus: [-79.82, 37.37], eastus2: [-78.0, 36.85], centralus: [-93.6, 41.59],
    northcentralus: [-87.62, 41.88], southcentralus: [-98.49, 29.42],
    westcentralus: [-110.23, 40.89], westus: [-122.42, 37.78],
    westus2: [-119.85, 47.23], westus3: [-112.07, 33.45],
    canadacentral: [-79.38, 43.65], canadaeast: [-71.21, 46.81],
    brazilsouth: [-46.63, -23.55], brazilsoutheast: [-43.2, -22.9],
    northeurope: [-6.26, 53.34], westeurope: [4.9, 52.37],
    uksouth: [-0.8, 51.5], ukwest: [-3.18, 51.48],
    francecentral: [2.37, 46.36], francesouth: [5.37, 43.3],
    germanywestcentral: [8.68, 50.11], germanynorth: [8.8, 53.07],
    switzerlandnorth: [8.56, 47.45], switzerlandwest: [6.14, 46.2],
    norwayeast: [10.75, 59.91], norwaywest: [5.32, 60.39],
    swedencentral: [17.14, 60.67], polandcentral: [21.01, 52.23],
    italynorth: [9.19, 45.46], spaincentral: [-3.7, 40.42],
    uaenorth: [55.3, 25.27], uaecentral: [54.37, 24.47], qatarcentral: [51.53, 25.29],
    israelcentral: [34.78, 32.08], southafricanorth: [28.05, -26.2], southafricawest: [18.42, -33.92],
    centralindia: [73.86, 18.52], southindia: [80.27, 13.08], westindia: [72.87, 19.07],
    southeastasia: [103.82, 1.35], eastasia: [114.17, 22.32],
    japaneast: [139.69, 35.68], japanwest: [135.5, 34.69],
    koreacentral: [126.98, 37.57], koreasouth: [129.08, 35.18],
    australiaeast: [151.21, -33.86], australiasoutheast: [144.96, -37.81],
    australiacentral: [149.13, -35.28],
  };

  let map = null;
  let ready = false;
  let theme = "dark";
  let satellite = false;
  let projection = "globe";
  // Other network files in the repo to show on the map alongside whatever's
  // loaded, so the map is a fleet view rather than a single-network view.
  const EXTRA_FILES = ["complex-network.json", "azure-network.json"];

  let lastPoints = [];
  let extras = [];
  let extrasLoaded = false;
  let guilds = []; // [{ id, name, type, author, coord, cityName, data, raw }]
  let guildsLoaded = false;
  let networkRaw = {}; // networkId -> raw payload, for drill-to-load
  let markers = []; // live maplibregl.Marker instances (cubes + atoms)
  let placedItems = []; // { coord, kind:'network'|'boundary', ... } for drill detection
  let drilling = false;
  let warp = null;
  let hasFitted = false; // auto-fit once per map visit, after the fleet loads
  let els = {};

  // --- region resolution -------------------------------------------------

  function resolveRegion(region, azFallback) {
    let key = (region || "").trim().toLowerCase();
    if (key && AWS_REGIONS[key]) return { coord: AWS_REGIONS[key], provider: "aws", label: key };
    if (key && AZURE_REGIONS[key]) return { coord: AZURE_REGIONS[key], provider: "azure", label: key };

    // Derive a region from an AZ when the network omits an explicit region.
    if (!key && azFallback) {
      const az = String(azFallback).toLowerCase();
      // AWS AZ: "us-east-1a" -> "us-east-1"
      const awsm = az.match(/^([a-z]{2}-[a-z]+-\d)/);
      if (awsm && AWS_REGIONS[awsm[1]]) return { coord: AWS_REGIONS[awsm[1]], provider: "aws", label: awsm[1] };
      // Azure AZ: "eastus-1" -> "eastus"
      const azm = az.replace(/-\d+$/, "");
      if (AZURE_REGIONS[azm]) return { coord: AZURE_REGIONS[azm], provider: "azure", label: azm };
    }
    return null;
  }

  // Spread N points around a center so co-located VPCs don't stack exactly.
  function spread(center, index, count) {
    if (count <= 1) return center.slice();
    const r = 0.45 + count * 0.1; // degrees — kept tight so the cluster reads "at the city"
    const ang = (index / count) * Math.PI * 2;
    return [center[0] + Math.cos(ang) * r, center[1] + Math.sin(ang) * r * 0.7];
  }

  // --- data -> GeoJSON ---------------------------------------------------

  // Small deterministic string hash (FNV-ish) for stable, content-derived
  // placement that never depends on load order or how many networks are shown.
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // Offset a network's cluster around its city anchor so several networks
  // sharing one city (e.g. two AWS fleets at Cochabamba) don't stack. The
  // offset is derived from the network's own content, so a network lands in
  // the exact same spot every time — whether it's the loaded one or a fleet
  // member, and regardless of how many others are on the map.
  function networkOffset(net) {
    const h = hashStr(sigOf(net.data) || net.name || net.id || "");
    const ang = (h % 360) * (Math.PI / 180);
    const r = 0.7 + (h % 5) * 0.18; // 0.70°–1.42°, stable per network
    return [Math.cos(ang) * r, Math.sin(ang) * r * 0.7];
  }

  // Build GeoJSON for an array of networks: [{ id, name, data }].
  function buildFeatures(networks) {
    const points = [];
    const lines = [];

    networks.forEach((net) => {
      const data = net.data || {};
      const vpcs = data.vpcs || [];
      const fallbackRegion = data.region;
      const off = networkOffset(net);

      // Group this network's VPCs by city/region so they fan out together.
      const groups = new Map();
      const resolved = [];
      vpcs.forEach((vpc) => {
        const firstAz = (vpc.subnets || []).find((s) => s.az) || {};
        const r = resolveRegion(vpc.region || fallbackRegion, firstAz.az);
        if (!r) return;
        const anchor = PROVIDER_ANCHORS[r.provider];
        const cityCoord = anchor ? anchor.coord : r.coord;
        const place = anchor ? anchor.place : "";
        const gkey = anchor ? "@" + r.provider : r.label;
        if (!groups.has(gkey)) groups.set(gkey, []);
        const idx = groups.get(gkey).length;
        groups.get(gkey).push(vpc);
        resolved.push({ vpc, r, gkey, idx, cityCoord, place });
      });
      resolved.forEach((e) => (e.total = groups.get(e.gkey).length));

      const centerOf = new Map(); // vpc.id -> [lng,lat]
      resolved.forEach((e) => {
        const { vpc, r, idx, total, cityCoord, place } = e;
        const base = [cityCoord[0] + off[0], cityCoord[1] + off[1]];
        const coord = spread(base, idx, total);
        centerOf.set(vpc.id, coord);
        const subnets = vpc.subnets || [];
        const tiers = [...new Set(subnets.map((s) => s.tier).filter(Boolean))];
        const color = r.provider === "aws" ? COLOR_AWS : r.provider === "azure" ? COLOR_AZURE : COLOR_OTHER;
        points.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: coord },
          properties: {
            id: vpc.id,
            networkId: net.id,
            networkName: net.name || "",
            name: vpc.name || vpc.id || "VPC",
            provider: r.provider,
            region: r.label,
            place: place || "",
            cidr: vpc.cidr || "",
            color,
            subnets: subnets.length,
            resources: (vpc.resources || []).length,
            gateways: (vpc.gateways || []).length,
            tiers: tiers.join(", "),
          },
        });
      });

      // Links between VPCs of this network (incl. cross-cloud, e.g. Cochabamba↔Austin).
      const resourceToVpc = new Map();
      vpcs.forEach((vpc) =>
        (vpc.resources || []).concat(vpc.gateways || []).forEach((res) => {
          if (res && res.id) resourceToVpc.set(res.id, vpc.id);
        }),
      );
      const seen = new Set();
      (data.flows || []).forEach((f) => {
        const a = resourceToVpc.get(f.from);
        const b = resourceToVpc.get(f.to);
        if (!a || !b || a === b) return;
        const ca = centerOf.get(a);
        const cb = centerOf.get(b);
        if (!ca || !cb) return;
        const key = a < b ? a + "|" + b : b + "|" + a;
        if (seen.has(key)) return;
        seen.add(key);
        lines.push({ type: "Feature", geometry: { type: "LineString", coordinates: [ca, cb] }, properties: {} });
      });
    });

    return {
      points: { type: "FeatureCollection", features: points },
      lines: { type: "FeatureCollection", features: lines },
    };
  }

  // Normalize a raw network file (single- or multi-version) to { name, data }.
  function normalizeNetwork(raw) {
    if (!raw) return null;
    if (Array.isArray(raw.versions) && raw.versions.length) {
      const v = raw.versions[raw.versions.length - 1];
      return { name: raw.name || (v && v.name) || "Network", data: v && v.data };
    }
    if (raw.vpcs) return { name: raw.name || "Network", data: raw };
    return null;
  }

  // Fetch the fixed fleet of network files once. The map always shows exactly
  // these networks (one cluster per provider city), regardless of what's
  // loaded in the rest of the app — keeps the map stable and unambiguous.
  async function loadExtras() {
    if (extrasLoaded) return;
    extrasLoaded = true;
    await Promise.all(
      EXTRA_FILES.map(async (file) => {
        try {
          const res = await fetch(file);
          if (!res.ok) return;
          const raw = await res.json();
          const n = normalizeNetwork(raw);
          if (n && n.data && (n.data.vpcs || []).length) {
            extras.push({ id: file, name: n.name, data: n.data, raw });
          }
        } catch (_) {
          /* offline / missing file — skip */
        }
      }),
    );
    if (ready) render();
  }

  // Fetch the guild catalog once and scatter its boundaries across US cities.
  async function loadGuilds() {
    if (guildsLoaded) return;
    guildsLoaded = true;
    try {
      const res = await fetch(GUILD_FILE);
      if (res.ok) {
        const cat = (await res.json()).catalog || [];
        // Cache each referenced data file so a drill can load the boundary.
        const fileCache = {};
        await Promise.all(
          [...new Set(cat.map((e) => e.dataFile).filter(Boolean))].map(async (f) => {
            try {
              const r = await fetch(f);
              if (r.ok) fileCache[f] = await r.json();
            } catch (_) {
              /* skip */
            }
          }),
        );
        cat.forEach((e, i) => {
          const city = GUILD_CITIES[i % GUILD_CITIES.length];
          guilds.push({
            id: e.id,
            name: e.name,
            type: e.assessmentType || "custom",
            author: e.author || "Guild",
            color: ASSESSMENT_COLORS[e.assessmentType] || ASSESSMENT_COLORS.custom,
            coord: city.coord,
            cityName: city.name,
            stats: e.stats || {},
            raw: fileCache[e.dataFile] || null,
          });
        });
      }
    } catch (_) {
      /* offline — skip */
    }
    if (ready) render();
  }

  // Fingerprint a network by its contents — used to give each network a stable,
  // content-derived position (see networkOffset).
  const sigOf = (data) => {
    try {
      return JSON.stringify(data && data.vpcs ? data.vpcs : data);
    } catch (_) {
      return "";
    }
  };

  // --- map layers --------------------------------------------------------

  function addLayers() {
    // Flow links between VPC cubes stay as a line layer; the nodes themselves
    // are HTML markers (3D cubes / atoms), added in render().
    map.addSource("aws-links", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({
      id: "aws-links-line",
      type: "line",
      source: "aws-links",
      paint: {
        "line-color": "#5ad0ff",
        "line-width": 1.4,
        "line-opacity": 0.55,
        "line-dasharray": [2, 2],
      },
    });
  }

  // --- HTML markers: 3D cubes (networks) and atoms (boundaries) -----------

  const AWS_ICON =
    '<svg viewBox="0 0 64 40"><text x="32" y="24" text-anchor="middle" font-size="20" font-weight="800" fill="#fff" font-family="Arial,Helvetica,sans-serif">aws</text><path d="M12 31 q20 9 40 0" stroke="#fff" stroke-width="3.4" fill="none" stroke-linecap="round"/></svg>';
  const AZURE_ICON =
    '<svg viewBox="0 0 64 64"><path d="M30 10 h12 l16 44 h-13 l-9-26 -10 26 H10 z" fill="#fff"/></svg>';

  function providerIcon(provider) {
    return provider === "azure" ? AZURE_ICON : AWS_ICON;
  }

  // A CSS 3D rotating cube with the provider icon on its faces + a label.
  function cubeMarkerEl(p) {
    const el = document.createElement("div");
    el.className = "map-marker map-cube-wrap";
    const icon = providerIcon(p.provider);
    const face = (cls) => `<div class="cf ${cls}">${icon}</div>`;
    el.innerHTML =
      `<div class="map-cube" style="--cube:${p.color}">` +
      face("cf-front") +
      face("cf-back") +
      face("cf-right") +
      face("cf-left") +
      face("cf-top") +
      face("cf-bottom") +
      `</div><div class="map-marker-label">${p.name}</div>`;
    return el;
  }

  // A CSS 3D animated atom (nucleus + orbiting electrons) with a label.
  function atomMarkerEl(g) {
    const el = document.createElement("div");
    el.className = "map-marker map-atom-wrap";
    const orbit = (cls, spin) =>
      `<div class="orbit ${cls}"><div class="ring"></div><div class="orb-spin ${spin}"><span class="electron"></span></div></div>`;
    el.innerHTML =
      `<div class="map-atom" style="--atom:${g.color}">` +
      `<div class="nucleus"></div>` +
      orbit("o1", "s1") +
      orbit("o2", "s2") +
      orbit("o3", "s3") +
      `</div><div class="map-marker-label">${g.name}<span class="map-marker-sub">${g.type} · ${g.author}</span></div>`;
    return el;
  }

  function applySatellite() {
    if (!map || !map.isStyleLoaded()) return;
    const has = map.getSource("satellite");
    if (satellite) {
      if (!has) {
        map.addSource("satellite", { type: "raster", tiles: [SATELLITE_TILES], tileSize: 256, maxzoom: 18 });
        // Insert beneath our data layers so VPCs stay on top.
        map.addLayer(
          { id: "satellite-layer", type: "raster", source: "satellite", paint: { "raster-opacity": 0.9 } },
          "aws-links-line",
        );
      } else {
        map.setLayoutProperty("satellite-layer", "visibility", "visible");
      }
    } else if (map.getLayer("satellite-layer")) {
      map.setLayoutProperty("satellite-layer", "visibility", "none");
    }
  }

  function fit(features) {
    const feats = features || lastPoints || [];
    if (!feats.length) return;
    if (feats.length === 1) {
      map.flyTo({ center: feats[0].geometry.coordinates, zoom: 3.2, duration: 800 });
      return;
    }
    const b = new maplibregl.LngLatBounds();
    feats.forEach((f) => b.extend(f.geometry.coordinates));
    map.fitBounds(b, { padding: 90, maxZoom: 5, duration: 800 });
  }

  // --- zoom-to-drill (Google-Earth style hand-off to holographic view) ---

  // Find the placed item (cube or atom) nearest the map centre (deg lng/lat).
  function nearestCluster() {
    if (!placedItems.length) return null;
    const c = map.getCenter();
    let best = null,
      bd = Infinity;
    placedItems.forEach((it) => {
      const d = Math.hypot(it.coord[0] - c.lng, it.coord[1] - c.lat);
      if (d < bd) {
        bd = d;
        best = it;
      }
    });
    return best ? { item: best, dist: bd } : null;
  }

  function onZoom(e) {
    if (drilling || !map) return;
    // Only react to real user zoom gestures (wheel / pinch / double-click).
    // Programmatic camera moves have no originalEvent — ignoring them prevents
    // an instant re-drill loop when returning to the map.
    if (!e || !e.originalEvent) return;
    if (map.getZoom() < ZOOM_DRILL) return;
    const near = nearestCluster();
    if (!near || near.dist > 3) return; // must be zoomed right onto a marker
    triggerDrill(near.item);
  }

  function triggerDrill(item) {
    drilling = true;
    if (warp) {
      warp.querySelector(".map-warp-label").textContent = "Entering holographic view — " + (item.label || "");
      warp.classList.add("is-on");
    }
    // Load the right payload so the holographic view shows the right scene:
    // a network → 3D city; a guild boundary → holographic boundary view.
    let raw = null;
    if (item.kind === "network") raw = networkRaw[item.networkId];
    else if (item.kind === "boundary") {
      const g = guilds.find((x) => x.id === item.guildId);
      raw = g && g.raw;
    }
    if (raw && window.AwsApp && window.AwsApp.load) window.AwsApp.load(raw);

    map.flyTo({ center: item.coord, zoom: Math.max(map.getZoom() + 1.4, ZOOM_DRILL + 1), pitch: 55, duration: 950 });
    setTimeout(() => {
      if (window.AwsMode && window.AwsMode.set) window.AwsMode.set("3d");
    }, 900);
  }

  // Re-arm after returning to the map: clear the warp, level the camera and
  // zoom back out so the leftover drill zoom isn't left on screen. Drilling
  // only re-triggers on a fresh user zoom gesture, so no race to guard here.
  function armDrill() {
    if (!ready || !map) return;
    drilling = false;
    if (warp) warp.classList.remove("is-on");
    try {
      map.easeTo({ pitch: 0, duration: 0 });
    } catch (_) {}
    fit(); // deliberate re-frame to the fleet overview on return
    hasFitted = true; // ...but don't let the next render re-fit on top of it
  }

  // --- public API --------------------------------------------------------

  function init(container) {
    if (ready || !window.maplibregl) return;
    els = {
      empty: document.getElementById("map-empty"),
      styleBtn: document.getElementById("map-style-toggle"),
      projBtn: document.getElementById("map-proj-toggle"),
      fitBtn: document.getElementById("map-fit"),
    };
    const canvas = container.querySelector("#map-canvas") || container;

    // Transition overlay used during the zoom-to-drill hand-off.
    warp = document.createElement("div");
    warp.className = "map-warp";
    warp.innerHTML = '<div class="map-warp-label"></div>';
    container.appendChild(warp);

    map = new maplibregl.Map({
      container: canvas,
      style: theme === "light" ? LIGHT_STYLE : BASE_STYLE,
      center: [10, 25],
      zoom: 1.4,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "bottom-right");

    map.on("load", () => {
      ready = true;
      try {
        map.setProjection({ type: projection });
      } catch (_) {}
      addLayers();
      applySatellite();
      render();
    });

    map.on("zoom", onZoom);

    if (els.styleBtn) els.styleBtn.addEventListener("click", toggleSatellite);
    if (els.projBtn) els.projBtn.addEventListener("click", toggleProjection);
    if (els.fitBtn) els.fitBtn.addEventListener("click", () => fit());
  }

  // The map renders a fixed fleet (the EXTRA_FILES networks as 3D cubes) plus
  // the guild boundaries (as 3D atoms) — not the currently loaded network — so
  // callers may pass data, but it's intentionally ignored.
  function render() {
    if (!ready || !map || !map.getSource("aws-links")) return;
    if (!extrasLoaded) loadExtras(); // fetch the fleet once, then re-render
    if (!guildsLoaded) loadGuilds(); // fetch the guild boundaries once
    if (!extrasLoaded && !guildsLoaded) return;

    // Clear previous markers.
    markers.forEach((m) => m.remove());
    markers = [];
    placedItems = [];
    networkRaw = {};

    // Networks → rotating cubes (one per VPC), plus their flow links.
    const { points, lines } = buildFeatures(extras);
    extras.forEach((n) => (networkRaw[n.id] = n.raw));
    map.getSource("aws-links").setData(lines);
    points.features.forEach((f) => {
      const p = f.properties;
      const m = new maplibregl.Marker({ element: cubeMarkerEl(p), anchor: "bottom" })
        .setLngLat(f.geometry.coordinates)
        .addTo(map);
      m.getElement().addEventListener("click", () => approach(f.geometry.coordinates));
      markers.push(m);
      placedItems.push({ coord: f.geometry.coordinates, kind: "network", networkId: p.networkId, label: p.networkName || p.name });
    });

    // Guild boundaries → animated atoms across the USA.
    guilds.forEach((g) => {
      const m = new maplibregl.Marker({ element: atomMarkerEl(g), anchor: "bottom" })
        .setLngLat(g.coord)
        .addTo(map);
      m.getElement().addEventListener("click", () => approach(g.coord));
      markers.push(m);
      placedItems.push({ coord: g.coord, kind: "boundary", guildId: g.id, label: g.name });
    });

    lastPoints = placedItems.map((it) => ({ geometry: { coordinates: it.coord } }));
    if (els.empty) els.empty.hidden = placedItems.length > 0;
    if (placedItems.length && !hasFitted) {
      fit(lastPoints);
      hasFitted = true;
    }
  }

  // Click a marker to fly closer (just shy of the drill threshold) — the user
  // then keeps zooming to fall into the holographic view.
  function approach(coord) {
    if (!map) return;
    drilling = false;
    map.flyTo({ center: coord, zoom: ZOOM_DRILL - 0.8, duration: 1100, essential: true });
  }

  function toggleSatellite() {
    satellite = !satellite;
    applySatellite();
    if (els.styleBtn) {
      els.styleBtn.textContent = satellite ? "🌑 Dark map" : "🛰️ Satellite";
      els.styleBtn.classList.toggle("is-active", satellite);
    }
  }

  function toggleProjection() {
    projection = projection === "globe" ? "mercator" : "globe";
    try {
      map.setProjection({ type: projection });
    } catch (_) {}
    if (els.projBtn) els.projBtn.textContent = projection === "globe" ? "🗺️ Flat" : "🌐 Globe";
  }

  function setTheme(next) {
    theme = next === "light" || next === "day" ? "light" : "dark";
    if (!ready || !map) return;
    // Swapping the base style drops our sources/layers — re-add them on reload.
    map.setStyle(theme === "light" ? LIGHT_STYLE : BASE_STYLE);
    map.once("styledata", () => {
      if (!map.getSource("aws-links")) addLayers();
      applySatellite();
      render();
    });
  }

  function resize() {
    if (map) setTimeout(() => map.resize(), 50);
  }

  window.AwsMap = {
    init,
    render,
    resize,
    setTheme,
    armDrill,
    isReady: () => ready,
  };
})();
