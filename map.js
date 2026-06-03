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

  // Past this zoom, zooming into a network's cluster drills into its
  // holographic (3D) view — Google-Earth-style "fall into the scene".
  const ZOOM_DRILL = 6.5;

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

  let lastData = null;
  let lastPoints = [];
  let extras = [];
  let extrasLoaded = false;
  let networkRaw = {}; // networkId -> raw payload, for drill-to-load
  let drilling = false;
  let warp = null;
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
    const r = 1.1 + count * 0.15; // degrees
    const ang = (index / count) * Math.PI * 2;
    return [center[0] + Math.cos(ang) * r, center[1] + Math.sin(ang) * r * 0.7];
  }

  // --- data -> GeoJSON ---------------------------------------------------

  // Offset a whole network's cluster around its city anchor so several
  // networks sharing one city (e.g. two AWS fleets at Cochabamba) don't stack.
  function networkOffset(i, count) {
    if (count <= 1) return [0, 0];
    const r = 2.6;
    const ang = (i / count) * Math.PI * 2 + 0.4;
    return [Math.cos(ang) * r, Math.sin(ang) * r * 0.7];
  }

  // Build GeoJSON for an array of networks: [{ id, name, data }].
  function buildFeatures(networks) {
    const points = [];
    const lines = [];
    const nCount = networks.length;

    networks.forEach((net, ni) => {
      const data = net.data || {};
      const vpcs = data.vpcs || [];
      const fallbackRegion = data.region;
      const off = networkOffset(ni, nCount);

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

  // Fetch the repo's other network files once so the map shows the whole fleet,
  // not just the currently-loaded network.
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
    if (ready) render(lastData);
  }

  // Fingerprint a network by its full contents — so a loaded network de-dupes
  // against its own source file, without merging two distinct networks that
  // merely reuse generic VPC ids (e.g. "vpc-prod").
  const sigOf = (data) => {
    try {
      return JSON.stringify(data && data.vpcs ? data.vpcs : data);
    } catch (_) {
      return "";
    }
  };

  // Combine the current network with the fetched fleet, de-duped by signature.
  function collectNetworks(current) {
    const list = [];
    const seen = new Set();
    if (current && current.vpcs) {
      list.push({ id: "__current", name: current.name || "Current network", data: current, raw: current });
      seen.add(sigOf(current));
    }
    extras.forEach((e) => {
      const s = sigOf(e.data);
      if (!seen.has(s)) {
        list.push(e);
        seen.add(s);
      }
    });
    return list;
  }

  // --- map layers --------------------------------------------------------

  function addLayers() {
    map.addSource("aws-links", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addSource("aws-vpcs", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

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
    map.addLayer({
      id: "aws-vpc-halo",
      type: "circle",
      source: "aws-vpcs",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 7, 3, 14, 6, 26, 10, 44],
        "circle-color": ["get", "color"],
        "circle-opacity": 0.18,
        "circle-stroke-color": ["get", "color"],
        "circle-stroke-width": 1.2,
        "circle-stroke-opacity": 0.8,
      },
    });
    map.addLayer({
      id: "aws-vpc-dot",
      type: "circle",
      source: "aws-vpcs",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 3, 6, 5, 10, 7],
        "circle-color": ["get", "color"],
        "circle-stroke-color": "#0b0f17",
        "circle-stroke-width": 1.2,
      },
    });
    map.addLayer({
      id: "aws-vpc-label",
      type: "symbol",
      source: "aws-vpcs",
      layout: {
        "text-field": ["get", "name"],
        "text-size": 12,
        "text-offset": [0, 1.5],
        "text-anchor": "top",
        "text-font": ["Open Sans Regular", "Noto Sans Regular"],
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#e8eef7",
        "text-halo-color": "#0b0f17",
        "text-halo-width": 1.4,
      },
    });

    // Popups + cursor affordance on the VPC dots.
    map.on("click", "aws-vpc-dot", onVpcClick);
    map.on("click", "aws-vpc-halo", onVpcClick);
    map.on("mouseenter", "aws-vpc-dot", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "aws-vpc-dot", () => (map.getCanvas().style.cursor = ""));
  }

  function onVpcClick(e) {
    const p = e.features && e.features[0] && e.features[0].properties;
    if (!p) return;
    const prov = p.provider === "aws" ? "AWS" : p.provider === "azure" ? "Azure" : "Cloud";
    const rows = [
      ...(p.networkName ? [["Network", p.networkName]] : []),
      ["Provider", prov],
      ...(p.place ? [["Location", p.place]] : []),
      ["Region", p.region],
      ["CIDR", p.cidr || "—"],
      ["Subnets", p.subnets],
      ["Resources", p.resources],
      ["Gateways", p.gateways],
      ["Tiers", p.tiers || "—"],
    ]
      .map(([k, v]) => `<div class="map-pop-row"><span>${k}</span><b>${v}</b></div>`)
      .join("");
    new maplibregl.Popup({ closeButton: true, maxWidth: "260px", className: "map-pop" })
      .setLngLat(e.lngLat)
      .setHTML(
        `<div class="map-pop-head" style="border-color:${p.color}">
           <span class="map-pop-dot" style="background:${p.color}"></span>${p.name}
         </div>${rows}`,
      )
      .addTo(map);
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

  // Find the plotted VPC nearest the current map center (degrees of lng/lat).
  function nearestCluster() {
    if (!lastPoints.length) return null;
    const c = map.getCenter();
    let best = null,
      bd = Infinity;
    lastPoints.forEach((f) => {
      const [lng, lat] = f.geometry.coordinates;
      const d = Math.hypot(lng - c.lng, lat - c.lat);
      if (d < bd) {
        bd = d;
        best = f;
      }
    });
    return best ? { feature: best, dist: bd } : null;
  }

  function onZoom(e) {
    if (drilling || !map) return;
    // Only react to real user zoom gestures (wheel / pinch / double-click).
    // Programmatic camera moves (fit, flyTo, the re-arm zoom-out) have no
    // originalEvent — ignoring them prevents an instant re-drill loop when
    // returning to the map.
    if (!e || !e.originalEvent) return;
    if (map.getZoom() < ZOOM_DRILL) return;
    const near = nearestCluster();
    if (!near || near.dist > 8) return; // not actually over a network
    triggerDrill(near.feature);
  }

  function triggerDrill(feature) {
    drilling = true;
    const p = feature.properties || {};
    if (warp) {
      warp.querySelector(".map-warp-label").textContent =
        "Entering holographic view — " + (p.networkName || p.name || "network");
      warp.classList.add("is-on");
    }
    // If we're diving into a network other than the one currently loaded,
    // load it first so the holographic view shows the right topology.
    const raw = networkRaw[p.networkId];
    if (raw && p.networkId !== "__current" && window.AwsApp && window.AwsApp.load) {
      window.AwsApp.load(raw);
    }
    // Fall toward the cluster, then hand off to the holographic (3D) view.
    map.flyTo({
      center: feature.geometry.coordinates,
      zoom: Math.max(map.getZoom() + 1.5, 8.5),
      pitch: 55,
      duration: 950,
    });
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
    fit();
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
      if (lastData) render(lastData);
    });

    map.on("zoom", onZoom);

    if (els.styleBtn) els.styleBtn.addEventListener("click", toggleSatellite);
    if (els.projBtn) els.projBtn.addEventListener("click", toggleProjection);
    if (els.fitBtn) els.fitBtn.addEventListener("click", () => fit());
  }

  function render(data) {
    lastData = data;
    if (!ready || !map || !map.getSource("aws-vpcs")) return;
    if (!extrasLoaded) loadExtras(); // fetch the rest of the fleet, then re-render
    const networks = collectNetworks(data);
    networkRaw = {};
    networks.forEach((n) => (networkRaw[n.id] = n.raw));
    const { points, lines } = buildFeatures(networks);
    lastPoints = points.features;
    map.getSource("aws-vpcs").setData(points);
    map.getSource("aws-links").setData(lines);
    if (els.empty) els.empty.hidden = points.features.length > 0;
    if (points.features.length) fit(points.features);
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
      if (!map.getSource("aws-vpcs")) addLayers();
      applySatellite();
      if (lastData) render(lastData);
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
