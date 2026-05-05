// 3D "city" visualization of an imported AWS network.
// Built with Three.js. Reuses the layout produced by visualizer.js (the 2D
// renderer) so positions stay consistent between modes.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";

console.log("[viz3d] build 2026-05-05f — day/night theme + pedestrian spawn");

let initialized = false;
let scene, camera, renderer, controls, fpControls;
let cityGroup;
let particleSystems = [];
let registry = new Map(); // id -> { type, position, height, extent, mesh, group, baseY }
let cameraTween = null;
let raf = null;
let lastT = 0;
let focusEffect = null; // { group, targetMesh, baseEmissive }

// Theme handles, populated by init()
let sky, sunLight, rimLight, hemiLight, ambientLight, stars;
let nightSkyTex, daySkyTex;
let currentTheme = "night";

// Explore (first-person walk) state
let exploreActive = false;
const exploreKeys = { fwd: false, back: false, left: false, right: false, up: false, down: false };
const _moveDir = new THREE.Vector3();
let proxEntryId = null; // id of the element currently triggering the prox HUD

const SCALE_TARGET = 220; // city max dimension in 3D units
let SCALE = 0.15;
const CITY = { cx: 0, cz: 0, w: 0, d: 0 };

// ---------- init ----------

function init(container) {
  if (initialized) return;

  scene = new THREE.Scene();
  // No solid background — the sky sphere added below provides the backdrop.
  // Linear fog tuned per-render so it never swallows the focused element.
  scene.fog = new THREE.Fog(0x07101e, 220, 900);

  camera = new THREE.PerspectiveCamera(55, 1, 0.1, 5000);
  camera.position.set(120, 110, 160);

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  // Lights — bumped up so brand colours read saturated rather than muted.
  hemiLight = new THREE.HemisphereLight(0xb6c8ff, 0x0a1428, 1.05);
  scene.add(hemiLight);
  ambientLight = new THREE.AmbientLight(0x6079a8, 0.55);
  scene.add(ambientLight);

  sunLight = new THREE.DirectionalLight(0xffe2b8, 1.7);
  sunLight.position.set(-90, 200, 80);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  const sb = sunLight.shadow.camera;
  sb.left = -250; sb.right = 250; sb.top = 250; sb.bottom = -250;
  sunLight.shadow.bias = -0.0005;
  scene.add(sunLight);

  rimLight = new THREE.DirectionalLight(0x88aaff, 0.7);
  rimLight.position.set(60, 80, -120);
  scene.add(rimLight);

  // Ground — looks like a data-centre floor: rows of server racks with
  // glowing LEDs, tiled across a large plane so every direction reads
  // "this network city is sitting on top of physical infrastructure".
  const groundTex = makeServerFloorTexture();
  groundTex.repeat.set(20, 20);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(3000, 3000),
    new THREE.MeshStandardMaterial({
      map: groundTex,
      roughness: 0.85,
      metalness: 0.25,
      emissive: 0x0a1426,
      emissiveIntensity: 0.35,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Sky — distant city skyline panorama on the inside of a big sphere so
  // wherever the camera looks it sees a wider city around the network.
  // Two textures (day + night) are pre-generated and swapped by setTheme().
  nightSkyTex = makeSkyTexture();
  daySkyTex = makeDaySkyTexture();
  sky = new THREE.Mesh(
    new THREE.SphereGeometry(2200, 64, 32),
    new THREE.MeshBasicMaterial({
      map: nightSkyTex,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,           // sphere is past the fog far distance
      toneMapped: false,    // keep panorama colours faithful to the canvas
    }),
  );
  sky.renderOrder = -10;
  scene.add(sky);

  // A handful of foreground stars for sparkle on top of the sky panorama
  stars = makeStars(900);
  scene.add(stars);

  cityGroup = new THREE.Group();
  scene.add(cityGroup);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 6;
  controls.maxDistance = 900;

  // User interaction cancels any active camera tween.
  controls.addEventListener("start", () => {
    cameraTween = null;
    controls.enableDamping = true;
  });

  // First-person walk controls (Explore mode). Initially disconnected.
  fpControls = new PointerLockControls(camera, renderer.domElement);
  fpControls.addEventListener("unlock", () => {
    if (exploreActive) exitExplore();
  });
  window.addEventListener("keydown", onExploreKeyDown);
  window.addEventListener("keyup", onExploreKeyUp);

  resize(container);
  const ro = new ResizeObserver(() => resize(container));
  ro.observe(container);
  window.addEventListener("resize", () => resize(container));

  initialized = true;
  animate();
}

function resize(container) {
  if (!container || !renderer || !camera) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (!w || !h) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

// ---------- city build ----------

function clearCity() {
  if (!cityGroup) return;
  focusEffect = null; // its meshes live inside cityGroup; we'll dispose below
  while (cityGroup.children.length) {
    const o = cityGroup.children[0];
    cityGroup.remove(o);
    o.traverse((c) => {
      if (c.geometry) c.geometry.dispose();
      const mats = c.material ? (Array.isArray(c.material) ? c.material : [c.material]) : [];
      mats.forEach((m) => {
        if (m.map) m.map.dispose();
        m.dispose();
      });
    });
  }
  registry.clear();
  particleSystems = [];
}

function render(data) {
  if (!initialized) return;
  clearCity();

  const lay = window.AwsViz && window.AwsViz.getLayout && window.AwsViz.getLayout();
  if (!lay) return;

  SCALE = SCALE_TARGET / Math.max(lay.width, lay.height, 200);
  CITY.cx = lay.width / 2;
  CITY.cz = lay.height / 2;
  CITY.w = lay.width * SCALE;
  CITY.d = lay.height * SCALE;

  // VPC ground patches
  lay.vpcs.forEach(addVpc);

  // Subnet platforms
  lay.vpcs.forEach((v) => v.subnets.forEach(addSubnet));

  // IGWs (top-of-VPC)
  lay.vpcs.forEach((v) => v.igws.forEach(addBuilding));

  // Resources inside subnets
  lay.vpcs.forEach((v) =>
    v.subnets.forEach((s) => s.children.forEach(addBuilding)),
  );

  // Internet — represented as a glowing portal hovering over the city
  if (lay.internet) addInternetPortal(lay.internet);

  // Flows
  (data.flows || []).forEach(addFlow);

  // Frame the city
  const dist = Math.max(CITY.w, CITY.d) + 80;
  camera.position.set(dist * 0.35, dist * 0.55, dist * 0.85);
  controls.target.set(0, 4, 0);
  controls.update();

  // Adapt fog to city size so the whole layout is always visible from
  // overview, but distant detail still fades for atmosphere.
  const cd = Math.max(CITY.w, CITY.d, 80);
  if (scene.fog && scene.fog.isFog) {
    scene.fog.near = cd * 1.2;
    scene.fog.far = cd * 4.0;
  }
}

function pos3D(node) {
  return new THREE.Vector3(
    (node.x + node.w / 2 - CITY.cx) * SCALE,
    0,
    (node.y + node.h / 2 - CITY.cz) * SCALE,
  );
}
function dim3D(node) {
  return { w: Math.max(2, node.w * SCALE), d: Math.max(2, node.h * SCALE) };
}

function addVpc(vpc) {
  const p = pos3D(vpc);
  const { w, d } = dim3D(vpc);

  const grp = new THREE.Group();

  const geo = new THREE.BoxGeometry(w, 0.8, d);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1a1308,
    emissive: 0xff9900,
    emissiveIntensity: 0.08,
    roughness: 0.9,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(p.x, 0.4, p.z);
  mesh.receiveShadow = true;
  grp.add(mesh);

  const edges = new THREE.EdgesGeometry(geo);
  const line = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: 0xff9900, transparent: true, opacity: 0.55 }),
  );
  line.position.copy(mesh.position);
  grp.add(line);

  const label = makeLabel(`VPC · ${vpc.name || vpc.id}${vpc.cidr ? "  " + vpc.cidr : ""}`, "#ff9900");
  label.position.set(p.x, 14, p.z - d / 2 - 3);
  grp.add(label);

  cityGroup.add(grp);

  registry.set(vpc.id, {
    type: "vpc",
    position: new THREE.Vector3(p.x, 4, p.z),
    height: 0.4,
    extent: Math.max(w, d) / 2,
    mesh,
    group: grp,
  });
}

