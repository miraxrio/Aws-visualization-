// 3D "city" visualization of an imported AWS network.
// Built with Three.js. Reuses the layout produced by visualizer.js (the 2D
// renderer) so positions stay consistent between modes.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";

console.log("[viz3d] build 2026-05-05m — siege-style attack visuals");

let initialized = false;
let scene, camera, renderer, controls, fpControls;
let cityGroup;
let particleSystems = [];
let registry = new Map(); // id -> { type, position, height, extent, mesh, group, baseY }
let cameraTween = null;
let raf = null;
let lastT = 0;
let focusEffect = null; // { group, targetMesh, baseEmissive }

// Attack-simulation state. attackState is null when no attack is in flight.
let attackState = null;
let attackerLayer = null; // Three.js group all attack visuals are parented to

// Theme handles, populated by init()
let sky, sunLight, rimLight, hemiLight, ambientLight, stars, ground;
let nightSkyTex, daySkyTex;
let nightGroundTex, dayGroundTex;     // outer ground (server floor)
let nightStreetTex, dayStreetTex;     // VPC top face (city streets)
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

  // Outer ground around the whole network city — looks like a brightly-
  // lit data-centre floor: server racks with neon LED indicators, glowing
  // cable traces. The network city literally sits on top of the hardware.
  nightGroundTex  = makeServerFloorTexture("night");
  dayGroundTex    = makeServerFloorTexture("day");
  nightGroundTex.repeat.set(14, 14);
  dayGroundTex.repeat.set(14, 14);

  // Street texture used inside each VPC (top face of the VPC ground patch).
  nightStreetTex = makeStreetTexture("night");
  dayStreetTex   = makeStreetTexture("day");

  ground = new THREE.Mesh(
    new THREE.PlaneGeometry(3000, 3000),
    new THREE.MeshStandardMaterial({
      map: nightGroundTex,
      roughness: 0.6,
      metalness: 0.35,
      emissive: 0x1c2f5a,
      emissiveIntensity: 0.32,
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

  // Attack simulation visuals live in their own group so they tear down
  // cleanly without touching the city.
  attackerLayer = new THREE.Group();
  scene.add(attackerLayer);

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

  // Street texture on the TOP face of the VPC ground (the area between
  // subnet platforms reads as actual streets/intersections), with solid
  // dark sides so the box reads as a raised plot edged in orange.
  // BoxGeometry material order: [+X, -X, +Y, -Y, +Z, -Z] — index 2 is top.
  const streetTex = currentTheme === "day" ? dayStreetTex : nightStreetTex;
  // Tile so the city blocks read at building scale (~32 world units / tile).
  const repeat = Math.max(2, Math.round(Math.min(w, d) / 32));
  // Per-VPC clone so each VPC can have its own .repeat without colliding
  const tex = streetTex.clone();
  tex.needsUpdate = true;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, Math.max(2, Math.round((d / w) * repeat)));
  const topMat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.78,
    metalness: 0.2,
    emissive: 0xff9900,
    emissiveIntensity: 0.04,
  });
  const sideMat = new THREE.MeshStandardMaterial({
    color: 0x281b08,
    emissive: 0xff9900,
    emissiveIntensity: 0.08,
    roughness: 0.9,
  });
  const geo = new THREE.BoxGeometry(w, 0.8, d);
  const mesh = new THREE.Mesh(geo, [sideMat, sideMat, topMat, sideMat, sideMat, sideMat]);
  mesh.position.set(p.x, 0.4, p.z);
  mesh.receiveShadow = true;
  // Tag so setTheme can swap the texture later
  mesh.userData.vpcTopMat = topMat;
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
  // Palettes brightened so each subnet reads as a coloured "yard" sitting
  // on top of the grey-blue street ground rather than a dim panel.
  const palette = {
    public:  { base: 0x0d4a36, glow: 0x2dd4bf }, // teal lawn
    private: { base: 0x102b6a, glow: 0x60a5fa }, // blue lawn
    data:    { base: 0x361b5a, glow: 0xc084fc }, // violet lawn
  }[tier] || { base: 0x102b6a, glow: 0x60a5fa };

  const grp = new THREE.Group();

  const geo = new THREE.BoxGeometry(w, 1.4, d);
  const mat = new THREE.MeshStandardMaterial({
    color: palette.base,
    emissive: palette.glow,
    emissiveIntensity: 0.32,
    roughness: 0.65,
    metalness: 0.15,
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

  // Spinner host — every building goes here. For aurora and lambda this
  // group rotates slowly around its Y axis so the building (and the icon
  // decals around it) appear to spin. For everything else it's a static
  // anchor at (p.x, 0, p.z) so children can use local positions.
  const spinner = new THREE.Group();
  spinner.position.set(p.x, 0, p.z);
  if (node.type === "aurora" || node.type === "lambda") {
    spinner.userData.spinY = true;
    spinner.userData.spinSpeed = node.type === "aurora" ? 0.25 : 0.55; // rad/s
  }
  grp.add(spinner);

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
  positionForGeometryLocal(mesh, node.type, sz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  spinner.add(mesh);

  // Ground halo glow — does NOT rotate (sits on the floor like a footprint)
  const halo = makeGlowSprite(colors.glow, sz.w * 3.0);
  halo.position.set(p.x, 2, p.z);
  grp.add(halo);

  // Top blinking light — local to spinner so it follows rotating buildings
  const blinkGeo = new THREE.SphereGeometry(0.4, 8, 6);
  const blinkMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const blink = new THREE.Mesh(blinkGeo, blinkMat);
  blink.position.set(0, sz.h + 2.6, 0);
  blink.userData.blink = true;
  blink.userData.phase = Math.random() * Math.PI * 2;
  spinner.add(blink);

  // AWS service icon — placed tight against each face of the 3D shape (or
  // as a single camera-facing billboard for shapes whose sides aren't flat).
  // Decals are inside the spinner so they orbit with rotating buildings.
  const decalSize = Math.max(3, Math.min(sz.w, sz.d, sz.h) * 0.7);
  const decalY = 1.95 + sz.h * 0.5;
  if (hasFlatSides(node.type)) {
    const off = decalOffset(node.type, sz);
    const sides = [
      { yaw: 0,             ox:  0,             oz:  off.z + 0.04 },
      { yaw: Math.PI,       ox:  0,             oz: -(off.z + 0.04) },
      { yaw:  Math.PI / 2,  ox:  off.x + 0.04,  oz:  0 },
      { yaw: -Math.PI / 2,  ox: -(off.x + 0.04), oz: 0 },
    ];
    sides.forEach(({ yaw, ox, oz }) => {
      const decal = makeSideDecal(node.type, colors.glow, decalSize);
      decal.position.set(ox, decalY, oz);
      decal.rotation.y = yaw;
      spinner.add(decal);
    });
  } else {
    const billboard = makeIconBillboard(node.type, colors.glow, decalSize);
    billboard.position.set(0, decalY, 0);
    spinner.add(billboard);
  }

  // Single name label well above the building. It stays on the OUTER group
  // (in world coords) so it never rotates with the spinner — sprites
  // already face the camera regardless of parent rotation.
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

// For each building type, the actual half-extent in X/Z direction (where
// the visible side face is, given pickGeometry's per-type scaling). Used
// to place side decals tight against the surface — important for shapes
// whose geometry doesn't fill the slot, like Aurora (cylinder, r = w*0.45)
// or non-square boxes like WAF / ALB.
function decalOffset(type, sz) {
  switch (type) {
    case "alb": case "nlb":
      // BoxGeometry(w * 1.4, h, d * 0.6)
      return { x: sz.w * 0.7,   z: sz.d * 0.3 };
    case "waf":
      // BoxGeometry(w * 0.85, h, d * 0.6)
      return { x: sz.w * 0.425, z: sz.d * 0.3 };
    case "rds": case "aurora":
      // CylinderGeometry(w*0.45, w*0.45)
      return { x: sz.w * 0.45,  z: sz.w * 0.45 };
    case "s3":
      // CylinderGeometry(w*0.55, w*0.55, h, 6) — hex prism
      return { x: sz.w * 0.55,  z: sz.w * 0.55 };
    case "dynamodb":
      return { x: sz.w * 0.5,   z: sz.w * 0.5 };
    case "tgw":
      return { x: sz.w * 0.55,  z: sz.w * 0.55 };
    case "ecs": case "eks":
      // BoxGeometry(w, h, d * 0.95)
      return { x: sz.w * 0.5,   z: sz.d * 0.475 };
    default:
      return { x: sz.w * 0.5,   z: sz.d * 0.475 };
  }
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

// Position a building's mesh in LOCAL coordinates (relative to the
// per-building spinner sub-group at p.x, 0, p.z). XZ is always 0.
function positionForGeometryLocal(mesh, type, sz) {
  // Subnets sit at y=1.8 (top); buildings rest just above that.
  const BASE = 1.9;
  switch (type) {
    case "igw":
      mesh.position.set(0, BASE + 1, 0);
      mesh.rotation.x = Math.PI; // open downward (arch)
      break;
    case "nat":
      mesh.position.set(0, BASE, 0);
      break;
    case "lambda":
      mesh.position.set(0, sz.h * 0.5 + BASE, 0);
      mesh.rotation.y = Math.PI / 4;
      break;
    default:
      mesh.position.set(0, sz.h / 2 + BASE, 0);
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

  // Sky gradient — deep indigo overhead, soft purple haze near the horizon
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0,    "#0a0524");  // overhead — purple-tinted navy
  grad.addColorStop(0.3,  "#170c3c");
  grad.addColorStop(0.45, "#2a1a55");  // just above horizon, vivid purple
  grad.addColorStop(0.5,  "#3a2360");  // horizon — saturated purple
  grad.addColorStop(0.55, "#2a1a45");
  grad.addColorStop(1,    "#0a0420");
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

  // Horizon glow band — centred on canvas y = H/2, with a richer magenta-pink hue
  const horizon = ctx.createLinearGradient(0, H * 0.4, 0, H * 0.56);
  horizon.addColorStop(0,   "rgba(120, 60, 180, 0)");
  horizon.addColorStop(0.5, "rgba(190, 90, 200, 0.22)");
  horizon.addColorStop(1,   "rgba(80, 40, 130, 0.20)");
  ctx.fillStyle = horizon;
  ctx.fillRect(0, H * 0.4, W, H * 0.16);

  // Skyline silhouettes — sparse so the sky stays open. Three thin layers
  // for depth.
  function drawSkyline(yBase, alpha, heightFactor, windowChance) {
    let x = 0;
    while (x < W) {
      const w = 28 + Math.random() * 80;
      const h = (60 + Math.random() * 240) * heightFactor;
      const top = yBase - h;
      ctx.fillStyle = `rgba(${10 + Math.random() * 12},${10 + Math.random() * 14},${28 + Math.random() * 22},${alpha})`;
      ctx.fillRect(x, top, w, h);

      // Antenna or rooftop unit
      if (Math.random() < 0.14) {
        const aw = 2 + Math.random() * 4;
        ctx.fillRect(x + w * 0.5 - aw / 2, top - 8 - Math.random() * 14, aw, 8 + Math.random() * 14);
      } else if (Math.random() < 0.18) {
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
              : `rgba(180,150,${235 + Math.random() * 20},${0.5 + Math.random() * 0.4})`;
            ctx.fillRect(wx, wy, 5, 7);
          }
        }
      }
      // Big spacing so the skyline reads "city in the distance" not "wall"
      x += w + 80 + Math.random() * 160;
    }
  }

  drawSkyline(H * 0.50, 0.78, 0.55, 0.26); // far
  drawSkyline(H * 0.51, 0.90, 0.80, 0.42); // mid
  drawSkyline(H * 0.52, 0.96, 1.00, 0.50); // near

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

  // Sky gradient: deep saturated blue, only a hint of haze at the horizon
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0,    "#1c5fa6");  // zenith — deep blue
  grad.addColorStop(0.35, "#3a86c8");
  grad.addColorStop(0.45, "#6aa9d8");
  grad.addColorStop(0.5,  "#90c2e4");  // horizon — light blue, NOT white
  grad.addColorStop(0.55, "#7dade0");
  grad.addColorStop(1,    "#5a8ec3");
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

  // City silhouettes — sparse so the blue sky dominates
  function drawSkyline(yBase, alpha, heightFactor) {
    let x = 0;
    while (x < W) {
      const w = 28 + Math.random() * 80;
      const h = (40 + Math.random() * 200) * heightFactor;
      const top = yBase - h;
      const tint = 110 + Math.random() * 30;
      ctx.fillStyle = `rgba(${tint},${tint + 14},${tint + 32},${alpha})`;
      ctx.fillRect(x, top, w, h);

      if (Math.random() < 0.16) {
        const aw = 2 + Math.random() * 4;
        ctx.fillRect(x + w * 0.5 - aw / 2, top - 8 - Math.random() * 14, aw, 8 + Math.random() * 14);
      } else if (Math.random() < 0.18) {
        const bw = w * (0.25 + Math.random() * 0.3);
        ctx.fillRect(x + (w - bw) / 2, top - 6, bw, 6);
      }

      const rows = Math.floor(h / 14);
      const cols = Math.max(1, Math.floor(w / 11));
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          if (Math.random() < 0.14) {
            ctx.fillStyle = "rgba(35, 50, 75, 0.5)";
            ctx.fillRect(x + 3 + i * 11, top + 6 + j * 14, 5, 7);
          }
        }
      }
      // Big spacing between buildings (matches night skyline)
      x += w + 80 + Math.random() * 160;
    }
  }
  drawSkyline(H * 0.50, 0.50, 0.55);
  drawSkyline(H * 0.51, 0.66, 0.80);
  drawSkyline(H * 0.52, 0.82, 1.00);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