function addSubnet(s) {
  const p = pos3D(s);
  const { w, d } = dim3D(s);
  const tier = s.tier || "private";
  const palette = {
    public:  { base: 0x07291f, glow: 0x2dd4bf },
    private: { base: 0x09183a, glow: 0x60a5fa },
    data:    { base: 0x1d0e34, glow: 0xc084fc },
  }[tier] || { base: 0x09183a, glow: 0x60a5fa };

  const grp = new THREE.Group();

  const geo = new THREE.BoxGeometry(w, 1.4, d);
  const mat = new THREE.MeshStandardMaterial({
    color: palette.base,
    emissive: palette.glow,
    emissiveIntensity: 0.22,
    roughness: 0.7,
    metalness: 0.2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(p.x, 1.1, p.z);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  grp.add(mesh);

  const edges = new THREE.EdgesGeometry(geo);
  const line = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: palette.glow, transparent: true, opacity: 0.7 }),
  );
  line.position.copy(mesh.position);
  grp.add(line);

  const label = makeLabel(`${tier.toUpperCase()} · ${s.name || s.id}`, "#" + new THREE.Color(palette.glow).getHexString());
  label.position.set(p.x, 4, p.z - d / 2 - 1);
  grp.add(label);

  cityGroup.add(grp);

  registry.set(s.id, {
    type: "subnet",
    tier,
    position: new THREE.Vector3(p.x, 4, p.z),
    height: 0.8,
    extent: Math.max(w, d) / 2,
    mesh,
    group: grp,
  });
}

function addBuilding(node) {
  const p = pos3D(node);
  const slot = dim3D(node);
  const colors = (window.AWS_COLORS && window.AWS_COLORS[node.type]) || window.AWS_COLORS.unknown;
  const sz = pickSize(node.type, slot.w, slot.d);

  const grp = new THREE.Group();

  const geo = pickGeometry(node.type, sz);
  // Use the brand glow as the body colour so the box and the AWS icon on
  // its sides read as the same hue. Emissive boost keeps the colour
  // saturated under the city lighting at full brand brightness.
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(colors.glow),
    emissive: new THREE.Color(colors.glow),
    emissiveIntensity: 0.45,
    roughness: 0.42,
    metalness: 0.25,
  });
  const mesh = new THREE.Mesh(geo, mat);
  positionForGeometry(mesh, node.type, sz, p);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  grp.add(mesh);

  // Ground halo glow
  const halo = makeGlowSprite(colors.glow, sz.w * 3.0);
  halo.position.set(p.x, 2, p.z);
  grp.add(halo);

  // Top blinking light
  const blinkGeo = new THREE.SphereGeometry(0.4, 8, 6);
  const blinkMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const blink = new THREE.Mesh(blinkGeo, blinkMat);
  blink.position.set(p.x, sz.h + 2.6, p.z);
  blink.userData.blink = true;
  blink.userData.phase = Math.random() * Math.PI * 2;
  grp.add(blink);

  // AWS service icon — placed on the sides of the 3D shape (or as a billboard
  // when the geometry has no flat vertical face). No more redundant rooftop
  // tile or floating round badge.
  // Sized to fit comfortably on the side, centered vertically so the decal
  // is clearly *on* the building rather than near its top edge.
  const decalSize = Math.max(3, Math.min(sz.w, sz.d, sz.h) * 0.7);
  const decalY = 1.95 + sz.h * 0.5;
  if (hasFlatSides(node.type)) {
    const halfW = sz.w / 2;
    const halfD = sz.d / 2;
    // For a cylinder (sz.w = diameter) the plane's centre sits just outside
    // the radius and pokes through the curved surface only at the corners,
    // which is hidden by the icon's transparent halo edges.
    const sides = [
      { yaw: 0,             ox:  0,         oz:  halfD + 0.06 },
      { yaw: Math.PI,       ox:  0,         oz: -halfD - 0.06 },
      { yaw:  Math.PI / 2,  ox:  halfW + 0.06, oz: 0 },
      { yaw: -Math.PI / 2,  ox: -halfW - 0.06, oz: 0 },
    ];
    sides.forEach(({ yaw, ox, oz }) => {
      const decal = makeSideDecal(node.type, colors.glow, decalSize);
      decal.position.set(p.x + ox, decalY, p.z + oz);
      decal.rotation.y = yaw;
      grp.add(decal);
    });
  } else {
    const billboard = makeIconBillboard(node.type, colors.glow, decalSize);
    billboard.position.set(p.x, decalY, p.z);
    grp.add(billboard);
  }

  // Single name label well above the building so it never overlaps the
  // side decal or the blinking light on top.
  const label = makeLabel(
    truncate(node.name || node.id, 16),
    "#" + new THREE.Color(colors.glow).getHexString(),
  );
  label.position.set(p.x, sz.h + 7.5, p.z);
  grp.add(label);

  cityGroup.add(grp);

  registry.set(node.id, {
    type: node.type,
    position: new THREE.Vector3(p.x, sz.h / 2 + 1.9, p.z),
    height: sz.h,
    extent: Math.max(sz.w, sz.d) / 2 + 2,
    mesh,
    group: grp,
    baseY: mesh.position.y,
    baseEmissive: 0.45,
  });
}

function pickSize(type, w, d) {
  const fw = Math.max(5, Math.min(w, d) * 0.85);
  const heights = {
    ec2: 14, asg: 11, ecs: 13, eks: 17, lambda: 10,
    alb: 8, nlb: 8, waf: 12, igw: 9, nat: 7,
    rds: 13, aurora: 16, dynamodb: 11,
    s3: 10, cloudfront: 22, route53: 17, apigw: 11,
    sg: 8, nacl: 8, vpn: 10, dx: 10, tgw: 14, endpoint: 10,
  };
  const h = heights[type] || 11;
  return { w: fw, d: fw, h };
}

function pickGeometry(type, sz) {
  const { w, d, h } = sz;
  switch (type) {
    case "rds": case "aurora":
      return new THREE.CylinderGeometry(w * 0.45, w * 0.45, h, 24);
    case "dynamodb":
      return new THREE.CylinderGeometry(w * 0.45, w * 0.55, h, 6);
    case "lambda":
      return new THREE.OctahedronGeometry(w * 0.6);
    case "alb": case "nlb":
      return new THREE.BoxGeometry(w * 1.5, h, d * 0.6);
    case "cloudfront":
      return new THREE.ConeGeometry(w * 0.45, h, 6);
    case "s3":
      return new THREE.CylinderGeometry(w * 0.55, w * 0.55, h, 6);
    case "igw":
      return new THREE.TorusGeometry(w * 0.6, 0.7, 8, 24, Math.PI);
    case "nat":
      return new THREE.SphereGeometry(w * 0.55, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    case "tgw":
      return new THREE.CylinderGeometry(w * 0.55, w * 0.4, h, 12);
    case "route53":
      return new THREE.ConeGeometry(w * 0.5, h, 8);
    case "ecs": case "eks":
      return new THREE.BoxGeometry(w, h, d * 0.95);
    case "waf":
      return new THREE.BoxGeometry(w * 0.85, h, d * 0.6);
    default:
      return new THREE.BoxGeometry(w, h, d * 0.95);
  }
}

function positionForGeometry(mesh, type, sz, p) {
  // Subnets sit at y=1.8 (top); buildings rest just above that.
  const BASE = 1.9;
  switch (type) {
    case "igw":
      mesh.position.set(p.x, BASE + 1, p.z);
      mesh.rotation.x = Math.PI; // open downward (arch)
      break;
    case "nat":
      mesh.position.set(p.x, BASE, p.z);
      break;
    case "lambda":
      mesh.position.set(p.x, sz.h * 0.5 + BASE, p.z);
      mesh.rotation.y = Math.PI / 4;
      break;
    default:
      mesh.position.set(p.x, sz.h / 2 + BASE, p.z);
  }
}

function addInternetPortal(node) {
  const p = pos3D(node);
  const grp = new THREE.Group();

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(7, 0.7, 10, 36),
    new THREE.MeshStandardMaterial({
      color: 0xff5f86,
      emissive: 0xff5f86,
      emissiveIntensity: 1.2,
      transparent: true,
      opacity: 0.95,
    }),
  );
  ring.position.set(p.x, 16, p.z);
  ring.userData.spin = true;
  grp.add(ring);

  const disk = new THREE.Mesh(
    new THREE.CircleGeometry(6.2, 36),
    new THREE.MeshBasicMaterial({ color: 0xff5f86, transparent: true, opacity: 0.18, side: THREE.DoubleSide }),
  );
  disk.position.copy(ring.position);
  disk.rotation.x = Math.PI / 2;
  grp.add(disk);

  const halo = makeGlowSprite(0xff5f86, 28);
  halo.position.copy(ring.position);
  grp.add(halo);

  const label = makeLabel("INTERNET", "#ff5f86");
  label.position.set(p.x, 26, p.z);
  grp.add(label);

  cityGroup.add(grp);

  registry.set("internet", {
    type: "internet",
    position: ring.position.clone(),
    height: 14,
    extent: 10,
    mesh: ring,
    group: grp,
  });
}

// ---------- flows ----------

function addFlow(flow) {
  const a = registry.get(flow.from);
  const b = registry.get(flow.to);
  if (!a || !b) return;

  const start = a.position.clone();
  const end = b.position.clone();
  const dist = start.distanceTo(end);
  const mid = start.clone().lerp(end, 0.5);
  mid.y += Math.min(28, Math.max(6, dist * 0.32));

  const curve = new THREE.CatmullRomCurve3([start, mid, end]);

  const kind = flow.kind ||
    (a.type === "internet" ? "internet" :
     a.type === "nat" || b.type === "igw" ? "egress" : "internal");
  const colorMap = { internet: 0xff5f86, egress: 0xf5c451, internal: 0x60a5fa };
  const color = colorMap[kind] || 0x60a5fa;

  // The "road" — a thick illuminated tube
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 64, 0.55, 10, false),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.32, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  cityGroup.add(tube);

  // Glowing data packets streaming along the curve
  const N = 6 + Math.min(6, Math.floor(dist / 22));
  const sphereGeo = new THREE.SphereGeometry(1.15, 14, 10);
  const sphereMat = new THREE.MeshBasicMaterial({ color });
  // A second outer "halo" for the packet
  const haloGeo = new THREE.SphereGeometry(1.9, 12, 8);
  const haloMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.35,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const offsets = [];
  for (let i = 0; i < N; i++) {
    const m = new THREE.Mesh(sphereGeo, sphereMat);
    const halo = new THREE.Mesh(haloGeo, haloMat);
    cityGroup.add(m);
    cityGroup.add(halo);
    offsets.push({ mesh: m, halo, t: i / N, speed: 0.12 + Math.random() * 0.05 });
  }
  particleSystems.push({ curve, offsets, color, kind, fromId: flow.from, toId: flow.to });
}

function makeStars(count) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 700 + Math.random() * 600;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.5;
    pos[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.cos(phi);
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const tint = 0.7 + Math.random() * 0.3;
    col[i * 3 + 0] = tint;
    col[i * 3 + 1] = tint;
    col[i * 3 + 2] = tint + Math.random() * 0.2;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 1.4, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.9,
  });
  return new THREE.Points(geo, mat);
}

// ---------- skybox + ground textures ----------

// Procedural city-skyline panorama painted onto a 4096×1024 canvas.
// Wrapped around the camera as the inside of a sphere so distant city
// silhouettes surround the network "city" no matter which way you look.
function makeSkyTexture() {
  const W = 4096, H = 1024;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");

  // Vertical orientation when wrapped on a sphere (BackSide):
  //   canvas y = 0   → north pole (looking straight up) — deepest sky
  //   canvas y = H/2 → equator (the horizon line)
  //   canvas y = H   → south pole (looking straight down) — hidden by ground
  // So buildings live at canvas y ≈ H/2 with their tops going *up* the
  // canvas (smaller y) so they appear above the horizon when viewed from
  // inside the sphere.

  // Sky gradient
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0,    "#020512");  // overhead
  grad.addColorStop(0.3,  "#0a1432");
  grad.addColorStop(0.45, "#1a2a55");  // just above horizon
  grad.addColorStop(0.5,  "#2a2244");  // horizon glow
  grad.addColorStop(0.55, "#1f1832");
  grad.addColorStop(1,    "#050410");  // beneath horizon (mostly hidden)
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Stars in the upper part of the canvas (overhead sky)
  for (let i = 0; i < 700; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H * 0.4;
    const r = Math.random() * 1.4 + 0.4;
    ctx.fillStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.65})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Horizon glow band — centred on canvas y = H/2
  const horizon = ctx.createLinearGradient(0, H * 0.4, 0, H * 0.56);
  horizon.addColorStop(0,   "rgba(160, 100, 50, 0)");
  horizon.addColorStop(0.5, "rgba(200, 110, 60, 0.18)");
  horizon.addColorStop(1,   "rgba(100, 60, 130, 0.18)");
  ctx.fillStyle = horizon;
  ctx.fillRect(0, H * 0.4, W, H * 0.16);

  // Skyline silhouettes — bases sit at the horizon and tops climb UP into
  // the sky (smaller canvas y). Three layers give a sense of depth.
  function drawSkyline(yBase, alpha, heightFactor, windowChance) {
    let x = 0;
    while (x < W) {
      const w = 28 + Math.random() * 80;
      const h = (60 + Math.random() * 240) * heightFactor;
      const top = yBase - h;
      ctx.fillStyle = `rgba(${8 + Math.random() * 10},${12 + Math.random() * 12},${24 + Math.random() * 18},${alpha})`;
      ctx.fillRect(x, top, w, h);

      // Antenna or rooftop unit
      if (Math.random() < 0.18) {
        const aw = 2 + Math.random() * 4;
        ctx.fillRect(x + w * 0.5 - aw / 2, top - 8 - Math.random() * 14, aw, 8 + Math.random() * 14);
      } else if (Math.random() < 0.25) {
        const bw = w * (0.25 + Math.random() * 0.3);
        ctx.fillRect(x + (w - bw) / 2, top - 6, bw, 6);
      }

      // Lit windows
      const rows = Math.floor(h / 14);
      const cols = Math.max(1, Math.floor(w / 11));
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          if (Math.random() < windowChance) {
            const wx = x + 3 + i * 11;
            const wy = top + 6 + j * 14;
            const warm = Math.random() < 0.7;
            ctx.fillStyle = warm
              ? `rgba(${230 + Math.random() * 25},${200 + Math.random() * 40},120,${0.55 + Math.random() * 0.4})`
              : `rgba(120,200,${230 + Math.random() * 25},${0.5 + Math.random() * 0.4})`;
            ctx.fillRect(wx, wy, 5, 7);
          }
        }
      }
      x += w + Math.random() * 4;
    }
  }

  drawSkyline(H * 0.50, 0.80, 0.55, 0.28); // far layer
  drawSkyline(H * 0.51, 0.92, 0.80, 0.45); // mid
  drawSkyline(H * 0.52, 1.00, 1.00, 0.55); // near

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