// Procedural tileable "data-centre floor" texture used for the OUTER
// ground around the whole network city. Brighter / more neon than the
// previous version so the city sits on top of a glowing data hall
// rather than a dim cellar.
function makeServerFloorTexture(theme) {
  const isDay = theme === "day";
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d");

  // Substrate — much brighter than the original #0a1326. Night reads as a
  // lit-up electric-blue floor, day as brushed metal.
  ctx.fillStyle = isDay ? "#5a6e8a" : "#1c2f5a";
  ctx.fillRect(0, 0, S, S);

  // Subtle panel-seam grid
  ctx.strokeStyle = isDay ? "rgba(20, 35, 70, 0.25)" : "rgba(140, 180, 255, 0.10)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= S; i += 32) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(S, i); ctx.stroke();
  }
  // Diagonal hatching for depth
  ctx.strokeStyle = isDay ? "rgba(20, 30, 60, 0.05)" : "rgba(140, 180, 255, 0.06)";
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
    ctx.fillStyle = "rgba(0, 0, 0, 0.42)";
    ctx.fillRect(r.x + 2, r.y + 3, r.w, r.h);

    const g = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
    if (isDay) { g.addColorStop(0, "#94a8c0"); g.addColorStop(1, "#536a86"); }
    else       { g.addColorStop(0, "#243a66"); g.addColorStop(1, "#0e1d40"); }
    ctx.fillStyle = g;
    ctx.fillRect(r.x, r.y, r.w, r.h);

    ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

    ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
    for (let y = r.y + 8; y < r.y + r.h - 1; y += 8) {
      ctx.beginPath(); ctx.moveTo(r.x + 3, y); ctx.lineTo(r.x + r.w - 3, y); ctx.stroke();
    }
    ctx.strokeStyle = isDay ? "rgba(255, 255, 255, 0.20)" : "rgba(160, 200, 255, 0.10)";
    for (let y = r.y + 8; y < r.y + r.h - 1; y += 8) {
      ctx.beginPath(); ctx.moveTo(r.x + 3, y - 0.5); ctx.lineTo(r.x + r.w - 3, y - 0.5); ctx.stroke();
    }

    // Neon LED column on the right — bigger / brighter halos
    const ledY0 = r.y + 6;
    for (let i = 0; ledY0 + i * 8 < r.y + r.h - 4; i++) {
      const cx = r.x + r.w - 6;
      const cy = ledY0 + i * 8;
      if (Math.random() < 0.78) {
        const roll = Math.random();
        const color = roll < 0.45 ? "rgba(80, 250, 140,"
                    : roll < 0.7  ? "rgba(120, 220, 255,"
                    : roll < 0.88 ? "rgba(255, 200, 90,"
                                  : "rgba(255, 90, 220,";
        ctx.fillStyle = color + "1)";
        ctx.beginPath(); ctx.arc(cx, cy, 1.6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = color + "0.45)";
        ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = color + "0.18)";
        ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.fill();
      }
    }

    ctx.fillStyle = isDay ? "rgba(255, 255, 255, 0.22)" : "rgba(255, 255, 255, 0.08)";
    ctx.fillRect(r.x + 6, r.y + r.h - 6, 24, 3);
  });

  // Glowing neon traces between racks
  ctx.lineWidth = 2;
  ctx.strokeStyle = isDay ? "rgba(20, 100, 200, 0.4)" : "rgba(120, 200, 255, 0.45)";
  ctx.shadowColor  = isDay ? "rgba(20, 100, 200, 0.4)" : "rgba(120, 200, 255, 0.6)";
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.moveTo(0, 220);   ctx.lineTo(S, 220);
  ctx.moveTo(0, 340);   ctx.lineTo(S, 340);
  ctx.moveTo(228, 0);   ctx.lineTo(228, S);
  ctx.moveTo(298, 0);   ctx.lineTo(298, S);
  ctx.stroke();
  ctx.shadowBlur = 0;

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// Procedural tileable city-block STREET texture used inside each VPC
// (the patch between subnet platforms). 4×4 grid of paving tiles framed
// by sidewalks with dashed centre-lines, crosswalks, and a couple of
// manhole covers — so the area inside a VPC reads as streets, with the
// colourful subnet platforms as yards on top.
function makeStreetTexture(theme) {
  const isDay = theme === "day";
  const S = 512;
  const tile = S / 4; // 4 city blocks per texture tile
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d");

  // Asphalt base — much brighter than the old server floor.
  ctx.fillStyle = isDay ? "#7d8aa3" : "#384866";
  ctx.fillRect(0, 0, S, S);

  // Subtle grain
  for (let i = 0; i < 1800; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const a = 0.05 + Math.random() * 0.12;
    ctx.fillStyle = isDay
      ? `rgba(40, 50, 70, ${a})`
      : `rgba(140, 160, 200, ${a * 0.8})`;
    ctx.fillRect(x, y, 1, 1);
  }

  // Diagonal ambient hatching for depth
  ctx.strokeStyle = isDay
    ? "rgba(40, 55, 80, 0.06)"
    : "rgba(140, 160, 220, 0.05)";
  ctx.lineWidth = 1;
  for (let i = -S; i < S * 2; i += 6) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + S, S); ctx.stroke();
  }

  // Inner tile (paving block) — slightly darker square framed by sidewalks
  const sidewalkW = 10;
  for (let bx = 0; bx < 4; bx++) {
    for (let by = 0; by < 4; by++) {
      const ox = bx * tile, oy = by * tile;
      // Block tile interior
      ctx.fillStyle = isDay ? "#67768f" : "#293b58";
      ctx.fillRect(
        ox + sidewalkW, oy + sidewalkW,
        tile - sidewalkW * 2, tile - sidewalkW * 2,
      );
      // Sidewalk lines (lighter band around the block)
      ctx.fillStyle = isDay
        ? "rgba(220, 228, 238, 0.55)"
        : "rgba(180, 195, 220, 0.20)";
      // top, bottom, left, right strips
      ctx.fillRect(ox + 4, oy + 4, tile - 8, sidewalkW - 4);
      ctx.fillRect(ox + 4, oy + tile - sidewalkW, tile - 8, sidewalkW - 4);
      ctx.fillRect(ox + 4, oy + 4, sidewalkW - 4, tile - 8);
      ctx.fillRect(ox + tile - sidewalkW, oy + 4, sidewalkW - 4, tile - 8);
    }
  }

  // Road seams between tile blocks (slightly darker than asphalt)
  ctx.fillStyle = isDay ? "#414d63" : "#1c2640";
  for (let i = 0; i <= 4; i++) {
    ctx.fillRect(i * tile - 1.5, 0, 3, S);
    ctx.fillRect(0, i * tile - 1.5, S, 3);
  }

  // Yellow dashed centre line along main horizontal/vertical roads (every
  // other seam) so the streets read clearly.
  ctx.fillStyle = isDay
    ? "rgba(240, 200, 70, 0.95)"
    : "rgba(240, 200, 70, 0.75)";
  for (let row = 1; row < 4; row += 2) {
    const y = row * tile - 1;
    for (let x = 4; x < S; x += 22) {
      ctx.fillRect(x, y, 12, 2);
    }
  }
  for (let col = 1; col < 4; col += 2) {
    const x = col * tile - 1;
    for (let y = 4; y < S; y += 22) {
      ctx.fillRect(x, y, 2, 12);
    }
  }

  // Crosswalks at the four interior intersections
  const stripeColor = isDay
    ? "rgba(245, 250, 255, 0.95)"
    : "rgba(225, 235, 250, 0.6)";
  ctx.fillStyle = stripeColor;
  for (let row = 1; row < 4; row++) {
    for (let col = 1; col < 4; col++) {
      const ix = col * tile;
      const iy = row * tile;
      // 4 short stripes on each of the 4 approach legs
      // North leg
      for (let s = 0; s < 4; s++) ctx.fillRect(ix - 14 + s * 8, iy - tile * 0.16, 4, 10);
      // South leg
      for (let s = 0; s < 4; s++) ctx.fillRect(ix - 14 + s * 8, iy + tile * 0.16 - 10, 4, 10);
      // West leg
      for (let s = 0; s < 4; s++) ctx.fillRect(ix - tile * 0.16, iy - 14 + s * 8, 10, 4);
      // East leg
      for (let s = 0; s < 4; s++) ctx.fillRect(ix + tile * 0.16 - 10, iy - 14 + s * 8, 10, 4);
    }
  }

  // A few manhole covers scattered on the inner tile interiors
  for (let i = 0; i < 6; i++) {
    const x = (Math.random() * 0.8 + 0.1) * S;
    const y = (Math.random() * 0.8 + 0.1) * S;
    ctx.fillStyle = isDay ? "rgba(40, 50, 70, 0.55)" : "rgba(15, 25, 45, 0.7)";
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = isDay ? "rgba(120, 135, 160, 0.6)" : "rgba(80, 100, 140, 0.55)";
    ctx.lineWidth = 1;
    ctx.stroke();
    // Cross detail
    ctx.beginPath();
    ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y);
    ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// ---------- AWS service icons ----------