// Daytime sibling of the night skybox — bright blue sky with sun, clouds,
// and city silhouettes that read as distant haze rather than glittering
// windows. Same UV layout as makeSkyTexture so the two are swappable.
function makeDaySkyTexture() {
  const W = 4096, H = 1024;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");

  // Sky gradient: zenith blue → pale-white at horizon
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0,    "#3f8ec7");
  grad.addColorStop(0.35, "#7ab1d9");
  grad.addColorStop(0.45, "#bcd6e8");
  grad.addColorStop(0.5,  "#e2eaf2");  // horizon haze
  grad.addColorStop(0.55, "#dbe3eb");
  grad.addColorStop(1,    "#b6c4d1");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Sun
  const sunX = W * 0.65, sunY = H * 0.20;
  const sunGrad = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 260);
  sunGrad.addColorStop(0,    "rgba(255, 255, 240, 1)");
  sunGrad.addColorStop(0.08, "rgba(255, 248, 215, 0.95)");
  sunGrad.addColorStop(0.25, "rgba(255, 235, 180, 0.55)");
  sunGrad.addColorStop(0.55, "rgba(255, 220, 160, 0.18)");
  sunGrad.addColorStop(1,    "rgba(255, 215, 150, 0)");
  ctx.fillStyle = sunGrad;
  ctx.fillRect(0, 0, W, H);

  // Clouds — a few soft elliptical blobs in the upper half
  for (let i = 0; i < 18; i++) {
    const cx = Math.random() * W;
    const cy = (Math.random() * 0.42 + 0.05) * H;
    const cw = 110 + Math.random() * 240;
    const ch = 26 + Math.random() * 44;
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cw);
    cg.addColorStop(0,   "rgba(255, 255, 255, 0.78)");
    cg.addColorStop(0.5, "rgba(255, 255, 255, 0.32)");
    cg.addColorStop(1,   "rgba(255, 255, 255, 0)");
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.ellipse(cx, cy, cw, ch, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // City silhouettes in muted blue-grey daylight tones
  function drawSkyline(yBase, alpha, heightFactor) {
    let x = 0;
    while (x < W) {
      const w = 28 + Math.random() * 80;
      const h = (40 + Math.random() * 200) * heightFactor;
      const top = yBase - h;
      const tint = 95 + Math.random() * 30;
      ctx.fillStyle = `rgba(${tint},${tint + 14},${tint + 36},${alpha})`;
      ctx.fillRect(x, top, w, h);

      if (Math.random() < 0.18) {
        const aw = 2 + Math.random() * 4;
        ctx.fillRect(x + w * 0.5 - aw / 2, top - 8 - Math.random() * 14, aw, 8 + Math.random() * 14);
      } else if (Math.random() < 0.22) {
        const bw = w * (0.25 + Math.random() * 0.3);
        ctx.fillRect(x + (w - bw) / 2, top - 6, bw, 6);
      }

      // A few darker windows so they read as glass in daylight
      const rows = Math.floor(h / 14);
      const cols = Math.max(1, Math.floor(w / 11));
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          if (Math.random() < 0.18) {
            ctx.fillStyle = "rgba(40, 55, 75, 0.55)";
            ctx.fillRect(x + 3 + i * 11, top + 6 + j * 14, 5, 7);
          }
        }
      }
      x += w + Math.random() * 4;
    }
  }
  drawSkyline(H * 0.50, 0.55, 0.55);
  drawSkyline(H * 0.51, 0.72, 0.80);
  drawSkyline(H * 0.52, 0.90, 1.00);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

// Procedural tileable "data centre floor" texture: dark substrate with
// server-rack rectangles, slot lines, and lit LED indicators. Wrapped
// over the ground plane so the network city sits on top of physical
// infrastructure.
function makeServerFloorTexture() {
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d");

  // Base
  ctx.fillStyle = "#0a1326";
  ctx.fillRect(0, 0, S, S);

  // Subtle grid lines (panel seams)
  ctx.strokeStyle = "rgba(40, 60, 100, 0.35)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= S; i += 32) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(S, i); ctx.stroke();
  }

  // Diagonal ambient hatching for depth
  ctx.strokeStyle = "rgba(80, 110, 180, 0.05)";
  ctx.lineWidth = 1;
  for (let i = -S; i < S * 2; i += 6) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + S, S); ctx.stroke();
  }

  const racks = [
    { x: 24,  y: 28,  w: 200, h: 78 },
    { x: 248, y: 38,  w: 224, h: 100 },
    { x: 32,  y: 134, w: 256, h: 78 },
    { x: 312, y: 158, w: 168, h: 64 },
    { x: 28,  y: 240, w: 192, h: 96 },
    { x: 244, y: 250, w: 232, h: 70 },
    { x: 56,  y: 360, w: 224, h: 84 },
    { x: 308, y: 350, w: 174, h: 96 },
  ];

  racks.forEach((r) => {
    // Soft drop shadow
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.fillRect(r.x + 2, r.y + 3, r.w, r.h);

    // Rack body — vertical gradient so it looks lit from above
    const g = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
    g.addColorStop(0, "#1a2a48");
    g.addColorStop(1, "#0e1830");
    ctx.fillStyle = g;
    ctx.fillRect(r.x, r.y, r.w, r.h);

    // Rack outline
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

    // Slot lines (horizontal divisions)
    ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
    for (let y = r.y + 8; y < r.y + r.h - 1; y += 8) {
      ctx.beginPath();
      ctx.moveTo(r.x + 3, y);
      ctx.lineTo(r.x + r.w - 3, y);
      ctx.stroke();
    }
    // Subtle highlight line at top of each slot
    ctx.strokeStyle = "rgba(120, 150, 220, 0.08)";
    for (let y = r.y + 8; y < r.y + r.h - 1; y += 8) {
      ctx.beginPath();
      ctx.moveTo(r.x + 3, y - 0.5);
      ctx.lineTo(r.x + r.w - 3, y - 0.5);
      ctx.stroke();
    }

    // LED column on the right edge
    const ledY0 = r.y + 6;
    for (let i = 0; ledY0 + i * 8 < r.y + r.h - 4; i++) {
      const cx = r.x + r.w - 6;
      const cy = ledY0 + i * 8;
      if (Math.random() < 0.72) {
        const isGreen = Math.random() < 0.62;
        const isAmber = !isGreen && Math.random() < 0.4;
        const color = isGreen
          ? "rgba(80, 220, 120,"
          : isAmber
          ? "rgba(255, 180, 80,"
          : "rgba(80, 160, 255,";
        ctx.fillStyle = color + "0.95)";
        ctx.beginPath(); ctx.arc(cx, cy, 1.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = color + "0.22)";
        ctx.beginPath(); ctx.arc(cx, cy, 3.8, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Brand label panel
    ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
    ctx.fillRect(r.x + 6, r.y + r.h - 6, 24, 3);
  });

  // A few faint cable-like traces between racks
  ctx.strokeStyle = "rgba(80, 140, 220, 0.18)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 220);   ctx.lineTo(S, 220);
  ctx.moveTo(0, 340);   ctx.lineTo(S, 340);
  ctx.moveTo(228, 0);   ctx.lineTo(228, S);
  ctx.moveTo(298, 0);   ctx.lineTo(298, S);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// ---------- AWS service icons ----------

// Paths into the mhlabs/aws-icons-directory repo (full-color official AWS
// architecture icons). Served via jsdelivr. Falls back to a glyph drawn from
// explanations.js when a type has no mapping or the request fails.
const ICON_BASE =
  "https://cdn.jsdelivr.net/gh/mhlabs/aws-icons-directory@main/icons/Architecture-Service-Icons/";
const ICON_PATHS = {
  ec2:        "Arch_Compute/64/Arch_Amazon-EC2_64.svg",
  asg:        "Arch_Compute/64/Arch_Amazon-EC2-Auto-Scaling_64.svg",
  lambda:     "Arch_Compute/64/Arch_AWS-Lambda_64.svg",
  ecs:        "Arch_Containers/64/Arch_Amazon-Elastic-Container-Service_64.svg",
  eks:        "Arch_Containers/64/Arch_Amazon-Elastic-Kubernetes-Service_64.svg",
  rds:        "Arch_Database/64/Arch_Amazon-RDS_64.svg",
  aurora:     "Arch_Database/64/Arch_Amazon-Aurora_64.svg",
  dynamodb:   "Arch_Database/64/Arch_Amazon-DynamoDB_64.svg",
  s3:         "Arch_Storage/64/Arch_Amazon-Simple-Storage-Service_64.svg",
  cloudfront: "Arch_Networking-Content/64/Arch_Amazon-CloudFront_64.svg",
  route53:    "Arch_Networking-Content/64/Arch_Amazon-Route-53_64.svg",
  vpc:        "Arch_Networking-Content/64/Arch_Amazon-Virtual-Private-Cloud_64.svg",
  igw:        "Arch_Networking-Content/64/Arch_Amazon-Virtual-Private-Cloud_64.svg",
  nat:        "Arch_Networking-Content/64/Arch_Amazon-Virtual-Private-Cloud_64.svg",
  endpoint:   "Arch_Networking-Content/64/Arch_Amazon-Virtual-Private-Cloud_64.svg",
  alb:        "Arch_Networking-Content/64/Arch_Elastic-Load-Balancing_64.svg",
  nlb:        "Arch_Networking-Content/64/Arch_Elastic-Load-Balancing_64.svg",
  tgw:        "Arch_Networking-Content/64/Arch_AWS-Transit-Gateway_64.svg",
  vpn:        "Arch_Networking-Content/64/Arch_AWS-Site-to-Site-VPN_64.svg",
  dx:         "Arch_Networking-Content/64/Arch_AWS-Direct-Connect_64.svg",
  waf:        "Arch_Security-Identity-Compliance/64/Arch_AWS-WAF_64.svg",
  apigw:      "Arch_App-Integration/64/Arch_Amazon-API-Gateway_64.svg",
};
const ICON_CACHE = new Map(); // type -> Promise<HTMLImageElement | null>

function loadIconImage(type) {
  if (ICON_CACHE.has(type)) return ICON_CACHE.get(type);
  const path = ICON_PATHS[type];
  if (!path) {
    const p = Promise.resolve(null);
    ICON_CACHE.set(type, p);
    return p;
  }
  const url = ICON_BASE + path;
  const p = fetch(url)
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error("HTTP " + r.status))))
    .then((svg) => {
      // Preserve the icon's original AWS colors. Only ensure the SVG has
      // explicit dimensions so drawImage scales reliably, and replace any
      // currentColor (rare in these assets) with a sensible default.
      svg = svg.replace(/currentColor/g, "#232F3E");
      svg = svg.replace(/<svg\b([^>]*?)>/, (m, attrs) => {
        let a = attrs;
        if (!/\swidth\s*=/.test(a)) a += ' width="256"';
        if (!/\sheight\s*=/.test(a)) a += ' height="256"';
        return `<svg${a}>`;
      });
      const dataUrl =
        "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = dataUrl;
      });
    })
    .catch((err) => {
      console.warn("[viz3d] icon load failed for", type, path, err);
      return null;
    });
  ICON_CACHE.set(type, p);
  return p;
}

// Returns true for shapes whose vertical sides are flat enough that a flat
// PlaneGeometry decal looks like a sticker on the side. Other shapes get a
// camera-facing billboard sprite instead.
function hasFlatSides(type) {
  return ![
    "lambda", "cloudfront", "route53", "igw", "nat",
  ].includes(type);
}