// Slugs into the simple-icons npm package (served via jsdelivr). These are
// monochrome SVGs — we force-inject a white fill so the icons read as
// clean transparent line-art on the building decals.
const ICON_SLUGS = {
  ec2:        "amazonec2",
  asg:        "amazonec2",
  s3:         "amazons3",
  rds:        "amazonrds",
  aurora:     "amazonrds",
  dynamodb:   "amazondynamodb",
  lambda:     "awslambda",
  cloudfront: "amazoncloudfront",
  route53:    "amazonroute53",
  apigw:      "amazonapigateway",
  ecs:        "amazonecs",
  eks:        "amazoneks",
};
const ICON_CACHE = new Map(); // type -> Promise<HTMLImageElement | null>

function loadIconImage(type) {
  if (ICON_CACHE.has(type)) return ICON_CACHE.get(type);
  const slug = ICON_SLUGS[type];
  if (!slug) {
    const p = Promise.resolve(null);
    ICON_CACHE.set(type, p);
    return p;
  }
  const url = `https://cdn.jsdelivr.net/npm/simple-icons@13/icons/${slug}.svg`;
  const p = fetch(url)
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error("HTTP " + r.status))))
    .then((svg) => {
      // Strip explicit fills so our injected white wins, replace any
      // currentColor, and ensure dimensions so drawImage scales reliably.
      svg = svg.replace(/\sfill="[^"]*"/g, "");
      svg = svg.replace(/currentColor/g, "#ffffff");
      svg = svg.replace(/<svg\b([^>]*?)>/, (m, attrs) => {
        let a = attrs;
        if (!/\swidth\s*=/.test(a)) a += ' width="256"';
        if (!/\sheight\s*=/.test(a)) a += ' height="256"';
        a += ' fill="#ffffff"';
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
      console.warn("[viz3d] icon load failed for", type, slug, err);
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
    ? clamp(fitDistance * 1.18 + 18, 35, Math.max(CITY.w, CITY.d) * 1.1 + 80)
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

  // Containers (VPC / subnet) get an eagle-eye view — camera nearly
  // straight overhead with a slight ~78° tilt so the floor plan reads at
  // a glance. That keeps subnet tour steps visually distinct from the
  // side-on street-level view used for individual buildings (EC2, ALB,
  // Aurora, etc), so a "DATA · Data 1a" step doesn't read like another
  // building step. Buildings keep the side-on view.
  const aim = new THREE.Vector3(
    target.x,
    isContainer ? Math.min(r.height * 0.5, 3) : r.height * 0.45 + 1,
    target.z,
  );

  let camPos;
  if (isContainer) {
    const horizOffset = distance * 0.22;  // shallow horizontal nudge
    const elev = distance * 1.00;         // tall vertical lift
    camPos = new THREE.Vector3(
      target.x + dirX * horizOffset,
      aim.y + elev,
      target.z + dirZ * horizOffset,
    );
  } else {
    const elev = r.height * 0.55 + 4;
    camPos = new THREE.Vector3(
      target.x + dirX * distance,
      aim.y + elev,
      target.z + dirZ * distance,
    );
  }

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
  if (ground && ground.material) {
    ground.material.map = isDay ? dayGroundTex : nightGroundTex;
    ground.material.emissive.setHex(isDay ? 0x4a5b78 : 0x1c2f5a);
    ground.material.emissiveIntensity = isDay ? 0.10 : 0.32;
    ground.material.needsUpdate = true;
  }
  // Per-VPC top-face street texture
  if (cityGroup) {
    cityGroup.traverse((c) => {
      if (c.userData && c.userData.vpcTopMat) {
        const oldTex = c.userData.vpcTopMat.map;
        const repX = oldTex ? oldTex.repeat.x : 4;
        const repY = oldTex ? oldTex.repeat.y : 4;
        const tex = (isDay ? dayStreetTex : nightStreetTex).clone();
        tex.needsUpdate = true;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(repX, repY);
        c.userData.vpcTopMat.map = tex;
        c.userData.vpcTopMat.needsUpdate = true;
        if (oldTex) oldTex.dispose();
      }
    });
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

// ---------- attack simulation ----------

// Pre-defined attack scenarios. Each has its own initialise/tick logic so
// DDoS, SQL injection, and ransomware can have visually distinct stories
// without an explosion of branching.
const ATTACK_DEFS = {
  ddos: {
    id: "ddos",
    name: "DDoS Volumetric Flood",
    icon: "⚡",
    description:
      "A massive surge of bogus traffic from the internet attempts to overwhelm your edge. WAF rate-limits most of it.",
    duration: 22000,
    phases: [
      { t: 0,     label: "Reconnaissance" },
      { t: 3000,  label: "Initial wave" },
      { t: 8000,  label: "Peak surge" },
      { t: 14000, label: "WAF mitigation" },
      { t: 19000, label: "Recovery" },
    ],
    init(state) {
      const cdn = findInRegistry(["cloudfront"]);
      const albs = findInRegistry(["alb"]);
      const wafs = findInRegistry(["waf"]);
      // Targets the attackers aim at. Prefer CDN + ALB if present.
      state.cfg = {
        targets: cdn.concat(albs).map((e) => e.id),
        defenders: wafs.map((e) => e.id),
        source: "internet",
        // Bands of (timeRange, spawnRate per second, blockRate). Rates are
        // tuned for the bigger / slower siege units so the field reads
        // "army" rather than "swarm".
        bands: [
          { tStart: 800,   tEnd: 2800,  rate: 2.5, blockRate: 0.05 },
          { tStart: 3000,  tEnd: 7800,  rate: 9,   blockRate: 0.32 },
          { tStart: 8000,  tEnd: 13800, rate: 18,  blockRate: 0.55 },
          { tStart: 14000, tEnd: 18800, rate: 14,  blockRate: 0.85 },
          { tStart: 19000, tEnd: 21500, rate: 4,   blockRate: 0.55 },
        ],
      };
      if (state.cfg.targets.length === 0) {
        // Fall back to whatever public-facing thing exists.
        const fallback = findInRegistry(["alb", "nlb", "ec2", "ecs", "waf"]);
        state.cfg.targets = fallback.slice(0, 1).map((e) => e.id);
      }
      pushEvent(state, "info",
        `Attackers spotted from the public internet → targeting ${state.cfg.targets.length} edge resource(s)`);
    },
    tick(state, dt, elapsed) {
      tickBandedSpawn(state, dt, elapsed);
    },
    summarize(state) {
      const arrived = state.stats.arrived;
      const total = state.stats.spawned;
      const blocked = state.stats.blocked;
      const outcome = arrived === 0
        ? "Service stayed up — every request blocked."
        : arrived < total * 0.15
        ? "Service stayed up. WAF absorbed the surge."
        : arrived < total * 0.5
        ? "Brownout for some users. Edge held but degraded."
        : "Edge overwhelmed — manual mitigation required.";
      return {
        outcome,
        outcomeStatus: arrived === 0 || arrived < total * 0.15 ? "ok" : (arrived < total * 0.5 ? "warn" : "danger"),
        stats: [
          { label: "Total bogus requests", value: total.toLocaleString() },
          { label: "Blocked by WAF",       value: `${blocked.toLocaleString()} (${pct(blocked, total)}%)` },
          { label: "Reached edge",         value: arrived.toLocaleString() },
          { label: "Peak request rate",    value: `${state.stats.peakRate} req/s` },
        ],
      };
    },
  },

  sqli: {
    id: "sqli",
    name: "SQL Injection Cascade",
    icon: "💉",
    description:
      "Persistent payload-laden requests try to traverse the edge → app → database. WAF and security groups peel off most.",
    duration: 22000,
    phases: [
      { t: 0,     label: "Probing" },
      { t: 4000,  label: "Bypass attempts" },
      { t: 10000, label: "App-tier exploit" },
      { t: 16000, label: "Database probes" },
      { t: 19500, label: "Mitigation" },
    ],
    init(state) {
      const cdn = findInRegistry(["cloudfront"]);
      const wafs = findInRegistry(["waf"]);
      const albs = findInRegistry(["alb"]);
      const apps = findInRegistry(["ecs", "ec2", "lambda"]);
      const dbs = findInRegistry(["aurora", "rds"]);
      // Build a hop chain through whatever is present.
      const path = [];
      if (cdn[0])  path.push(cdn[0].id);
      if (wafs[0]) path.push(wafs[0].id);
      if (albs[0]) path.push(albs[0].id);
      if (apps[0]) path.push(apps[0].id);
      if (dbs[0])  path.push(dbs[0].id);
      state.cfg = {
        source: "internet",
        // Cumulative intercept chance at each hop boundary
        path,
        hopBlockChance: [0.15, 0.55, 0.25, 0.55, 0.55].slice(0, path.length),
        // Defenders worth showing a shield on
        defenders: [...wafs, ...dbs].map((e) => e.id),
        bands: [
          { tStart: 600,   tEnd: 4000,  rate: 0.8, blockRate: 0 },
          { tStart: 4000,  tEnd: 10000, rate: 1.6, blockRate: 0 },
          { tStart: 10000, tEnd: 16000, rate: 2.2, blockRate: 0 },
          { tStart: 16000, tEnd: 19500, rate: 1.6, blockRate: 0 },
          { tStart: 19500, tEnd: 21500, rate: 0.6, blockRate: 0 },
        ],
      };
      pushEvent(state, "info",
        `Probe chain: ${path.length ? path.join(" → ") : "(no clear path found)"}`);
    },
    tick(state, dt, elapsed) {
      tickBandedSpawn(state, dt, elapsed);
    },
    summarize(state) {
      const arrived = state.stats.arrived;
      const total = state.stats.spawned;
      const outcome = arrived === 0
        ? "All injection attempts intercepted. DB stayed safe."
        : arrived < 5
        ? `${arrived} request(s) reached the database, but each was caught by the SG’s deny-by-default rules. Review parameterised queries.`
        : "Multiple payloads reached the database tier — auditing required.";
      return {
        outcome,
        outcomeStatus: arrived === 0 ? "ok" : arrived < 5 ? "warn" : "danger",
        stats: [
          { label: "Total injection attempts", value: total.toLocaleString() },
          { label: "Blocked by WAF / SG",      value: state.stats.blocked.toLocaleString() },
          { label: "Reached database",         value: arrived.toLocaleString() },
        ],
      };
    },
  },

  ransomware: {
    id: "ransomware",
    name: "Ransomware Lateral Spread",
    icon: "🦠",
    description:
      "An ECS task is compromised. The malware scans neighbours and spreads laterally; security groups slow it but don't stop it cold.",
    duration: 24000,
    phases: [
      { t: 0,     label: "Foothold" },
      { t: 3500,  label: "Reconnaissance" },
      { t: 8000,  label: "Lateral movement" },
      { t: 15000, label: "Privilege escalation" },
      { t: 20000, label: "Encryption" },
    ],
    init(state) {
      const candidates = findInRegistry(["ecs", "lambda", "ec2"]);
      if (candidates.length) {
        const seed = candidates[0].id;
        const dbs = findInRegistry(["aurora", "rds", "dynamodb"]);
        state.cfg = {
          infected: new Set([seed]),
          spreadInterval: 1300,
          lastSpawnT: 0,
          spreadTypes: ["ecs", "lambda", "ec2", "aurora", "rds", "dynamodb", "s3"],
          source: seed,
          // Crown-jewel data tier gets the SG dome — the malware visibly
          // bashes into it.
          defenders: dbs.map((e) => e.id),
        };
        markInfected(state, seed);
        pushEvent(state, "danger", `Initial foothold: ${seed} compromised`);
      } else {
        state.cfg = {
          infected: new Set(), spreadInterval: 1500, lastSpawnT: 0, spreadTypes: [], defenders: [],
        };
      }
    },
    tick(state, dt, elapsed) {
      const cfg = state.cfg;
      if (!cfg.infected || cfg.infected.size === 0) return;
      // Spread accelerates as the attack progresses
      const interval = Math.max(380, cfg.spreadInterval - elapsed * 0.04);
      if (elapsed - cfg.lastSpawnT < interval) return;
      cfg.lastSpawnT = elapsed;

      const sources = [...cfg.infected];
      const possible = findInRegistry(cfg.spreadTypes).filter((e) => !cfg.infected.has(e.id));
      if (possible.length === 0) return;

      const sourceId = sources[Math.floor(Math.random() * sources.length)];
      const target = possible[Math.floor(Math.random() * possible.length)];
      // Block rate: SGs catch fewer attempts as the malware learns
      const blockRate = Math.max(0.18, 0.65 - elapsed / 50000);
      spawnAttacker(state, {
        sourceId,
        targetId: target.id,
        blockRate,
        defenderName: "Security Group",
        kind: "spread",
        onArrival(s) {
          s.cfg.infected.add(target.id);
          markInfected(s, target.id);
          pushEvent(s, "danger", `${target.id} compromised (spread from ${sourceId})`);
        },
        onBlocked(s) {
          pushEvent(s, "ok", `SG dropped ${sourceId} → ${target.id}`);
        },
      });
    },
    summarize(state) {
      const compromised = (state.cfg.infected || new Set()).size;
      const total = state.stats.spawned;
      const outcome = compromised <= 1
        ? "Lateral movement contained. The breached node was the only one infected."
        : compromised < 5
        ? `${compromised} nodes compromised. Isolate them immediately and rotate credentials.`
        : "Wide-spread compromise. Trigger DR runbook and rotate every SG.";
      return {
        outcome,
        outcomeStatus: compromised <= 1 ? "ok" : compromised < 5 ? "warn" : "danger",
        stats: [
          { label: "Lateral attempts",  value: total.toLocaleString() },
          { label: "Blocked by SGs",    value: state.stats.blocked.toLocaleString() },
          { label: "Nodes compromised", value: compromised.toString() },
        ],
      };
    },
  },
};

function findInRegistry(types) {
  const out = [];
  registry.forEach((entry, id) => {
    if (types.includes(entry.type)) out.push({ id, entry });
  });
  return out;
}

function pushEvent(state, severity, message) {
  state.events.push({ t: performance.now() - state.startTime, severity, message });
  if (state.events.length > 200) state.events.shift();
}

function pct(a, b) {
  if (!b) return 0;
  return Math.round((a / b) * 100);
}

// Spawn attackers based on the current "band" definitions in state.cfg.bands.
// Each band is { tStart, tEnd, rate, blockRate }. Used by DDoS and SQLi.
function tickBandedSpawn(state, dt, elapsed) {
  const cfg = state.cfg;
  if (!cfg || !cfg.bands) return;
  cfg._spawnAccum = cfg._spawnAccum || {};

  cfg.bands.forEach((b, i) => {
    if (elapsed < b.tStart || elapsed >= b.tEnd) return;
    cfg._spawnAccum[i] = (cfg._spawnAccum[i] || 0) + b.rate * dt;
    while (cfg._spawnAccum[i] >= 1) {
      cfg._spawnAccum[i] -= 1;
      const target = pickRandom(cfg.targets);
      if (state.def.id === "sqli") {
        spawnAttackerOnPath(state, cfg.path, cfg.hopBlockChance);
      } else {
        spawnAttacker(state, {
          sourceId: cfg.source,
          targetId: target,
          blockRate: b.blockRate,
          defenderName: "WAF",
          kind: "siege",
        });
      }
    }
  });

  // Track peak QPS over a 1-second sliding window
  const window = state._rateWindow = state._rateWindow || [];
  while (window.length && window[0] < elapsed - 1000) window.shift();
}

function pickRandom(arr) {
  return arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;
}

function makeAttackerUnit() {
  // A red capsule "soldier" with a ground aura and a glowing halo so a
  // single attacker reads as a unit, not just a dot. Returned as a Group
  // so callers can move it as one object along the curve.
  const grp = new THREE.Group();

  const bodyGeo = new THREE.CapsuleGeometry(0.55, 1.6, 6, 12);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xff2a4d,
    emissive: 0xff4477,
    emissiveIntensity: 0.75,
    roughness: 0.45,
    metalness: 0.4,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 1.4;
  grp.add(body);

  const haloGeo = new THREE.SphereGeometry(1.5, 14, 10);
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xff3a5b, transparent: true, opacity: 0.45,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.position.y = 1.3;
  grp.add(halo);

  const aura = makeRedAuraSprite();
  aura.position.y = 0.15;
  aura.scale.set(4, 4, 1);
  grp.add(aura);

  return { group: grp, body, halo };
}

let _redAuraTex = null;
function makeRedAuraSprite() {
  if (!_redAuraTex) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d");
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0,    "rgba(255, 60, 90, 0.78)");
    grad.addColorStop(0.45, "rgba(255, 50, 80, 0.32)");
    grad.addColorStop(1,    "rgba(255, 40, 70, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    _redAuraTex = new THREE.CanvasTexture(c);
  }
  const mat = new THREE.SpriteMaterial({
    map: _redAuraTex,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  return new THREE.Sprite(mat);
}

function disposeAttackerVisual(visual) {
  if (!visual) return;
  attackerLayer.remove(visual.group);
  visual.group.traverse((c) => {
    if (c.geometry) c.geometry.dispose();
    if (c.material) {
      const ms = Array.isArray(c.material) ? c.material : [c.material];
      ms.forEach((m) => { if (m.map && m !== _redAuraTex) m.map.dispose && m.map.dispose(); m.dispose(); });
    }
  });
}

// Build a curve for an attacker travelling from source to target with a
// gentle arc upward.
function attackerCurve(sourceId, targetId) {
  const src = registry.get(sourceId);
  const tgt = registry.get(targetId);
  if (!src || !tgt) return null;
  const start = src.position.clone();
  const end = tgt.position.clone();
  const mid = start.clone().lerp(end, 0.5);
  mid.y += Math.min(38, Math.max(8, start.distanceTo(end) * 0.32));
  return new THREE.CatmullRomCurve3([start, mid, end]);
}

// External-siege curve: spawn at a random angle on the city perimeter at
// ground level and march in across the surface to the target. Used by
// DDoS so attackers literally surround the city and pour inward instead
// of arriving from a single portal.
function attackerSiegeCurve(targetId) {
  const tgt = registry.get(targetId);
  if (!tgt) return null;
  const angle = Math.random() * Math.PI * 2;
  const r = Math.max(CITY.w, CITY.d) * 0.95 + 30;
  const start = new THREE.Vector3(Math.cos(angle) * r, 0.6, Math.sin(angle) * r);
  const end = tgt.position.clone();
  const approach = new THREE.Vector3(end.x, 0.6, end.z);
  // Slight jitter on approach so attackers don't all stack on one line
  approach.x += (Math.random() - 0.5) * 4;
  approach.z += (Math.random() - 0.5) * 4;
  return new THREE.CatmullRomCurve3([start, approach, end]);
}

// Lateral-spread curve: travels on the ground between two city nodes.
// Used by the ransomware worm so the malware visibly creeps across the
// streets between buildings instead of flying overhead.
function attackerSpreadCurve(sourceId, targetId) {
  const src = registry.get(sourceId);
  const tgt = registry.get(targetId);
  if (!src || !tgt) return null;
  const start = new THREE.Vector3(src.position.x, 0.6, src.position.z);
  const mid = new THREE.Vector3(
    (src.position.x + tgt.position.x) / 2 + (Math.random() - 0.5) * 6,
    0.6,
    (src.position.z + tgt.position.z) / 2 + (Math.random() - 0.5) * 6,
  );
  const end = tgt.position.clone();
  return new THREE.CatmullRomCurve3([start, mid, end]);
}

// Build a multi-hop curve through a list of node ids (for SQLi). Starts
// at a random perimeter angle so the attacker reads as coming from
// outside the network.
function attackerPathCurve(hopIds) {
  if (!hopIds || hopIds.length === 0) return null;
  const angle = Math.random() * Math.PI * 2;
  const r = Math.max(CITY.w, CITY.d) * 0.95 + 30;
  const points = [new THREE.Vector3(Math.cos(angle) * r, 0.6, Math.sin(angle) * r)];
  for (const id of hopIds) {
    const e = registry.get(id);
    if (!e) continue;
    points.push(e.position.clone().add(new THREE.Vector3(0, 1, 0)));
  }
  if (points.length < 2) return null;
  return new THREE.CatmullRomCurve3(points);
}

function spawnAttacker(state, { sourceId, targetId, blockRate = 0, defenderName = "defender", onArrival, onBlocked, kind }) {
  // Pick the right curve shape for the kind of attack
  let curve;
  if (kind === "spread") curve = attackerSpreadCurve(sourceId, targetId);
  else if (kind === "siege") curve = attackerSiegeCurve(targetId);
  else curve = attackerCurve(sourceId, targetId);
  if (!curve) return;
  const tgt = registry.get(targetId);
  const visual = makeAttackerUnit();
  attackerLayer.add(visual.group);
  const blocked = Math.random() < blockRate;
  const interceptT = blocked ? 0.55 + Math.random() * 0.2 : null;
  state.attackers.push({
    visual, curve,
    t: 0,
    speed: 0.28 + Math.random() * 0.12,  // ~3 s end-to-end so the siege reads
    blocked, interceptT,
    targetId, defenderName,
    targetName: (tgt && tgt.name) || targetId,
    onArrival, onBlocked,
  });
  state.stats.spawned++;
  if (state._rateWindow) state._rateWindow.push(performance.now() - state.startTime);
  state.stats.peakRate = Math.max(state.stats.peakRate, state._rateWindow ? state._rateWindow.length : 0);
}

function spawnAttackerOnPath(state, path, hopBlockChance) {
  if (!path || path.length === 0) return;
  const curve = attackerPathCurve(path);
  if (!curve) return;
  let blockedHop = -1;
  for (let i = 0; i < path.length; i++) {
    if (Math.random() < (hopBlockChance[i] || 0)) { blockedHop = i; break; }
  }
  const visual = makeAttackerUnit();
  attackerLayer.add(visual.group);
  const finalTargetId = path[path.length - 1];
  const tgt = registry.get(finalTargetId);
  // The first curve point is the perimeter spawn, then one per hop, so
  // hop i lives between control points (i+1) and (i+2). Map block to t.
  const totalSegments = path.length;
  const interceptT = blockedHop >= 0
    ? Math.min(0.95, (blockedHop + 1.5) / (totalSegments + 1))
    : null;
  const defenderName = blockedHop >= 0 ? `at ${path[blockedHop]}` : null;
  state.attackers.push({
    visual, curve,
    t: 0,
    speed: 0.22 + Math.random() * 0.1,
    blocked: blockedHop >= 0,
    interceptT,
    targetId: finalTargetId, defenderName,
    targetName: (tgt && tgt.name) || finalTargetId,
  });
  state.stats.spawned++;
}

// Blue spark when a defender stops an attacker — clearly distinct from a
// red impact at a target.
function spawnDefenseSpark(pos) {
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(1.6, 14, 10),
    new THREE.MeshBasicMaterial({
      color: 0x6cd1ff, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  flash.position.copy(pos);
  attackerLayer.add(flash);
  attackState.puffs.push({
    mesh: flash, life: 0.45, duration: 0.45,
    startScale: 0.5, endScale: 6,
  });
}

// Dramatic red impact at a successful target hit: a vertical light column
// and an expanding shockwave ring on the ground.
function spawnImpact(pos) {
  const colGeo = new THREE.CylinderGeometry(0.6, 1.6, 28, 14, 1, true);
  const colMat = new THREE.MeshBasicMaterial({
    color: 0xff3a5b, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
  });
  const col = new THREE.Mesh(colGeo, colMat);
  col.position.set(pos.x, pos.y + 13, pos.z);
  attackerLayer.add(col);

  const ringGeo = new THREE.RingGeometry(0.8, 1.6, 48);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xff3a5b, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(pos.x, 0.55, pos.z);
  attackerLayer.add(ring);

  attackState.impacts = attackState.impacts || [];
  attackState.impacts.push({ col, ring, life: 0.95, duration: 0.95 });
}

// Translucent blue dome over each defender at attack start. Pulses while
// the attack runs and tears down on stopAttack.
function spawnDefenseShields(state) {
  const defenders = state.cfg && state.cfg.defenders ? state.cfg.defenders : [];
  state.shields = [];
  defenders.forEach((id) => {
    const r = registry.get(id);
    if (!r) return;
    const radius = Math.max(11, r.extent * 1.8);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 36, 18, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0x60c0ff, transparent: true, opacity: 0.18,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    dome.position.set(r.position.x, 0.6, r.position.z);
    attackerLayer.add(dome);
    // Glowing ring at the dome's foot
    const footGeo = new THREE.RingGeometry(radius - 0.6, radius, 64);
    const footMat = new THREE.MeshBasicMaterial({
      color: 0x6cd1ff, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
    });
    const foot = new THREE.Mesh(footGeo, footMat);
    foot.rotation.x = -Math.PI / 2;
    foot.position.set(r.position.x, 0.65, r.position.z);
    attackerLayer.add(foot);
    state.shields.push({ dome, foot, baseRadius: radius });
  });
}

function flashTarget(id, color = 0xff3a5b, durationS = 0.7) {
  const r = registry.get(id);
  if (!r || !r.mesh || !r.mesh.material) return;
  attackState.flashes.push({
    mesh: r.mesh,
    life: durationS,
    duration: durationS,
    originalEmissive: r.mesh.material.emissive.getHex(),
    originalIntensity: r.mesh.material.emissiveIntensity,
    color,
  });
  r.mesh.material.emissive.setHex(color);
  r.mesh.material.emissiveIntensity = Math.min(1.4, (r.mesh.material.emissiveIntensity || 0.45) + 0.7);
}

function markInfected(state, id) {
  // Permanent red glow on infected nodes
  const r = registry.get(id);
  if (!r || !r.mesh || !r.mesh.material) return;
  state.infectedMeshes = state.infectedMeshes || new Map();
  if (state.infectedMeshes.has(id)) return;
  state.infectedMeshes.set(id, {
    mesh: r.mesh,
    originalEmissive: r.mesh.material.emissive.getHex(),
    originalIntensity: r.mesh.material.emissiveIntensity,
  });
  r.mesh.material.emissive.setHex(0xff3a5b);
  r.mesh.material.emissiveIntensity = 0.65;
}

function startAttack(id) {
  if (!initialized) return;
  if (attackState) stopAttack();
  const def = ATTACK_DEFS[id];
  if (!def) return;

  attackState = {
    def,
    startTime: performance.now(),
    attackers: [],
    puffs: [],
    flashes: [],
    events: [],
    stats: { spawned: 0, blocked: 0, arrived: 0, peakRate: 0 },
    cfg: {},
    currentPhase: -1,
    summaryShown: false,
  };

  // Camera: bird's-eye over the city so the user sees the whole battle
  cameraTween = null;
  const dist = Math.max(CITY.w, CITY.d) * 0.8 + 90;
  tweenCamera(
    new THREE.Vector3(0, dist * 0.85, dist * 0.45),
    new THREE.Vector3(0, 4, 0),
    1100,
  );

  if (def.init) def.init(attackState);
  spawnDefenseShields(attackState);

  if (window.AwsAttack && typeof window.AwsAttack.onStart === "function") {
    window.AwsAttack.onStart(def);
  }
}

function stopAttack() {
  if (!attackState) return;
  // Return any infected meshes' emissive to their original values
  if (attackState.infectedMeshes) {
    attackState.infectedMeshes.forEach((info) => {
      info.mesh.material.emissive.setHex(info.originalEmissive);
      info.mesh.material.emissiveIntensity = info.originalIntensity;
    });
  }
  // Same for any in-flight target flashes
  attackState.flashes.forEach((f) => {
    f.mesh.material.emissive.setHex(f.originalEmissive);
    f.mesh.material.emissiveIntensity = f.originalIntensity;
  });
  // Wipe attacker visuals (units, sparks, impacts, shields, etc.)
  attackerLayer.traverse((c) => {
    if (c.geometry) c.geometry.dispose();
    if (c.material) {
      const ms = Array.isArray(c.material) ? c.material : [c.material];
      ms.forEach((m) => {
        if (m.map && m.map !== _redAuraTex) m.map.dispose && m.map.dispose();
        m.dispose();
      });
    }
  });
  while (attackerLayer.children.length) attackerLayer.remove(attackerLayer.children[0]);
  attackState = null;
  if (window.AwsAttack && typeof window.AwsAttack.onStop === "function") {
    window.AwsAttack.onStop();
  }
}

function isAttackActive() {
  return !!attackState;
}

function getAttackState() {
  if (!attackState) return null;
  const elapsed = performance.now() - attackState.startTime;
  return {
    defId: attackState.def.id,
    name: attackState.def.name,
    icon: attackState.def.icon,
    duration: attackState.def.duration,
    elapsed,
    phaseLabel: attackState.def.phases[Math.max(0, attackState.currentPhase)]
      ? attackState.def.phases[Math.max(0, attackState.currentPhase)].label
      : "",
    progress: Math.min(1, elapsed / attackState.def.duration),
    stats: { ...attackState.stats },
    events: attackState.events.slice(-30),
  };
}

function buildAttackSummary() {
  if (!attackState) return null;
  const summary = attackState.def.summarize(attackState);
  return {
    name: attackState.def.name,
    icon: attackState.def.icon,
    outcome: summary.outcome,
    outcomeStatus: summary.outcomeStatus,
    stats: summary.stats,
    events: attackState.events.slice(),
  };
}

function updateAttack(now, dt) {
  if (!attackState) return;
  const elapsed = now - attackState.startTime;

  // Phase transitions
  let phase = 0;
  for (let i = 0; i < attackState.def.phases.length; i++) {
    if (elapsed >= attackState.def.phases[i].t) phase = i;
  }
  if (phase !== attackState.currentPhase) {
    attackState.currentPhase = phase;
    pushEvent(attackState, "info", `▶ ${attackState.def.phases[phase].label}`);
  }

  // Attack-specific spawn logic
  if (elapsed < attackState.def.duration && attackState.def.tick) {
    attackState.def.tick(attackState, dt, elapsed);
  }

  // Move attackers
  attackState.attackers = attackState.attackers.filter((a) => {
    a.t += a.speed * dt;
    if (a.blocked && a.interceptT != null && a.t >= a.interceptT) {
      const p = a.curve.getPointAt(a.interceptT);
      spawnDefenseSpark(p);
      attackState.stats.blocked++;
      if (a.onBlocked) a.onBlocked(attackState);
      else pushEvent(attackState, "ok",
        `Blocked${a.defenderName ? " " + a.defenderName : ""} → ${a.targetName}`);
      disposeAttackerVisual(a.visual);
      return false;
    }
    if (a.t >= 1) {
      const p = a.curve.getPointAt(0.999);
      spawnImpact(p);
      flashTarget(a.targetId, 0xff3a5b, 0.9);
      attackState.stats.arrived++;
      if (a.onArrival) a.onArrival(attackState);
      else pushEvent(attackState, "danger", `Reached ${a.targetName}`);
      disposeAttackerVisual(a.visual);
      return false;
    }
    const p = a.curve.getPointAt(Math.min(0.9999, a.t));
    a.visual.group.position.copy(p);
    return true;
  });

  // Animate spark puffs (defense flashes)
  attackState.puffs = attackState.puffs.filter((p) => {
    p.life -= dt;
    if (p.life <= 0) {
      attackerLayer.remove(p.mesh);
      p.mesh.geometry.dispose(); p.mesh.material.dispose();
      return false;
    }
    const alive = p.life / p.duration;
    p.mesh.scale.setScalar(p.startScale + (p.endScale - p.startScale) * (1 - alive));
    p.mesh.material.opacity = alive;
    return true;
  });

  // Animate impacts (vertical column + ground ring at successful hits)
  attackState.impacts = (attackState.impacts || []).filter((im) => {
    im.life -= dt;
    if (im.life <= 0) {
      attackerLayer.remove(im.col); im.col.geometry.dispose(); im.col.material.dispose();
      attackerLayer.remove(im.ring); im.ring.geometry.dispose(); im.ring.material.dispose();
      return false;
    }
    const alive = im.life / im.duration;
    im.col.material.opacity = alive * 0.85;
    im.col.scale.set(1 + (1 - alive) * 0.4, 1 + (1 - alive) * 0.5, 1 + (1 - alive) * 0.4);
    const ringScale = 1 + (1 - alive) * 18;
    im.ring.scale.setScalar(ringScale);
    im.ring.material.opacity = alive;
    return true;
  });

  // Animate target flashes
  attackState.flashes = attackState.flashes.filter((f) => {
    f.life -= dt;
    if (f.life <= 0) {
      f.mesh.material.emissive.setHex(f.originalEmissive);
      f.mesh.material.emissiveIntensity = f.originalIntensity;
      return false;
    }
    const t = f.life / f.duration;
    f.mesh.material.emissiveIntensity = f.originalIntensity + 0.7 * t;
    return true;
  });

  // Pulse defense shields
  if (attackState.shields) {
    attackState.shields.forEach((s, i) => {
      const v = (Math.sin(now / 320 + i * 0.7) + 1) / 2;
      s.dome.material.opacity = 0.14 + v * 0.18;
      s.foot.material.opacity = 0.40 + v * 0.30;
      s.foot.scale.setScalar(1 + v * 0.04);
    });
  }

  // Notify HUD
  if (window.AwsAttack && typeof window.AwsAttack.onTick === "function") {
    window.AwsAttack.onTick(getAttackState());
  }

  // End condition: duration expired AND all attackers drained.
  if (
    !attackState.summaryShown &&
    elapsed > attackState.def.duration + 1500 &&
    attackState.attackers.length === 0
  ) {
    attackState.summaryShown = true;
    if (window.AwsAttack && typeof window.AwsAttack.onEnd === "function") {
      window.AwsAttack.onEnd(buildAttackSummary());
    }
  }
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

  // Internet ring spin + blinking lights + per-building Y rotation
  cityGroup.traverse((c) => {
    if (c.userData.spin) c.rotation.z += dt * 0.6;
    if (c.userData.spinY) c.rotation.y += dt * (c.userData.spinSpeed || 0.3);
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

  if (attackState) updateAttack(now, dt);

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
  startAttack,
  stopAttack,
  isAttackActive,
  getAttackState,
  buildAttackSummary,
  attackTypes: () => Object.values(ATTACK_DEFS).map((d) => ({
    id: d.id, name: d.name, icon: d.icon, description: d.description,
  })),
  isReady: () => initialized,
};