// Draws an AWS service icon (or glyph fallback) onto a 256² canvas. When a
// real AWS icon is available we draw it directly on a fully-transparent
// background — that way the decal looks like a sticker stuck to the side of
// the building (square, sharp), not a round badge floating in front of it.
// The glyph fallback gets a small dark plate so the letters are readable.
function drawIconCanvas(type, color, withGlyphFallback = true) {
  const meta = (window.AWS_EXPLAIN && window.AWS_EXPLAIN[type]) || window.AWS_EXPLAIN.unknown;
  const SIZE = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;

  function draw(iconImg) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, SIZE, SIZE);

    if (iconImg) {
      // Clean: just the AWS icon on transparent background.
      const sz = SIZE * 0.92;
      ctx.drawImage(iconImg, (SIZE - sz) / 2, (SIZE - sz) / 2, sz, sz);
    } else if (withGlyphFallback) {
      // Small rounded plate behind the glyph so it's readable.
      const pad = 18;
      ctx.fillStyle = "rgba(8, 14, 28, 0.78)";
      roundRect(ctx, pad, pad, SIZE - pad * 2, SIZE - pad * 2, 26);
      ctx.fill();
      const c = new THREE.Color(color);
      ctx.strokeStyle = `rgb(${(c.r * 255) | 0}, ${(c.g * 255) | 0}, ${(c.b * 255) | 0})`;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = `900 ${SIZE * 0.36}px -apple-system, system-ui, Segoe UI, Roboto, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(meta.glyph || (type || "?").toUpperCase().slice(0, 3), SIZE / 2, SIZE / 2 + 4);
    }
  }

  draw(null);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;

  loadIconImage(type).then((img) => {
    if (!img) return;
    draw(img);
    tex.needsUpdate = true;
  });

  return tex;
}

// A flat decal that sits on the side of a building.
function makeSideDecal(type, color, size) {
  const tex = drawIconCanvas(type, color);
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({
      map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  plane.userData.isLabel = true;
  plane.renderOrder = 3;
  return plane;
}

// A camera-facing icon used for shapes whose sides are not flat (cones,
// spheres, octahedra, the IGW arch).
function makeIconBillboard(type, color, size) {
  const tex = drawIconCanvas(type, color);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: true, depthWrite: false,
    }),
  );
  sprite.scale.set(size, size, 1);
  sprite.userData.isLabel = true;
  return sprite;
}

function makeLabel(text, color) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const tmp = document.createElement("canvas").getContext("2d");
  tmp.font = "bold 28px -apple-system, system-ui, Segoe UI, Roboto, sans-serif";
  const padX = 18;
  const tw = Math.ceil(tmp.measureText(text).width) + padX * 2;
  const th = 56;
  const canvas = document.createElement("canvas");
  canvas.width = tw * dpr;
  canvas.height = th * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "rgba(8, 14, 28, 0.85)";
  roundRect(ctx, 0, 0, tw, th, 14);
  ctx.fill();
  ctx.strokeStyle = color || "#ffffff";
  ctx.lineWidth = 1.5;
  roundRect(ctx, 0.75, 0.75, tw - 1.5, th - 1.5, 13.5);
  ctx.stroke();
  ctx.fillStyle = color || "#ffffff";
  ctx.font = "bold 28px -apple-system, system-ui, Segoe UI, Roboto, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, tw / 2, th / 2 + 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  // Depth-test ON so labels are properly occluded by buildings between
  // them and the camera. depthWrite is OFF so transparent edges don't
  // punch holes in things behind them.
  const mat = new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: true, depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  const aspect = tw / th;
  const scale = 5;
  sprite.scale.set(aspect * scale, scale, 1);
  sprite.renderOrder = 5;
  sprite.userData.isLabel = true;
  return sprite;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function makeGlowSprite(color, size) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  const col = new THREE.Color(color);
  const r = Math.round(col.r * 255), g = Math.round(col.g * 255), b = Math.round(col.b * 255);
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.55)`);
  grad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.15)`);
  grad.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({
    map: tex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.set(size, size, 1);
  return s;
}

function truncate(s, n) {
  s = String(s || "");
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

// ---------- camera & focus ----------

function focus(id, opts = {}) {
  const r = registry.get(id);
  if (!r) {
    if (opts.onComplete) opts.onComplete();
    return;
  }
  setFocusEffect(id);
  const target = r.position.clone();
  const isContainer = r.type === "vpc" || r.type === "subnet";

  // Frustum-fit distance.
  const fitDistance = r.extent * 1.92;
  const distance = isContainer
    ? clamp(fitDistance + 18, 30, Math.max(CITY.w, CITY.d) * 1.1 + 80)
    : clamp(Math.max(r.extent * 5, r.height * 1.6) + 6, 18, 80);

  // Side-on viewing: pick a horizontal direction radiating outward from the
  // city centre, with a small per-id perturbation so adjacent elements don't
  // line up identically. This keeps the focused element between the camera
  // and the rest of the city, so other buildings never end up between camera
  // and target.
  const seed = hashCode(id);
  const horizDir = new THREE.Vector3(target.x, 0, target.z);
  if (horizDir.lengthSq() < 25) {
    // Element near origin — pick a deterministic outward direction.
    const a = (seed % 1000) / 1000 * Math.PI * 2;
    horizDir.set(Math.cos(a), 0, Math.sin(a));
  } else {
    horizDir.normalize();
  }
  const sideAngle = (((seed * 31) % 100) - 50) / 100 * 0.45; // ±0.45 rad ≈ ±26°
  const ca = Math.cos(sideAngle), sa = Math.sin(sideAngle);
  const dirX = horizDir.x * ca - horizDir.z * sa;
  const dirZ = horizDir.x * sa + horizDir.z * ca;

  // Elevation: side-on for buildings (slight overhead), 3/4 for containers.
  const elev = isContainer
    ? distance * 0.5
    : r.height * 0.55 + 4;

  const aim = new THREE.Vector3(
    target.x,
    isContainer ? r.height * 0.5 : r.height * 0.45 + 1,
    target.z,
  );

  const camPos = new THREE.Vector3(
    target.x + dirX * distance,
    aim.y + elev,
    target.z + dirZ * distance,
  );

  const travel = camera.position.distanceTo(camPos);
  const auto = clamp(900 + travel * 5, 1200, 2600);
  const duration = opts.duration ?? auto;

  tweenCamera(camPos, aim, duration, opts.onComplete);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function clearFocus() {
  if (!initialized) return;
  setFocusEffect(null);
  const dist = Math.max(CITY.w, CITY.d) + 80;
  const camPos = new THREE.Vector3(dist * 0.35, dist * 0.55, dist * 0.85);
  const target = new THREE.Vector3(0, 4, 0);
  tweenCamera(camPos, target, 1100);
}

// ---------- day / night theme ----------

function setTheme(theme) {
  if (!initialized) return;
  currentTheme = theme === "day" ? "day" : "night";
  const isDay = currentTheme === "day";

  if (sky && sky.material) {
    sky.material.map = isDay ? daySkyTex : nightSkyTex;
    sky.material.needsUpdate = true;
  }
  if (stars) stars.visible = !isDay;

  if (scene && scene.fog) {
    scene.fog.color.set(isDay ? 0xb6c4d1 : 0x07101e);
  }
  if (renderer) {
    renderer.toneMappingExposure = isDay ? 1.05 : 1.05;
  }

  if (sunLight) {
    sunLight.color.set(isDay ? 0xfff4d8 : 0xffe2b8);
    sunLight.intensity = isDay ? 2.4 : 1.7;
  }
  if (rimLight) {
    rimLight.color.set(isDay ? 0xcfe1ff : 0x88aaff);
    rimLight.intensity = isDay ? 0.25 : 0.7;
  }
  if (hemiLight) {
    hemiLight.color.set(isDay ? 0xe9f3ff : 0xb6c8ff);
    hemiLight.groundColor.set(isDay ? 0x9aa6b3 : 0x0a1428);
    hemiLight.intensity = isDay ? 1.4 : 1.05;
  }
  if (ambientLight) {
    ambientLight.color.set(isDay ? 0xb8c4d4 : 0x6079a8);
    ambientLight.intensity = isDay ? 0.7 : 0.55;
  }
}

function getTheme() {
  return currentTheme;
}

// ---------- explore (first-person walk) ----------

function enterExplore() {
  if (!initialized || exploreActive) return;
  exploreActive = true;
  cameraTween = null;
  controls.enabled = false;

  // Spawn at pedestrian eye-level looking inward at the city. From here you
  // look UP at the taller buildings (CloudFront/Aurora) and over the tops
  // of shorter ones — the city wraps around you. Press Space to fly up.
  const startY = 10;
  const startZ = Math.max(18, CITY.d * 0.18);
  camera.position.set(0, startY, startZ);
  camera.lookAt(0, 8, 0);

  fpControls.lock();
  document.body.classList.add("exploring");
}

function exitExplore() {
  if (!exploreActive) return;
  exploreActive = false;
  if (fpControls.isLocked) fpControls.unlock();
  controls.enabled = true;
  document.body.classList.remove("exploring");
  hideProxPanel();
  proxEntryId = null;
  Object.keys(exploreKeys).forEach((k) => (exploreKeys[k] = false));
}

function isExploring() {
  return exploreActive;
}

function onExploreKeyDown(e) {
  if (!exploreActive) return;
  switch (e.code) {
    case "KeyW": case "ArrowUp":    exploreKeys.fwd  = true; break;
    case "KeyS": case "ArrowDown":  exploreKeys.back = true; break;
    case "KeyA": case "ArrowLeft":  exploreKeys.left = true; break;
    case "KeyD": case "ArrowRight": exploreKeys.right = true; break;
    case "Space":                   exploreKeys.up   = true; e.preventDefault(); break;
    case "ShiftLeft": case "ShiftRight": exploreKeys.down = true; break;
    case "Escape":                  exitExplore(); break;
  }
}
function onExploreKeyUp(e) {
  switch (e.code) {
    case "KeyW": case "ArrowUp":    exploreKeys.fwd  = false; break;
    case "KeyS": case "ArrowDown":  exploreKeys.back = false; break;
    case "KeyA": case "ArrowLeft":  exploreKeys.left = false; break;
    case "KeyD": case "ArrowRight": exploreKeys.right = false; break;
    case "Space":                   exploreKeys.up   = false; break;
    case "ShiftLeft": case "ShiftRight": exploreKeys.down = false; break;
  }
}

function updateExplore(dt) {
  if (!exploreActive || !fpControls.isLocked) return;
  const speed = 38 * dt; // units/second
  _moveDir.set(
    (exploreKeys.right ? 1 : 0) - (exploreKeys.left ? 1 : 0),
    0,
    0,
  );
  const fwd = (exploreKeys.fwd ? 1 : 0) - (exploreKeys.back ? 1 : 0);
  if (_moveDir.x !== 0 && fwd !== 0) _moveDir.multiplyScalar(0.7071);
  if (_moveDir.x !== 0) fpControls.moveRight(_moveDir.x * speed);
  if (fwd !== 0) fpControls.moveForward((fwd) * (Math.abs(_moveDir.x) ? 0.7071 : 1) * speed);
  if (exploreKeys.up)   camera.position.y += speed;
  if (exploreKeys.down) camera.position.y -= speed;
  // Keep above-ground; allow flying high
  if (camera.position.y < 1.5) camera.position.y = 1.5;

  updateProximity();
}

// ---------- proximity HUD ----------

function updateProximity() {
  let bestId = null;
  let bestDist = Infinity;
  registry.forEach((entry, id) => {
    if (entry.type === "vpc" || entry.type === "subnet") return;
    const d = camera.position.distanceTo(entry.position);
    const trigger = (entry.extent || 5) + 22; // bigger range for big elements
    if (d < trigger && d < bestDist) {
      bestId = id;
      bestDist = d;
    }
  });

  if (bestId === proxEntryId) return;
  proxEntryId = bestId;
  if (bestId == null) hideProxPanel();
  else showProxPanel(registry.get(bestId), bestId);
}

function showProxPanel(entry, id) {
  const panel = document.getElementById("prox-panel");
  if (!panel) return;
  const meta = (window.AWS_EXPLAIN && window.AWS_EXPLAIN[entry.type]) || window.AWS_EXPLAIN.unknown;
  const title = entry.name || id;
  panel.querySelector(".prox-eyebrow").textContent =
    `${meta.glyph || (entry.type || "").toUpperCase()} · ${meta.title}`;
  panel.querySelector(".prox-title").textContent = title;
  panel.querySelector(".prox-summary").textContent = meta.summary || "";
  panel.classList.add("show");
}

function hideProxPanel() {
  const panel = document.getElementById("prox-panel");
  if (panel) panel.classList.remove("show");
}

// ---------- tour spotlight effect ----------

function setFocusEffect(id) {
  // Tear down previous effect and restore the building's original emissive
  if (focusEffect) {
    if (focusEffect.targetMesh && focusEffect.targetMesh.material) {
      focusEffect.targetMesh.material.emissiveIntensity = focusEffect.baseEmissive;
    }
    cityGroup.remove(focusEffect.group);
    focusEffect.group.traverse((c) => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        const ms = Array.isArray(c.material) ? c.material : [c.material];
        ms.forEach((m) => m.dispose());
      }
    });
    focusEffect = null;
  }

  // Show or hide labels across the whole city based on whether something is
  // focused. Floating labels are 3D billboards — even with depthTest:true,
  // a label hovering in mid-air with nothing between it and the camera still
  // renders, so we just turn off every other entry's labels during focus.
  setLabelsVisibilityForFocus(id);

  if (!id) return;
  const r = registry.get(id);
  if (!r) return;

  const grp = new THREE.Group();
  const center = r.position.clone();

  // Vertical light beam — a thin downward cone of additive light
  const beamH = Math.min(120, r.height * 4 + 50);
  const beamR = Math.max(4, r.extent * 0.55 + 2);
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(beamR, beamH, 36, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffd966,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  beam.rotation.x = Math.PI;
  beam.position.set(center.x, beamH / 2 + 1, center.z);
  beam.userData.beam = true;
  grp.add(beam);

  // Pulsing flat ring on the ground around the element
  const ringR = Math.max(5, r.extent + 3);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(ringR - 0.9, ringR, 64),
    new THREE.MeshBasicMaterial({
      color: 0xffd966,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(center.x, 1.05, center.z);
  ring.userData.pulseRing = true;
  ring.userData.baseScale = 1;
  grp.add(ring);

  // Spinning torus halo above the building
  const haloR = Math.max(2.5, r.extent * 0.55 + 1);
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(haloR, 0.4, 10, 36),
    new THREE.MeshBasicMaterial({
      color: 0xffd966,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  halo.position.set(center.x, r.height + 6, center.z);
  halo.userData.spinHalo = true;
  grp.add(halo);

  cityGroup.add(grp);

  // Boost the focused mesh's emissive enough that it visibly pops without
  // bleaching the surface to yellow.
  let baseEmissive = 0.45;
  if (r.mesh && r.mesh.material) {
    baseEmissive = r.mesh.material.emissiveIntensity || baseEmissive;
    r.mesh.material.emissiveIntensity = Math.min(0.85, baseEmissive * 1.55 + 0.08);
  }

  focusEffect = { group: grp, targetMesh: r.mesh, baseEmissive, targetEntry: r };
}

// Toggle visibility of every label/badge/roof tile in the scene based on
// whether a tour focus is active. When `focusedId` is set, only that entry's
// labels stay on; all others are hidden so they can't float in front of the
// focused element. When null, everything is shown again.
function setLabelsVisibilityForFocus(focusedId) {
  registry.forEach((entry, id) => {
    if (!entry.group) return;
    const visible = !focusedId || id === focusedId;
    entry.group.traverse((c) => {
      if (c.userData && c.userData.isLabel) c.visible = visible;
    });
  });
}

// ---------- camera-occlusion fading ----------

const _camDir = new THREE.Vector3();
const _toMesh = new THREE.Vector3();
const _projection = new THREE.Vector3();

function updateOcclusion(targetEntry) {
  const camPos = camera.position;
  _camDir.subVectors(targetEntry.position, camPos);
  const targetDist = _camDir.length();
  if (targetDist < 0.001) return;
  _camDir.divideScalar(targetDist); // normalize

  registry.forEach((entry) => {
    if (!entry.group) return;             // VPCs / subnets / internet rings have no .group
    if (entry === targetEntry) {
      setEntryOpacity(entry, 1);
      return;
    }

    _toMesh.subVectors(entry.position, camPos);
    const proj = _toMesh.dot(_camDir);

    // Behind camera, or beyond / very near the target — keep fully visible.
    if (proj <= 0 || proj >= targetDist - 1.5) {
      setEntryOpacity(entry, 1);
      return;
    }

    // Perpendicular distance from this entry to the camera→target ray
    _projection.copy(_camDir).multiplyScalar(proj);
    const perp = _toMesh.distanceTo(_projection.add(camPos));
    const r = (entry.extent || 4) + 3;

    if (perp < r) {
      // Inside the line-of-sight cone — fade more the closer to the ray.
      const t = perp / r;                       // 0 = on ray, 1 = at edge
      const opacity = 0.12 + t * 0.5;           // 0.12 .. 0.62
      setEntryOpacity(entry, opacity);
    } else {
      setEntryOpacity(entry, 1);
    }
  });
}

function setEntryOpacity(entry, opacity) {
  if (entry._lastOpacity === opacity) return;
  entry._lastOpacity = opacity;
  entry.group.traverse((c) => {
    // Labels are governed by setLabelsVisibilityForFocus, not the occlusion
    // fader — leave their material/visibility alone here.
    if (c.userData && c.userData.isLabel) return;
    if (!c.material) return;
    const ms = Array.isArray(c.material) ? c.material : [c.material];
    ms.forEach((m) => {
      if (m._origOpacity === undefined) {
        m._origOpacity = (m.opacity != null) ? m.opacity : 1;
        m._origTransparent = !!m.transparent;
      }
      if (opacity >= 1) {
        m.opacity = m._origOpacity;
        m.transparent = m._origTransparent;
      } else {
        m.transparent = true;
        m.opacity = opacity * m._origOpacity;
      }
    });
  });
}

function restoreAllOpacities() {
  registry.forEach((entry) => {
    if (entry._lastOpacity === 1 || entry._lastOpacity === undefined) return;
    setEntryOpacity(entry, 1);
  });
}

function haveAnyFaded() {
  for (const entry of registry.values()) {
    if (entry._lastOpacity !== undefined && entry._lastOpacity < 1) return true;
  }
  return false;
}

function tweenCamera(toPos, toTarget, durationMs, onComplete) {
  const fromPos = camera.position.clone();
  const fromTarget = controls.target.clone();
  const start = performance.now();
  // Disable damping during the tween so OrbitControls' inertia doesn't
  // wrestle with our manual position assignments.
  controls.enableDamping = false;

  // Travel arc — gently lift the camera and target as they cross the city
  // so the motion feels like a glide rather than a straight slide.
  const travel = fromPos.distanceTo(toPos);
  const arc = Math.min(60, travel * 0.18);

  cameraTween = (now) => {
    const t = Math.min(1, (now - start) / durationMs);
    const e = easeInOutQuint(t);
    camera.position.lerpVectors(fromPos, toPos, e);
    controls.target.lerpVectors(fromTarget, toTarget, e);
    // Sin-shaped arc: zero at endpoints, peak at midpoint
    const lift = arc * Math.sin(t * Math.PI);
    camera.position.y += lift;
    controls.target.y += lift * 0.25;

    if (t >= 1) {
      cameraTween = null;
      controls.enableDamping = true;
      if (onComplete) onComplete();
    }
  };
}

function easeInOutQuint(t) {
  return t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;
}

function hashCode(s) {
  let h = 0;
  s = String(s);
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i) | 0;
  return Math.abs(h);
}

// ---------- animation loop ----------

function animate() {
  raf = requestAnimationFrame(animate);
  // Skip rendering when the 3D stage is hidden — saves GPU/CPU.
  const container = renderer.domElement.parentElement;
  if (!container || container.hidden) {
    lastT = performance.now();
    return;
  }
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastT) / 1000) || 0;
  lastT = now;

  // Packets streaming along flow tubes
  particleSystems.forEach(({ curve, offsets }) => {
    offsets.forEach((o) => {
      o.t += o.speed * dt;
      if (o.t > 1) o.t -= 1;
      const p = curve.getPointAt(o.t);
      o.mesh.position.copy(p);
      if (o.halo) o.halo.position.copy(p);
    });
  });

  // Internet ring spin + blinking lights
  cityGroup.traverse((c) => {
    if (c.userData.spin) c.rotation.z += dt * 0.6;
    if (c.userData.blink) {
      const v = (Math.sin(now / 250 + c.userData.phase) + 1) / 2;
      c.material.color.setRGB(1, 0.9, 0.5 + 0.5 * v);
      c.scale.setScalar(0.6 + v * 0.6);
    }
  });

  // Tour spotlight animation
  if (focusEffect) {
    focusEffect.group.traverse((c) => {
      if (c.userData.pulseRing) {
        const v = (Math.sin(now / 350) + 1) / 2;
        c.scale.setScalar(1 + v * 0.22);
        c.material.opacity = 0.55 + v * 0.4;
      } else if (c.userData.spinHalo) {
        c.rotation.y += dt * 1.4;
        c.rotation.x = Math.sin(now / 1100) * 0.3;
        const v = (Math.sin(now / 420) + 1) / 2;
        c.material.opacity = 0.55 + v * 0.35;
      } else if (c.userData.beam) {
        const v = (Math.sin(now / 700) + 1) / 2;
        c.material.opacity = 0.14 + v * 0.12;
      }
    });
    if (focusEffect.targetEntry) updateOcclusion(focusEffect.targetEntry);
  } else if (registry.size && haveAnyFaded()) {
    restoreAllOpacities();
  }

  if (cameraTween) cameraTween(now);

  if (exploreActive) updateExplore(dt);
  else controls.update();

  renderer.render(scene, camera);
}

// Expose to non-module callers
window.AwsViz3D = {
  init,
  render,
  focus,
  clearFocus,
  enterExplore,
  exitExplore,
  isExploring,
  setTheme,
  getTheme,
  isReady: () => initialized,
};
