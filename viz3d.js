// 3D "city" visualization of an imported AWS network.
// Built with Three.js. Reuses the layout produced by visualizer.js (the 2D
// renderer) so positions stay consistent between modes.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";

console.log("[viz3d] build 2026-05-05u — gun/explosion SFX + bigger spread");

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

// Pointer hover (orbit mode). Raycaster picks the topmost registered mesh
// under the cursor so the sidebar + tooltip update like in the 2D view.
const _raycaster = new THREE.Raycaster();
const _pointer = new THREE.Vector2();
let _pointerInside = false;
let hoveredId = null;
// Transient flourish state — broken/fixed flash + ghosts of removed elements.
let ghostLayer = null;
let ghostUntil = 0;
let statusFlourish = null; // { kind: "broken"|"fixed", until }

const SCALE_TARGET = 380; // city max dimension in 3D units
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

  // Pointer hover for orbit mode — sidebar/tooltip parity with 2D view.
  renderer.domElement.addEventListener("pointermove", onCanvasPointerMove);
  renderer.domElement.addEventListener("pointerleave", onCanvasPointerLeave);

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

function render(data, opts) {
  if (!initialized) return;
  // Snapshot positions/extents of the OLD city so we can place ghost markers
  // for removed elements at the spots they used to occupy. clearCity() wipes
  // the live registry, so we copy what we need first.
  const diff = opts && opts.diff;
  const status = opts && opts.status;
  const prevPositions = new Map();
  if (diff) {
    registry.forEach((entry, id) => {
      prevPositions.set(id, {
        position: entry.position.clone(),
        extent: entry.extent || 4,
        height: entry.height || 4,
        type: entry.type,
      });
    });
  }
  // Track whether a city existed before so we can decide whether to re-frame
  // the camera or preserve the user's current angle / zoom.
  const hadPreviousCity = registry.size > 0;
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

  // Frame the city on the *first* render only. Version transitions keep
  // whatever camera angle / zoom the user had set — resetting on every
  // click is jarring and discards the user's framing of the city.
  if (!hadPreviousCity) {
    const dist = Math.max(CITY.w, CITY.d) + 80;
    camera.position.set(dist * 0.35, dist * 0.55, dist * 0.85);
    controls.target.set(0, 4, 0);
  }
  controls.update();

  // Adapt fog to city size so the whole layout is always visible from
  // overview, but distant detail still fades for atmosphere.
  const cd = Math.max(CITY.w, CITY.d, 80);
  if (scene.fog && scene.fog.isFog) {
    scene.fog.near = cd * 1.2;
    scene.fog.far = cd * 4.0;
  }

  if (diff) applyVersionDiff3D(diff, prevPositions);
  if (status === "broken" || status === "fixed") triggerStatusFlourish(status);
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
  mesh.userData.registryId = vpc.id;
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
  mesh.userData.registryId = s.id;
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
  // Resolve cross-cloud aliases (Azure vm → ec2 colour palette, etc.) so
  // an Azure VM gets the compute orange even though the type string says
  // "vm" in the imported JSON.
  const colorType = window.AWS_COLORS && window.AWS_COLORS[node.type]
    ? node.type
    : resolveType(node.type);
  const colors = (window.AWS_COLORS && window.AWS_COLORS[colorType]) || window.AWS_COLORS.unknown;
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
  mesh.userData.registryId = node.id;
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

// ---------- multi-cloud type aliases ----------
//
// Imported networks can use Azure (or other cloud) terminology. The
// visualizer's shape / colour / icon / explanation maps are keyed on AWS
// type names, so we resolve each input type to the closest equivalent
// for those lookups. The original type name is still preserved in the
// data (so labels and the sidebar say "Azure SQL", not "RDS").
const TYPE_ALIASES = {
  // Azure compute
  vm:           "ec2",
  vmss:         "asg",
  appservice:   "ec2",
  function:     "lambda",
  containerapp: "ecs",
  aks:          "eks",

  // Azure database
  sql:        "rds",
  postgresql: "rds",
  mysql:      "rds",
  cosmosdb:   "dynamodb",
  redis:      "endpoint",

  // Azure storage
  blob: "s3",

  // Azure networking
  vnet:            "vpc",
  nsg:             "sg",
  appgw:           "alb",
  frontdoor:       "cloudfront",
  azurewaf:        "waf",
  vpngw:           "vpn",
  expressroute:    "dx",
  bastion:         "nat",
  azuredns:        "route53",
  apim:            "apigw",
  privateendpoint: "endpoint",
  publicip:        "endpoint",
  cdn:             "cloudfront",

  // Azure security / identity
  entra:        "sg",
  azurefirewall: "waf",
};
function resolveType(type) {
  return TYPE_ALIASES[type] || type;
}

function pickSize(type, w, d) {
  const t = resolveType(type);
  // Cap the maximum footprint so densely-packed networks (lots of
  // resources per subnet) don't end up with buildings touching each
  // other — buildings stay in proportion but leave gaps for streets.
  // Cap at 11 (was 13) and use 0.55 of slot (was 0.7) so dense subnets
  // — multiple resources stacked — leave clear streets between buildings.
  const fw = Math.max(4, Math.min(Math.min(w, d) * 0.55, 11));
  const heights = {
    ec2: 14, asg: 11, ecs: 13, eks: 17, lambda: 10,
    alb: 8, nlb: 8, waf: 12, igw: 9, nat: 7,
    rds: 13, aurora: 16, dynamodb: 11,
    s3: 10, cloudfront: 22, route53: 17, apigw: 11,
    sg: 8, nacl: 8, vpn: 10, dx: 10, tgw: 14, endpoint: 10,
  };
  const h = heights[t] || 11;
  return { w: fw, d: fw, h };
}

// For each building type, the actual half-extent in X/Z direction (where
// the visible side face is, given pickGeometry's per-type scaling). Used
// to place side decals tight against the surface — important for shapes
// whose geometry doesn't fill the slot, like Aurora (cylinder, r = w*0.45)
// or non-square boxes like WAF / ALB.
function decalOffset(type, sz) {
  switch (resolveType(type)) {
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
  switch (resolveType(type)) {
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
  switch (resolveType(type)) {
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
  ring.userData.registryId = "internet";
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

  // Azure — fall back to the Microsoft Azure brand icon for everything
  // we don't have a more specific slug for. simple-icons does ship a
  // few Azure-specific service icons, used here where available.
  vm:              "microsoftazure",
  vmss:            "microsoftazure",
  appservice:      "microsoftazure",
  function:        "azurefunctions",
  containerapp:    "microsoftazure",
  aks:             "kubernetes",
  sql:             "microsoftsqlserver",
  postgresql:      "postgresql",
  mysql:           "mysql",
  cosmosdb:        "microsoftazure",
  redis:           "redis",
  blob:            "microsoftazure",
  vnet:            "microsoftazure",
  nsg:             "microsoftazure",
  appgw:           "microsoftazure",
  frontdoor:       "microsoftazure",
  azurewaf:        "microsoftazure",
  azurefirewall:   "microsoftazure",
  vpngw:           "microsoftazure",
  expressroute:    "microsoftazure",
  bastion:         "microsoftazure",
  azuredns:        "microsoftazure",
  apim:            "microsoftazure",
  privateendpoint: "microsoftazure",
  entra:           "microsoftazure",
};
const ICON_CACHE = new Map(); // type -> Promise<HTMLImageElement | null>

function loadIconImage(type) {
  if (ICON_CACHE.has(type)) return ICON_CACHE.get(type);
  // Prefer an icon for the exact type (lets us add Azure-specific slugs
  // later), otherwise fall back to the resolved AWS-equivalent slug.
  const slug = ICON_SLUGS[type] || ICON_SLUGS[resolveType(type)];
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
  ].includes(resolveType(type));
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

// ---- audio: synthesized SFX (WebAudio, no external files) -----------
let _audioCtx = null;
function ensureAudio() {
  if (_audioCtx) return _audioCtx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  _audioCtx = new AC();
  return _audioCtx;
}

// User-controllable: piggyback on the speech toggle so one switch silences
// both narration and SFX. Defaults to on.
function audioEnabled() {
  return localStorage.getItem("aws-viz.speak") !== "0";
}

function playAttackStartSfx() {
  if (!audioEnabled()) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  const now = ctx.currentTime;

  // 1. Massive kick drum (sub-thump that pitches down quickly)
  const kick = ctx.createOscillator();
  const kickG = ctx.createGain();
  kick.type = "sine";
  kick.frequency.setValueAtTime(140, now);
  kick.frequency.exponentialRampToValueAtTime(42, now + 0.25);
  kickG.gain.setValueAtTime(0.45, now);
  kickG.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
  kick.connect(kickG).connect(ctx.destination);
  kick.start(now);
  kick.stop(now + 0.45);

  // 2. Drum noise body (white noise lowpassed + envelope)
  const noiseLen = Math.floor(ctx.sampleRate * 0.3);
  const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
  const noiseData = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseLen; i++) noiseData[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuf;
  const noiseFilt = ctx.createBiquadFilter();
  noiseFilt.type = "lowpass";
  noiseFilt.frequency.setValueAtTime(900, now);
  noiseFilt.frequency.exponentialRampToValueAtTime(140, now + 0.22);
  const noiseG = ctx.createGain();
  noiseG.gain.setValueAtTime(0.24, now);
  noiseG.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
  noise.connect(noiseFilt); noiseFilt.connect(noiseG); noiseG.connect(ctx.destination);
  noise.start(now);
  noise.stop(now + 0.3);

  // 3. Distant war-horn — low sawtooth pair, lowpass-filtered for brass body
  [
    { f: 196, t: 0.18, d: 0.55 }, // G3
    { f: 261, t: 0.50, d: 0.45 }, // C4
  ].forEach(({ f, t, d }) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(f, now + t);
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.setValueAtTime(900, now + t);
    g.gain.setValueAtTime(0.0001, now + t);
    g.gain.linearRampToValueAtTime(0.18, now + t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.001, now + t + d);
    o.connect(filt); filt.connect(g); g.connect(ctx.destination);
    o.start(now + t);
    o.stop(now + t + d + 0.05);
  });
}

let _lastBlockSfxT = 0;
function playBlockSfx() {
  if (!audioEnabled()) return;
  const t = performance.now();
  if (t - _lastBlockSfxT < 70) return; // throttle when blocks come in waves
  _lastBlockSfxT = t;
  const ctx = ensureAudio();
  if (!ctx) return;
  const now = ctx.currentTime;

  // Gunshot crack — short noise burst, high-passed for snap, lowpass
  // sweep for body. Exponential decay over ~120 ms.
  const len = Math.floor(ctx.sampleRate * 0.15);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    // Slight brown-noise tilt sounds beefier than pure white
    data[i] = (Math.random() * 2 - 1) * (1 - i / len * 0.4);
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buf;

  const hpf = ctx.createBiquadFilter();
  hpf.type = "highpass";
  hpf.frequency.value = 500;

  const lpf = ctx.createBiquadFilter();
  lpf.type = "lowpass";
  lpf.frequency.setValueAtTime(3800, now);
  lpf.frequency.exponentialRampToValueAtTime(450, now + 0.12);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.42, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.13);

  noise.connect(hpf); hpf.connect(lpf); lpf.connect(g); g.connect(ctx.destination);
  noise.start(now);
  noise.stop(now + 0.15);

  // Tiny sub-thump for the percussive kick
  const sub = ctx.createOscillator();
  const subG = ctx.createGain();
  sub.type = "sine";
  sub.frequency.setValueAtTime(110, now);
  sub.frequency.exponentialRampToValueAtTime(45, now + 0.07);
  subG.gain.setValueAtTime(0.22, now);
  subG.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
  sub.connect(subG).connect(ctx.destination);
  sub.start(now);
  sub.stop(now + 0.1);
}

let _lastImpactSfxT = 0;
function playImpactSfx() {
  if (!audioEnabled()) return;
  const t = performance.now();
  if (t - _lastImpactSfxT < 130) return;
  _lastImpactSfxT = t;
  const ctx = ensureAudio();
  if (!ctx) return;
  const now = ctx.currentTime;

  // 1. Sub-bass concussion — long sine that pitches down dramatically
  const sub = ctx.createOscillator();
  const subG = ctx.createGain();
  sub.type = "sine";
  sub.frequency.setValueAtTime(95, now);
  sub.frequency.exponentialRampToValueAtTime(28, now + 0.55);
  subG.gain.setValueAtTime(0.42, now);
  subG.gain.exponentialRampToValueAtTime(0.001, now + 0.62);
  sub.connect(subG).connect(ctx.destination);
  sub.start(now);
  sub.stop(now + 0.65);

  // 2. Main blast — wide white-noise body, lowpass swept down so it
  //    reads as a real explosion rather than a synth squelch
  const blastLen = Math.floor(ctx.sampleRate * 0.7);
  const blastBuf = ctx.createBuffer(1, blastLen, ctx.sampleRate);
  const blastData = blastBuf.getChannelData(0);
  for (let i = 0; i < blastLen; i++) {
    blastData[i] = (Math.random() * 2 - 1);
  }
  const blast = ctx.createBufferSource();
  blast.buffer = blastBuf;
  const blastLpf = ctx.createBiquadFilter();
  blastLpf.type = "lowpass";
  blastLpf.frequency.setValueAtTime(2800, now);
  blastLpf.frequency.exponentialRampToValueAtTime(160, now + 0.55);
  const blastG = ctx.createGain();
  blastG.gain.setValueAtTime(0.45, now);
  blastG.gain.linearRampToValueAtTime(0.32, now + 0.12);
  blastG.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
  blast.connect(blastLpf); blastLpf.connect(blastG); blastG.connect(ctx.destination);
  blast.start(now);
  blast.stop(now + 0.8);

  // 3. Crackle / debris sparkle on top — sparse noise high-passed
  const crLen = Math.floor(ctx.sampleRate * 0.45);
  const crBuf = ctx.createBuffer(1, crLen, ctx.sampleRate);
  const crData = crBuf.getChannelData(0);
  for (let i = 0; i < crLen; i++) {
    // Sparse — only ~30% of samples non-zero, sounds like crackle
    crData[i] = Math.random() < 0.3 ? (Math.random() * 2 - 1) : 0;
  }
  const crackle = ctx.createBufferSource();
  crackle.buffer = crBuf;
  const crHpf = ctx.createBiquadFilter();
  crHpf.type = "highpass";
  crHpf.frequency.value = 1800;
  const crG = ctx.createGain();
  crG.gain.setValueAtTime(0, now);
  crG.gain.linearRampToValueAtTime(0.22, now + 0.06);
  crG.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
  crackle.connect(crHpf); crHpf.connect(crG); crG.connect(ctx.destination);
  crackle.start(now);
  crackle.stop(now + 0.5);
}

function playAttackEndSfx(victory) {
  if (!audioEnabled()) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  const now = ctx.currentTime;
  if (victory) {
    // Victory: triumphant brass swell + cymbal-like noise
    [
      { f: 261.63, t: 0,    d: 0.65 }, // C4
      { f: 329.63, t: 0.10, d: 0.55 }, // E4
      { f: 392.00, t: 0.20, d: 0.55 }, // G4
      { f: 523.25, t: 0.32, d: 0.65 }, // C5
    ].forEach(({ f, t, d }) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sawtooth";
      const filt = ctx.createBiquadFilter();
      filt.type = "lowpass";
      filt.frequency.setValueAtTime(1200, now + t);
      o.frequency.setValueAtTime(f, now + t);
      g.gain.setValueAtTime(0, now + t);
      g.gain.linearRampToValueAtTime(0.13, now + t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.001, now + t + d);
      o.connect(filt); filt.connect(g); g.connect(ctx.destination);
      o.start(now + t);
      o.stop(now + t + d + 0.05);
    });
  } else {
    // Defeat: long, mournful descending tone + low rumble
    const desc = ctx.createOscillator();
    const descG = ctx.createGain();
    desc.type = "sawtooth";
    desc.frequency.setValueAtTime(440, now);
    desc.frequency.exponentialRampToValueAtTime(165, now + 1.2);
    const descFilt = ctx.createBiquadFilter();
    descFilt.type = "lowpass";
    descFilt.frequency.value = 900;
    descG.gain.setValueAtTime(0, now);
    descG.gain.linearRampToValueAtTime(0.17, now + 0.15);
    descG.gain.exponentialRampToValueAtTime(0.001, now + 1.3);
    desc.connect(descFilt); descFilt.connect(descG); descG.connect(ctx.destination);
    desc.start(now);
    desc.stop(now + 1.35);
    // Low rumble underneath
    const rumLen = Math.floor(ctx.sampleRate * 1.2);
    const rumBuf = ctx.createBuffer(1, rumLen, ctx.sampleRate);
    const rumData = rumBuf.getChannelData(0);
    for (let i = 0; i < rumLen; i++) rumData[i] = Math.random() * 2 - 1;
    const rum = ctx.createBufferSource();
    rum.buffer = rumBuf;
    const rumLpf = ctx.createBiquadFilter();
    rumLpf.type = "lowpass";
    rumLpf.frequency.value = 180;
    const rumG = ctx.createGain();
    rumG.gain.setValueAtTime(0.12, now);
    rumG.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
    rum.connect(rumLpf); rumLpf.connect(rumG); rumG.connect(ctx.destination);
    rum.start(now);
    rum.stop(now + 1.25);
  }
}

// Pre-defined attack scenarios. Each has its own initialise/tick logic so
// DDoS, SQL injection, and ransomware can have visually distinct stories
// without an explosion of branching.
const ATTACK_DEFS = {
  ddos: {
    id: "ddos",
    name: "DDoS Volumetric Flood",
    icon: "⚡",
    color: 0xff1840, // signature red — overwhelming brute volume
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
      const cdn = findInRegistry(["cloudfront", "frontdoor", "cdn"]);
      const albs = findInRegistry(["alb", "nlb", "appgw"]);
      const wafs = findInRegistry(["waf", "azurewaf", "azurefirewall"]);
      // Targets the attackers aim at. Prefer CDN + ALB if present.
      state.cfg = {
        targets: cdn.concat(albs).map((e) => e.id),
        defenders: wafs.map((e) => e.id),
        source: "internet",
        // Bands of (timeRange, spawnRate per second, blockRate). Rates are
        // tuned for the bigger / slower siege units so the field reads
        // "army" rather than "swarm".
        // Rates tuned for the 3-phase siege units (each lives ~4–5s on
        // screen). Peak band gives ~10 concurrent units in patrol/assault.
        bands: [
          { tStart: 800,   tEnd: 2800,  rate: 1.6, blockRate: 0.05 },
          { tStart: 3000,  tEnd: 7800,  rate: 5,   blockRate: 0.32 },
          { tStart: 8000,  tEnd: 13800, rate: 9,   blockRate: 0.55 },
          { tStart: 14000, tEnd: 18800, rate: 7,   blockRate: 0.85 },
          { tStart: 19000, tEnd: 21500, rate: 2.5, blockRate: 0.55 },
        ],
      };
      if (state.cfg.targets.length === 0) {
        // Fall back to whatever public-facing thing exists.
        const fallback = findInRegistry([
          "alb", "nlb", "appgw", "ec2", "ecs", "vm", "appservice", "aks", "waf", "azurewaf",
        ]);
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

  bruteforce: {
    id: "bruteforce",
    name: "Credential Stuffing Botnet",
    icon: "🔑",
    color: 0xff9418, // amber — locks / keys
    description:
      "A botnet hammers your login endpoint with stolen credential pairs. WAF rate-limits the bursts; MFA / lockout rules catch what slips through. If both fail, accounts get taken over.",
    duration: 22000,
    phases: [
      { t: 0,     label: "Slow probing" },
      { t: 4000,  label: "Volume ramp" },
      { t: 9000,  label: "Peak credential stuffing" },
      { t: 16000, label: "Throttle engaged" },
      { t: 20000, label: "Attack subsides" },
    ],
    init(state) {
      // Pick the most plausible auth target available on the network —
      // identity provider first, then the front door, then any
      // load-balancer / app-gateway, then any web frontend.
      const authPicks = [
        findInRegistry(["entra"]),
        findInRegistry(["frontdoor", "cloudfront", "cdn"]),
        findInRegistry(["appgw", "alb", "nlb", "apigw"]),
        findInRegistry(["appservice", "ec2", "ecs", "vm", "aks"]),
      ].find((arr) => arr.length > 0);
      const targetId = authPicks ? authPicks[0].id : null;
      if (!targetId) {
        state.cfg = { ok: false };
        pushEvent(state, "info", "(no obvious auth endpoint found on this network)");
        return;
      }
      const defenders = findInRegistry(["waf", "azurewaf", "azurefirewall", "entra"])
        .map((e) => e.id);
      state.cfg = {
        ok: true,
        source: "internet",
        targets: [targetId],
        defenders,
        // High volume waves with rate-limiting clamping down over time
        bands: [
          { tStart: 200,   tEnd: 4000,  rate: 4,  blockRate: 0.40 },
          { tStart: 4000,  tEnd: 9000,  rate: 10, blockRate: 0.65 },
          { tStart: 9000,  tEnd: 16000, rate: 16, blockRate: 0.85 },
          { tStart: 16000, tEnd: 20000, rate: 8,  blockRate: 0.95 },
          { tStart: 20000, tEnd: 21500, rate: 2,  blockRate: 0.85 },
        ],
      };
      console.log("[viz3d/attack] bruteforce init — target:", targetId,
        "defenders:", defenders);
      pushEvent(state, "info", `Botnet hammering ${targetId} with stolen credentials`);
    },
    tick(state, dt, elapsed) {
      if (!state.cfg.ok) return;
      tickBandedSpawn(state, dt, elapsed);
    },
    summarize(state) {
      const total = state.stats.spawned;
      const blocked = state.stats.blocked;
      const arrived = state.stats.arrived;
      return {
        outcome: arrived === 0
          ? "Rate-limiting absorbed every burst. No accounts taken over."
          : arrived < 5
          ? `${arrived} login(s) slipped through the rate-limiter — likely caught by MFA or account lockout. Audit the affected IDs.`
          : `Multiple successful logins (${arrived}). Some accounts are likely compromised — force a password rotation and review session tokens.`,
        outcomeStatus: arrived === 0 ? "ok" : arrived < 5 ? "warn" : "danger",
        stats: [
          { label: "Login attempts",  value: total.toLocaleString() },
          { label: "Rate-limited",    value: blocked.toLocaleString() },
          { label: "Reached auth",    value: arrived.toLocaleString() },
        ],
      };
    },
  },

  ransomware: {
    id: "ransomware",
    name: "Ransomware Lateral Spread",
    icon: "🦠",
    color: 0xd428e0, // magenta — corruption / infection
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
      const candidates = findInRegistry([
        "ecs", "lambda", "ec2", "vm", "vmss", "appservice", "function", "containerapp", "aks",
      ]);
      if (candidates.length) {
        const seed = candidates[0].id;
        const dbs = findInRegistry([
          "aurora", "rds", "dynamodb", "sql", "postgresql", "mysql", "cosmosdb",
        ]);
        state.cfg = {
          infected: new Set([seed]),
          spreadInterval: 380,           // start fast so the spread reads
          lastSpawnT: 0,
          spreadTypes: [
            "ecs", "lambda", "ec2", "aurora", "rds", "dynamodb", "s3",
            "vm", "vmss", "appservice", "function", "containerapp", "aks",
            "sql", "postgresql", "mysql", "cosmosdb", "blob", "redis",
          ],
          source: seed,
          // Crown-jewel data tier gets the SG dome — the malware visibly
          // bashes into it.
          defenders: dbs.map((e) => e.id),
        };
        console.log("[viz3d/attack] ransomware init — seed:", seed,
          "candidates:", candidates.length);
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
      const interval = Math.max(140, cfg.spreadInterval - elapsed * 0.04);
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

  portscan: {
    id: "portscan",
    name: "Reconnaissance Port Scan",
    icon: "🔭",
    color: 0x22d4f0, // cyan — sensors / surveillance
    description:
      "An automated scanner fingerprints every reachable port on every public-facing asset. Network ACLs and security groups drop the noise; whatever replies tells the attacker what to attack next.",
    duration: 16000,
    phases: [
      { t: 0,     label: "Edge probe" },
      { t: 3500,  label: "Service fingerprint" },
      { t: 8500,  label: "Deep probe" },
      { t: 13000, label: "Fade" },
    ],
    init(state) {
      // Aim at every non-container resource. Scanners don't care about
      // the network topology — they hit everything reachable.
      const targets = [];
      registry.forEach((entry, id) => {
        if (entry.type === "vpc" || entry.type === "subnet" || entry.type === "internet") return;
        targets.push(id);
      });
      const defs = findInRegistry(["waf", "sg", "nacl", "nsg", "azurewaf", "azurefirewall"])
        .map((e) => e.id);
      state.cfg = {
        source: "internet",
        targets,
        defenders: defs,
        // High volume, high block rate — gives a sense of "spray".
        bands: [
          { tStart: 200,  tEnd: 3500,  rate: 8,  blockRate: 0.7 },
          { tStart: 3500, tEnd: 8500,  rate: 14, blockRate: 0.65 },
          { tStart: 8500, tEnd: 13000, rate: 20, blockRate: 0.6 },
          { tStart: 13000, tEnd: 15500, rate: 6, blockRate: 0.85 },
        ],
      };
      console.log("[viz3d/attack] portscan init —",
        targets.length, "targets,", defs.length, "defenders");
      pushEvent(state, "info",
        `Scanner sweeping ${targets.length} reachable target${targets.length === 1 ? "" : "s"}`);
    },
    tick(state, dt, elapsed) {
      tickBandedSpawn(state, dt, elapsed);
    },
    summarize(state) {
      const total = state.stats.spawned;
      const blocked = state.stats.blocked;
      const arrived = state.stats.arrived;
      const ratio = total > 0 ? arrived / total : 0;
      return {
        outcome: ratio < 0.1
          ? `Surface stayed quiet. ${blocked.toLocaleString()} probes dropped at the perimeter; only ${arrived} services replied — exactly what should be public.`
          : ratio < 0.3
          ? `Scanner mapped some of your surface. ${arrived} services responded. Re-check what is public vs. private.`
          : `Wide-open surface. ${arrived} services responded to fingerprinting — review which of those should not be on the public network.`,
        outcomeStatus: ratio < 0.1 ? "ok" : ratio < 0.3 ? "warn" : "danger",
        stats: [
          { label: "Probes fired",       value: total.toLocaleString() },
          { label: "Dropped by SG/NSG",  value: blocked.toLocaleString() },
          { label: "Services responded", value: arrived.toLocaleString() },
        ],
      };
    },
  },

  exfil: {
    id: "exfil",
    name: "Data Exfiltration",
    icon: "📤",
    color: 0xf8c828, // gold — loot leaving
    description:
      "An attacker who already has a foothold on a database starts streaming data outbound. Egress firewall and DLP intercept what they can.",
    duration: 22000,
    phases: [
      { t: 0,     label: "Quiet recon" },
      { t: 3000,  label: "Initial leak" },
      { t: 8000,  label: "Bulk transfer" },
      { t: 16000, label: "DLP alerts" },
      { t: 20000, label: "Cleanup" },
    ],
    init(state) {
      const sources = findInRegistry([
        "aurora", "rds", "dynamodb", "sql", "postgresql", "mysql", "cosmosdb", "s3", "blob",
      ]);
      if (sources.length === 0) {
        console.warn("[viz3d/attack] exfil: no data-tier resource to exfil from");
        state.cfg = { ok: false };
        pushEvent(state, "info", "(no data-tier resource found — nothing to exfiltrate)");
        return;
      }
      const sourceId = sources[0].id;
      const defs = findInRegistry([
        "nat", "vpngw", "waf", "azurewaf", "azurefirewall", "tgw",
      ]).map((e) => e.id);
      state.cfg = {
        ok: true,
        sourceId,
        defenders: defs,
        bands: [
          { tStart: 200,   tEnd: 3000,  rate: 0.6, blockRate: 0.10 },
          { tStart: 3000,  tEnd: 8000,  rate: 1.8, blockRate: 0.30 },
          { tStart: 8000,  tEnd: 16000, rate: 3.5, blockRate: 0.40 },
          { tStart: 16000, tEnd: 20000, rate: 4,   blockRate: 0.70 },
          { tStart: 20000, tEnd: 21500, rate: 1.2, blockRate: 0.95 },
        ],
      };
      markInfected(state, sourceId);
      console.log("[viz3d/attack] exfil init — source:", sourceId, "defenders:", defs);
      pushEvent(state, "danger",
        `Foothold detected on ${sourceId} — outbound transfer building`);
    },
    tick(state, dt, elapsed) {
      const cfg = state.cfg;
      if (!cfg || !cfg.ok) return;
      cfg._spawnAccum = cfg._spawnAccum || {};
      cfg.bands.forEach((b, i) => {
        if (elapsed < b.tStart || elapsed >= b.tEnd) return;
        cfg._spawnAccum[i] = (cfg._spawnAccum[i] || 0) + b.rate * dt;
        while (cfg._spawnAccum[i] >= 1) {
          cfg._spawnAccum[i] -= 1;
          spawnAttacker(state, {
            sourceId: cfg.sourceId,
            targetId: "internet",
            kind: "outbound",
            blockRate: b.blockRate,
            defenderName: "egress firewall",
          });
        }
      });
    },
    summarize(state) {
      const total = state.stats.spawned;
      const blocked = state.stats.blocked;
      const arrived = state.stats.arrived;
      return {
        outcome: total === 0
          ? "No outbound exfiltration channel exists (data tier has no internet path)."
          : arrived === 0
          ? "Egress firewall caught everything. No data left the perimeter."
          : arrived < total * 0.2
          ? `${arrived} payload${arrived === 1 ? "" : "s"} reached the internet before DLP fired. Tighten egress allow-listing.`
          : `Data leak. ${arrived} outbound transfers reached the public internet. Forensic review required.`,
        outcomeStatus: arrived === 0 ? "ok" : arrived < total * 0.2 ? "warn" : "danger",
        stats: [
          { label: "Exfil attempts",     value: total.toLocaleString() },
          { label: "Dropped at egress",  value: blocked.toLocaleString() },
          { label: "Reached internet",   value: arrived.toLocaleString() },
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
      spawnAttacker(state, {
        sourceId: cfg.source,
        targetId: target,
        blockRate: b.blockRate,
        defenderName: "defender",
        kind: "siege",
      });
    }
  });

  // Track peak QPS over a 1-second sliding window
  const window = state._rateWindow = state._rateWindow || [];
  while (window.length && window[0] < elapsed - 1000) window.shift();
}

function pickRandom(arr) {
  return arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;
}

function makeAttackerUnit(color) {
  // Bigger / chunkier than before so individual units read at city scale.
  // Body + halo + beacon + ground aura are all tinted with `color` so
  // each attack type has its own visual signature (DDoS red, brute-
  // force amber, ransomware magenta, port-scan cyan, exfil gold).
  const baseHex = color || 0xff1840;
  const baseColor = new THREE.Color(baseHex);
  // Brighter / warmer shade for the cone tip so it reads as flame
  const tipColor = baseColor.clone().offsetHSL(0.04, 0.05, 0.18);

  const grp = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({
    color: baseColor.clone(),
    emissive: baseColor.clone(),
    emissiveIntensity: 1.55,
    metalness: 0.6,
    roughness: 0.3,
  });
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 1.5, 6.0, 12),
    bodyMat,
  );
  body.position.y = 3.2;
  grp.add(body);

  const tipMat = new THREE.MeshStandardMaterial({
    color: tipColor,
    emissive: tipColor,
    emissiveIntensity: 1.7,
    metalness: 0.55,
    roughness: 0.28,
  });
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.4, 12), tipMat);
  tip.position.y = 7.4;
  grp.add(tip);

  // Big halo around the body
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(4.2, 18, 14),
    new THREE.MeshBasicMaterial({
      color: baseColor.clone(), transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  halo.position.y = 3.8;
  grp.add(halo);

  // Beacon column shooting up — keeps the attacker visible from any
  // camera angle including bird's-eye
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.7, 22, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: baseColor.clone(), transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  beacon.position.y = 19;
  grp.add(beacon);

  // Big ground aura (uses a per-colour cached texture)
  const aura = makeAuraSprite(baseHex);
  aura.position.y = 0.3;
  aura.scale.set(12, 12, 1);
  grp.add(aura);

  return { group: grp, body, halo };
}

// Vertical "drop-pod" beam at the slot. The beam sits OUTSIDE the city
// (the slot is already on the perimeter ring) and points straight down,
// so it never crosses the network interior — fixing the previous portal-
// to-slot beam that drew a red line through every building. Tinted to
// match the attack's signature colour.
function makeDescentBeam(slot, color) {
  const beamHeight = 55;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 1.4, beamHeight, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: color || 0xff3a5b, transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  beam.position.set(slot.x, slot.y + beamHeight / 2, slot.z);
  return beam;
}

// Per-colour cache of the radial-gradient aura texture so we don't bake
// the same canvas 200 times during a heavy wave.
const _auraTexCache = new Map();
function isCachedAuraTexture(tex) {
  for (const v of _auraTexCache.values()) if (v === tex) return true;
  return false;
}
function makeAuraSprite(color) {
  let tex = _auraTexCache.get(color);
  if (!tex) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d");
    const col = new THREE.Color(color);
    const r = Math.round(col.r * 255),
          g = Math.round(col.g * 255),
          b = Math.round(col.b * 255);
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0,    `rgba(${r}, ${g}, ${b}, 0.78)`);
    grad.addColorStop(0.45, `rgba(${r}, ${g}, ${b}, 0.32)`);
    grad.addColorStop(1,    `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    tex = new THREE.CanvasTexture(canvas);
    _auraTexCache.set(color, tex);
  }
  const mat = new THREE.SpriteMaterial({
    map: tex,
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
      ms.forEach((m) => {
        // Skip cached aura textures — they're shared across many units
        if (m.map && !isCachedAuraTexture(m.map)) m.map.dispose && m.map.dispose();
        m.dispose();
      });
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

// External attackers (DDoS, SQLi) all spawn at the EXACT internet portal
// position. They follow a curved descent path out to a slot on a perimeter
// ring, hold formation there for ~1.5s (the siege ring forms visibly),
// then charge to the actual target.
//
// Slot assignment is round-robin around 18 angles so the army naturally
// fills a circle around the city, matching the user's "form up around
// the fortress, then attack" reference.
//
// "kind: spread" (ransomware) skips descent + formation — it crawls
// across the ground from an already-infected node to the next victim.
const FORMATION_SLOTS = 18;

function spawnAttacker(state, opts) {
  const tgt = registry.get(opts.targetId);
  if (!tgt) {
    if (!state._missTargetWarned) {
      state._missTargetWarned = new Set();
    }
    if (!state._missTargetWarned.has(opts.targetId)) {
      state._missTargetWarned.add(opts.targetId);
      console.warn("[viz3d/attack] target not in registry:", opts.targetId,
        "(opts:", opts, ")");
    }
    return;
  }

  const attackColor = (state.def && state.def.color) || 0xff1840;
  const visual = makeAttackerUnit(attackColor);
  attackerLayer.add(visual.group);

  const blocked = opts.blocked != null
    ? opts.blocked
    : Math.random() < (opts.blockRate || 0);
  const interceptT = blocked
    ? (opts.interceptT != null ? opts.interceptT : 0.35 + Math.random() * 0.35)
    : null;

  let attacker;

  if (opts.kind === "spread") {
    const src = registry.get(opts.sourceId);
    const start = src
      ? new THREE.Vector3(src.position.x, 1, src.position.z)
      : new THREE.Vector3(0, 1, 0);
    visual.group.position.copy(start);
    attacker = {
      visual,
      beam: null,
      phase: "assault",
      phaseT: 0,
      assaultDuration: 1.7 + Math.random() * 0.5,
      assaultStart: start,
      assaultEnd: tgt.position.clone(),
    };
  } else if (opts.kind === "outbound") {
    // Data exfiltration: start at the compromised internal node, arc UP
    // and OVER the city, and exit through the internet portal. Reverse of
    // the normal siege so the visual flow is unmistakable (data leaving).
    const src = registry.get(opts.sourceId);
    const start = src
      ? new THREE.Vector3(src.position.x, Math.max(1, src.position.y), src.position.z)
      : new THREE.Vector3(0, 1, 0);
    const end = tgt.position.clone();
    const liftHeight = Math.max(45, Math.max(start.y, end.y) + 22);
    const sourceAbove = new THREE.Vector3(start.x, liftHeight, start.z);
    const portalAbove = new THREE.Vector3(end.x, liftHeight, end.z);
    const exitCurve = new THREE.CatmullRomCurve3([
      start, sourceAbove, portalAbove, end,
    ]);
    visual.group.position.copy(start);
    attacker = {
      visual,
      beam: null,
      phase: "outbound",
      phaseT: 0,
      outboundDuration: 2.6 + Math.random() * 0.6,
      outboundCurve: exitCurve,
      assaultStart: start,
      assaultEnd: end,
    };
  } else {
    // The portal IS the gate — every attacker emerges from it.
    const internet = registry.get("internet");
    const portalPos = internet ? internet.position.clone() : new THREE.Vector3(0, 16, 0);

    // Round-robin slot assignment so the formation fills a visible ring
    state.formationIndex = ((state.formationIndex || 0) + 1) % FORMATION_SLOTS;
    const baseAngle = (state.formationIndex / FORMATION_SLOTS) * Math.PI * 2;
    const angle = baseAngle + (Math.random() - 0.5) * 0.06; // tiny jitter
    const r = Math.max(CITY.w, CITY.d) * 0.95 + 36;
    const slot = new THREE.Vector3(Math.cos(angle) * r, 1, Math.sin(angle) * r);

    // Path is 4 control points so the descent goes UP from the portal,
    // ACROSS at altitude (well above any building), then DOWN to the
    // slot. CatmullRom smooths the corners. Result: the attacker arcs
    // OVER the city, never crossing buildings.
    const liftHeight = Math.max(portalPos.y + 24, 42);
    const portalAbove = new THREE.Vector3(portalPos.x, liftHeight, portalPos.z);
    const slotAbove = new THREE.Vector3(slot.x, liftHeight, slot.z);
    const descentCurve = new THREE.CatmullRomCurve3([
      portalPos, portalAbove, slotAbove, slot,
    ]);

    visual.group.position.copy(portalPos);
    const beam = makeDescentBeam(slot, attackColor);
    attackerLayer.add(beam);

    attacker = {
      visual,
      beam,
      phase: "descent",
      phaseT: 0,
      descentDuration: 1.6 + Math.random() * 0.4,
      formationDuration: 1.4 + Math.random() * 0.6,
      assaultDuration: 1.9 + Math.random() * 0.4,
      descentCurve,
      slot,
      assaultStart: slot,
      assaultEnd: tgt.position.clone(),
    };
  }

  attacker.blocked = blocked;
  attacker.interceptT = interceptT;
  attacker.targetId = opts.targetId;
  attacker.defenderName = opts.defenderName || "defender";
  attacker.targetName = (tgt && tgt.name) || opts.targetId;
  attacker.onArrival = opts.onArrival;
  attacker.onBlocked = opts.onBlocked;

  state.attackers.push(attacker);
  state.stats.spawned++;
  if (state._rateWindow) state._rateWindow.push(performance.now() - state.startTime);
  state.stats.peakRate = Math.max(state.stats.peakRate, state._rateWindow ? state._rateWindow.length : 0);
}

function spawnAttackerOnPath(state, path, hopBlockChance) {
  if (!path || path.length === 0) {
    if (!state._pathWarned) {
      state._pathWarned = true;
      console.warn("[viz3d/attack] spawnAttackerOnPath: empty path", path);
    }
    return;
  }
  // Roll for block at each hop in order — first hit wins
  let blockedHop = -1;
  for (let i = 0; i < path.length; i++) {
    if (Math.random() < (hopBlockChance[i] || 0)) { blockedHop = i; break; }
  }
  const finalTargetId = path[path.length - 1];
  if (!state._firstPathSpawn) {
    state._firstPathSpawn = true;
    console.log("[viz3d/attack] sqli spawning along path:", path,
      "→ target", finalTargetId, "blockedHop:", blockedHop);
  }
  // Map blocked hop to a fraction of the assault phase (cdn = early,
  // db = late) so the defender that catches it determines where the
  // shield sparks fire.
  const interceptT = blockedHop >= 0
    ? Math.min(0.92, 0.18 + (blockedHop / Math.max(1, path.length - 1)) * 0.7)
    : null;
  spawnAttacker(state, {
    sourceId: "internet",
    targetId: finalTargetId,
    kind: "siege",
    blocked: blockedHop >= 0,
    interceptT,
    defenderName: blockedHop >= 0 ? `at ${path[blockedHop]}` : null,
  });
}

function disposeAttackerBeam(attacker) {
  if (!attacker.beam) return;
  attackerLayer.remove(attacker.beam);
  attacker.beam.geometry.dispose();
  attacker.beam.material.dispose();
  attacker.beam = null;
}

// Big multi-stage explosion when a defender intercepts an attacker —
// reads as a tower-defense / RTS hit instead of a tiny spark. White-hot
// core, expanding orange shell, expanding ground shockwave ring, and a
// burst of glowing sparks flying outward with gravity.
function spawnDefenseExplosion(pos) {
  playBlockSfx();
  const layer = attackerLayer;

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(2.4, 18, 14),
    new THREE.MeshBasicMaterial({
      color: 0xfff7c0, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  core.position.copy(pos);
  layer.add(core);

  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(3.6, 18, 14),
    new THREE.MeshBasicMaterial({
      color: 0xffaa44, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  shell.position.copy(pos);
  layer.add(shell);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.0, 1.9, 56),
    new THREE.MeshBasicMaterial({
      color: 0xffd566, transparent: true, opacity: 1,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(pos.x, 0.55, pos.z);
  layer.add(ring);

  // Flying sparks — small spheres with a velocity + gravity so they fall
  const sparks = [];
  for (let i = 0; i < 12; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 9 + Math.random() * 8;
    const elev = 0.4 + Math.random() * 0.7;
    const spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 8, 6),
      new THREE.MeshBasicMaterial({
        color: 0xffd566, transparent: true, opacity: 1,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    spark.position.copy(pos);
    layer.add(spark);
    sparks.push({
      mesh: spark,
      vx: Math.cos(angle) * speed,
      vy: speed * elev,
      vz: Math.sin(angle) * speed,
    });
  }

  attackState.explosions = attackState.explosions || [];
  attackState.explosions.push({ core, shell, ring, sparks, life: 0.85, duration: 0.85 });
}

// Dramatic red impact at a successful target hit: a vertical light column
// and an expanding shockwave ring on the ground.
function spawnImpact(pos) {
  // Impact takes its colour from the current attack so each attack type
  // has its own bloom. SFX trigger here too.
  playImpactSfx();
  const tint = (attackState && attackState.def && attackState.def.color) || 0xff3a5b;
  const colGeo = new THREE.CylinderGeometry(0.6, 1.6, 28, 14, 1, true);
  const colMat = new THREE.MeshBasicMaterial({
    color: tint, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
  });
  const col = new THREE.Mesh(colGeo, colMat);
  col.position.set(pos.x, pos.y + 13, pos.z);
  attackerLayer.add(col);

  const ringGeo = new THREE.RingGeometry(0.8, 1.6, 48);
  const ringMat = new THREE.MeshBasicMaterial({
    color: tint, transparent: true, opacity: 0.95,
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

  playAttackStartSfx();

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
        if (m.map && !isCachedAuraTexture(m.map)) m.map.dispose && m.map.dispose();
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

  // Move attackers through their state machine.
  attackState.attackers = attackState.attackers.filter((a) => {
    a.phaseT += dt;

    // Outbound (data exfiltration): travels from compromised node along
    // a curve up over the city to the internet portal. Same intercept
    // semantics as assault, just reversed direction.
    if (a.phase === "outbound") {
      const t = Math.min(1, a.phaseT / a.outboundDuration);
      if (a.blocked && a.interceptT != null && t >= a.interceptT) {
        const p = a.outboundCurve.getPointAt(a.interceptT);
        p.y = Math.max(p.y, 6);
        spawnDefenseExplosion(p);
        attackState.stats.blocked++;
        if (a.onBlocked) a.onBlocked(attackState);
        else pushEvent(attackState, "ok",
          `Egress blocked${a.defenderName ? " by " + a.defenderName : ""}`);
        disposeAttackerVisual(a.visual);
        return false;
      }
      if (t >= 1) {
        spawnImpact(a.assaultEnd);
        attackState.stats.arrived++;
        if (a.onArrival) a.onArrival(attackState);
        else pushEvent(attackState, "danger",
          `Payload exfiltrated → ${a.targetName}`);
        disposeAttackerVisual(a.visual);
        return false;
      }
      const p = a.outboundCurve.getPointAt(t);
      a.visual.group.position.copy(p);
      return true;
    }

    if (a.phase === "descent") {
      const t = Math.min(1, a.phaseT / a.descentDuration);
      // Curved swoop from the portal out to the slot
      const p = a.descentCurve.getPointAt(t);
      a.visual.group.position.copy(p);
      if (a.beam) a.beam.material.opacity = 0.95 * (1 - Math.max(0, t - 0.2) / 0.8);
      if (t >= 1) {
        disposeAttackerBeam(a);
        a.phase = "formation";
        a.phaseT = 0;
      }
      return true;
    }

    if (a.phase === "formation") {
      const t = Math.min(1, a.phaseT / a.formationDuration);
      // Hold formation: stay in slot, gentle bob so the unit reads "alive"
      const bob = Math.sin(a.phaseT * 4.5) * 0.18;
      a.visual.group.position.set(a.slot.x, a.slot.y + bob, a.slot.z);
      if (t >= 1) {
        a.phase = "assault";
        a.phaseT = 0;
      }
      return true;
    }

    // assault
    const t = Math.min(1, a.phaseT / a.assaultDuration);

    if (a.blocked && a.interceptT != null && t >= a.interceptT) {
      const p = new THREE.Vector3()
        .lerpVectors(a.assaultStart, a.assaultEnd, a.interceptT);
      // Lift slightly so the explosion doesn't sink into the ground
      p.y = Math.max(p.y, 2.5);
      spawnDefenseExplosion(p);
      attackState.stats.blocked++;
      if (a.onBlocked) a.onBlocked(attackState);
      else pushEvent(attackState, "ok",
        `Blocked${a.defenderName ? " " + a.defenderName : ""} → ${a.targetName}`);
      disposeAttackerVisual(a.visual);
      disposeAttackerBeam(a);
      return false;
    }
    if (t >= 1) {
      spawnImpact(a.assaultEnd);
      flashTarget(a.targetId, 0xff3a5b, 0.9);
      attackState.stats.arrived++;
      if (a.onArrival) a.onArrival(attackState);
      else pushEvent(attackState, "danger", `Reached ${a.targetName}`);
      disposeAttackerVisual(a.visual);
      disposeAttackerBeam(a);
      return false;
    }
    const pos = new THREE.Vector3().lerpVectors(a.assaultStart, a.assaultEnd, t);
    if (a.assaultEnd.y > 1) {
      pos.y = 1 + (a.assaultEnd.y - 1) * t;
    }
    a.visual.group.position.copy(pos);
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

  // Animate defense explosions
  attackState.explosions = (attackState.explosions || []).filter((e) => {
    e.life -= dt;
    if (e.life <= 0) {
      [e.core, e.shell, e.ring].forEach((m) => {
        attackerLayer.remove(m);
        m.geometry.dispose();
        m.material.dispose();
      });
      e.sparks.forEach((s) => {
        attackerLayer.remove(s.mesh);
        s.mesh.geometry.dispose();
        s.mesh.material.dispose();
      });
      return false;
    }
    const alive = e.life / e.duration;
    e.core.scale.setScalar(0.6 + (1 - alive) * 0.7);
    e.core.material.opacity = alive * alive;
    e.shell.scale.setScalar(0.8 + (1 - alive) * 5.5);
    e.shell.material.opacity = alive * 0.75;
    const rsc = 1 + (1 - alive) * 28;
    e.ring.scale.setScalar(rsc);
    e.ring.material.opacity = alive;
    e.sparks.forEach((s) => {
      s.mesh.position.x += s.vx * dt;
      s.mesh.position.y += s.vy * dt;
      s.mesh.position.z += s.vz * dt;
      s.vy -= 28 * dt; // gravity
      s.mesh.material.opacity = alive;
    });
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
    const summary = buildAttackSummary();
    // Victorious chord if defenders held; minor descent otherwise.
    playAttackEndSfx(summary.outcomeStatus === "ok");
    if (window.AwsAttack && typeof window.AwsAttack.onEnd === "function") {
      window.AwsAttack.onEnd(summary);
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

// ---------- pointer hover (orbit mode) ----------
//
// Mirrors the 2D view's hover affordance: under the cursor, find the topmost
// registered mesh and route it through AwsViz.onSelect so the sidebar shows
// the same details. Also drives the global #tooltip element. Disabled while
// explore mode is active — that mode owns the pointer.

function onCanvasPointerMove(evt) {
  _pointerInside = true;
  if (exploreActive || !renderer || !camera || !cityGroup) return;
  const rect = renderer.domElement.getBoundingClientRect();
  _pointer.x = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
  _pointer.y = -((evt.clientY - rect.top) / rect.height) * 2 + 1;
  _raycaster.setFromCamera(_pointer, camera);

  // Build the candidate list lazily — meshes change on every render() call.
  const targets = [];
  registry.forEach((entry) => { if (entry.mesh) targets.push(entry.mesh); });
  const hits = _raycaster.intersectObjects(targets, false);
  // intersectObjects returns hits sorted near→far, but flat platforms (VPC /
  // subnet) sit below buildings; if both are hit we want the building (the
  // smallest one) so users can hover individual services. The default sort
  // already does this: buildings on top of subnets are closer to the camera.
  const hit = hits[0];
  const id = hit ? hit.object.userData.registryId : null;

  const tooltip = document.getElementById("tooltip");
  if (id !== hoveredId) {
    hoveredId = id;
    if (id) {
      // Look up the original node in the 2D layout so we get name/cidr/az etc.
      const lay = window.AwsViz && window.AwsViz.getLayout && window.AwsViz.getLayout();
      const node = lay && lay.nodes.get(id);
      if (window.AwsViz && typeof window.AwsViz.onSelect === "function") {
        window.AwsViz.onSelect(node || { id, type: registry.get(id).type });
      }
      if (tooltip) {
        const entry = registry.get(id);
        const type = (node && node.type) || (entry && entry.type) || "unknown";
        const meta =
          type === "subnet"
            ? (window.AWS_TIER_EXPLAIN || {})[node && node.tier] ||
              (window.AWS_EXPLAIN || {}).subnet
            : (window.AWS_EXPLAIN || {})[type] || (window.AWS_EXPLAIN || {}).unknown;
        const title = (node && (node.name || node.id)) || id;
        tooltip.innerHTML =
          `<strong>${escapeHtml(title)}</strong>${escapeHtml((meta && meta.title) || type)}`;
        tooltip.classList.add("show");
        tooltip.setAttribute("aria-hidden", "false");
      }
    } else if (tooltip) {
      tooltip.classList.remove("show");
      tooltip.setAttribute("aria-hidden", "true");
      if (window.AwsViz && typeof window.AwsViz.onSelect === "function") {
        window.AwsViz.onSelect(null);
      }
    }
  }
  if (tooltip && tooltip.classList.contains("show")) {
    const pad = 14;
    const w = tooltip.offsetWidth || 200;
    const h = tooltip.offsetHeight || 40;
    let x = evt.clientX + pad;
    let y = evt.clientY + pad;
    if (x + w > window.innerWidth - 10) x = evt.clientX - w - pad;
    if (y + h > window.innerHeight - 10) y = evt.clientY - h - pad;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  }
}

function onCanvasPointerLeave() {
  _pointerInside = false;
  hoveredId = null;
  const tooltip = document.getElementById("tooltip");
  if (tooltip) {
    tooltip.classList.remove("show");
    tooltip.setAttribute("aria-hidden", "true");
  }
  if (window.AwsViz && typeof window.AwsViz.onSelect === "function") {
    window.AwsViz.onSelect(null);
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

// ---------- version diff animation ----------
//
// When a timeline version is clicked, app.js passes a diff describing which
// node IDs (and flows) appeared or disappeared. We tag freshly-added meshes
// with userData.addedAt so the animate loop can play a green emissive pulse
// and a brief scale-pop, and we build a ghost layer of red dashed boxes at
// the previous positions of removed elements.

function applyVersionDiff3D(diff, prevPositions) {
  const now = performance.now();

  // Mark added meshes for the in-loop pulse.
  (diff.addedNodes || []).forEach((id) => {
    const entry = registry.get(id);
    if (!entry || !entry.mesh) return;
    entry.mesh.userData.addedAt = now;
    entry.mesh.userData.addedBaseEmissiveIntensity =
      entry.mesh.material && entry.mesh.material.emissiveIntensity;
    entry.mesh.userData.addedBaseEmissiveHex =
      entry.mesh.material && entry.mesh.material.emissive
        ? entry.mesh.material.emissive.getHex()
        : null;
  });

  // Flow add/remove glow — the tube is the last cityGroup child added for a
  // flow but we don't track them by id. We tag the matching particleSystem
  // and the animate loop pulses every packet's halo.
  const flowKey = (f) => `${f.from}|${f.to}`;
  const addedFlowSet = new Set((diff.addedFlows || []).map(flowKey));
  particleSystems.forEach((ps) => {
    if (addedFlowSet.has(`${ps.fromId}|${ps.toId}`)) {
      ps.addedAt = now;
    }
  });

  // Tear down any previous ghost layer, then build a fresh one.
  if (ghostLayer) {
    cityGroup.remove(ghostLayer);
    ghostLayer.traverse((c) => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        const ms = Array.isArray(c.material) ? c.material : [c.material];
        ms.forEach((m) => m.dispose());
      }
    });
    ghostLayer = null;
  }
  const removedNodes = (diff.removedNodes || []).filter((id) => prevPositions.has(id));
  const removedFlows = (diff.removedFlows || []).filter(
    (f) => prevPositions.has(f.from) && prevPositions.has(f.to),
  );
  if (removedNodes.length || removedFlows.length) {
    ghostLayer = new THREE.Group();
    removedNodes.forEach((id) => {
      const prev = prevPositions.get(id);
      const r = Math.max(3, prev.extent);
      const h = Math.max(3, prev.height);
      const geo = new THREE.BoxGeometry(r * 2, h + 2, r * 2);
      const edges = new THREE.EdgesGeometry(geo);
      const line = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({
          color: 0xef4444,
          transparent: true,
          opacity: 0.95,
        }),
      );
      line.position.copy(prev.position);
      line.position.y = h / 2 + 1;
      ghostLayer.add(line);

      // Skull-cap glow sprite so the ghost reads even from far away.
      const halo = makeGlowSprite(0xef4444, r * 5);
      halo.position.copy(prev.position);
      halo.position.y = 3;
      ghostLayer.add(halo);
    });

    removedFlows.forEach((f) => {
      const a = prevPositions.get(f.from);
      const b = prevPositions.get(f.to);
      const start = a.position.clone();
      const end = b.position.clone();
      const mid = start.clone().lerp(end, 0.5);
      mid.y += Math.min(28, Math.max(6, start.distanceTo(end) * 0.32));
      const curve = new THREE.CatmullRomCurve3([start, mid, end]);
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 48, 0.5, 8, false),
        new THREE.MeshBasicMaterial({
          color: 0xef4444,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      ghostLayer.add(tube);
    });

    cityGroup.add(ghostLayer);
    ghostUntil = now + 2800;
  }
}

// Big "this version is broken / fixed" overhead flourish. Broken = red
// strobe + low rumble of red light; fixed = expanding green ring on the
// ground + green sparkle dome. Lasts ~2.4s, self-cleans in animate().
function triggerStatusFlourish(kind) {
  // Tear down any prior flourish.
  if (statusFlourish && statusFlourish.group) {
    cityGroup.remove(statusFlourish.group);
    statusFlourish.group.traverse((c) => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        const ms = Array.isArray(c.material) ? c.material : [c.material];
        ms.forEach((m) => m.dispose());
      }
    });
  }
  const now = performance.now();
  const grp = new THREE.Group();
  const color = kind === "broken" ? 0xef4444 : 0x4ade80;
  const radius = Math.max(CITY.w, CITY.d) * 0.55 + 30;

  // Ground ring sweep — both flavours get one, scaled in animate().
  const ringGeo = new THREE.RingGeometry(radius - 1.5, radius, 96);
  const ringMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(0, 0.6, 0);
  ring.userData.flourishRing = true;
  grp.add(ring);

  // Dome of sparkle points — green for fixed (gentle), red shower for broken.
  const count = kind === "broken" ? 240 : 180;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = Math.random() * radius * 0.95;
    const yy = kind === "broken"
      ? 4 + Math.random() * 60
      : 2 + Math.pow(Math.random(), 0.6) * 60;
    pos[i * 3 + 0] = Math.cos(a) * rr;
    pos[i * 3 + 1] = yy;
    pos[i * 3 + 2] = Math.sin(a) * rr;
  }
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const sparkMat = new THREE.PointsMaterial({
    color,
    size: kind === "broken" ? 2.2 : 1.8,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  sparks.userData.flourishSparks = true;
  sparks.userData.dirSign = kind === "broken" ? -1 : 1; // broken: rain down; fixed: rise
  grp.add(sparks);

  cityGroup.add(grp);

  statusFlourish = {
    kind,
    group: grp,
    ring,
    sparks,
    startedAt: now,
    until: now + (kind === "broken" ? 2600 : 2400),
  };

  // For broken versions, also flash every building's emissive red briefly.
  if (kind === "broken") {
    registry.forEach((entry) => {
      if (!entry.mesh || !entry.mesh.material || !entry.mesh.material.emissive) return;
      if (entry.type === "vpc" || entry.type === "subnet") return;
      entry.mesh.userData.brokenFlashAt = now;
      entry.mesh.userData.brokenFlashBaseHex = entry.mesh.material.emissive.getHex();
      entry.mesh.userData.brokenFlashBaseI = entry.mesh.material.emissiveIntensity;
    });
  }
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
    // Version-diff: pop-in + green emissive pulse on freshly added meshes.
    if (c.userData.addedAt) {
      const elapsed = now - c.userData.addedAt;
      const duration = 2400;
      if (elapsed > duration) {
        // Restore baseline.
        if (c.material && c.material.emissive && c.userData.addedBaseEmissiveHex != null) {
          c.material.emissive.setHex(c.userData.addedBaseEmissiveHex);
        }
        if (c.material && c.userData.addedBaseEmissiveIntensity != null) {
          c.material.emissiveIntensity = c.userData.addedBaseEmissiveIntensity;
        }
        c.scale.setScalar(1);
        delete c.userData.addedAt;
        delete c.userData.addedBaseEmissiveHex;
        delete c.userData.addedBaseEmissiveIntensity;
      } else {
        // Scale: pop-up to 1.12 in first 350ms, settle to 1.0.
        const pop = elapsed < 350
          ? 0.35 + (elapsed / 350) * 0.77
          : elapsed < 700
            ? 1.12 - ((elapsed - 350) / 350) * 0.12
            : 1.0;
        c.scale.setScalar(pop);
        // Emissive pulse — green for ~2.4s, fades out.
        if (c.material && c.material.emissive) {
          const phase = (Math.sin(elapsed / 140) + 1) / 2; // 0..1
          const k = Math.max(0, 1 - elapsed / duration);
          c.material.emissive.setRGB(0.29 + phase * 0.3 * k, 0.88, 0.5);
          c.material.emissiveIntensity =
            (c.userData.addedBaseEmissiveIntensity || 0.45) + 0.8 * k * phase;
        }
      }
    }
    // Version-status flourish: "broken" flashes every building emissive red.
    if (c.userData.brokenFlashAt) {
      const elapsed = now - c.userData.brokenFlashAt;
      const duration = 1800;
      if (elapsed > duration) {
        if (c.material && c.material.emissive && c.userData.brokenFlashBaseHex != null) {
          c.material.emissive.setHex(c.userData.brokenFlashBaseHex);
        }
        if (c.material && c.userData.brokenFlashBaseI != null) {
          c.material.emissiveIntensity = c.userData.brokenFlashBaseI;
        }
        delete c.userData.brokenFlashAt;
        delete c.userData.brokenFlashBaseHex;
        delete c.userData.brokenFlashBaseI;
      } else if (c.material && c.material.emissive) {
        const k = Math.max(0, 1 - elapsed / duration);
        const flicker = 0.4 + 0.6 * ((Math.sin(elapsed / 55) + 1) / 2);
        c.material.emissive.setRGB(0.94, 0.27 * flicker, 0.27 * flicker);
        c.material.emissiveIntensity =
          (c.userData.brokenFlashBaseI || 0.45) + 1.0 * k * flicker;
      }
    }
  });

  // Ghost-layer cleanup + fade-out for removed elements.
  if (ghostLayer) {
    const remain = ghostUntil - now;
    if (remain <= 0) {
      cityGroup.remove(ghostLayer);
      ghostLayer.traverse((c) => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) {
          const ms = Array.isArray(c.material) ? c.material : [c.material];
          ms.forEach((m) => m.dispose());
        }
      });
      ghostLayer = null;
    } else {
      const t = Math.max(0, Math.min(1, remain / 2800));
      const flicker = 0.55 + 0.45 * ((Math.sin(now / 95) + 1) / 2);
      ghostLayer.traverse((c) => {
        if (c.material && "opacity" in c.material) {
          c.material.opacity = t * flicker;
          c.material.transparent = true;
        }
      });
    }
  }

  // Status flourish (red broken / green fixed) — expanding ground ring + sparks.
  if (statusFlourish) {
    const elapsed = now - statusFlourish.startedAt;
    const total = statusFlourish.until - statusFlourish.startedAt;
    const u = Math.min(1, elapsed / total);
    if (u >= 1) {
      cityGroup.remove(statusFlourish.group);
      statusFlourish.group.traverse((c) => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) {
          const ms = Array.isArray(c.material) ? c.material : [c.material];
          ms.forEach((m) => m.dispose());
        }
      });
      statusFlourish = null;
    } else {
      const ringScale = 0.05 + u * 1.4; // expand outward
      statusFlourish.ring.scale.setScalar(ringScale);
      statusFlourish.ring.material.opacity = 0.9 * (1 - u);
      // Sparks drift up (fixed) or fall (broken).
      const sparks = statusFlourish.sparks;
      const dirSign = sparks.userData.dirSign || 1;
      const speed = (statusFlourish.kind === "broken" ? 40 : 24) * dt * dirSign;
      const posAttr = sparks.geometry.attributes.position;
      for (let i = 0; i < posAttr.count; i++) {
        posAttr.array[i * 3 + 1] += speed;
      }
      posAttr.needsUpdate = true;
      sparks.material.opacity = 0.95 * (1 - u * u);
    }
  }

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

// ============================================================
//  Holographic Assessment Principle — 3D renderer
// ============================================================
// Independent scene/renderer pipeline so the 3D holographic view stays
// distinct from the AWS "city" 3D view above. Mounts on its own canvas
// inside #stage-holo when init() is called.

const HOLO_STATUS_COLOR = {
  pass: 0x22c55e,
  fail: 0xef4444,
  "partial-fail": 0xf97316,
  pending: 0xa3a3a3,
  unknown: 0x6b7280,
};
const HOLO_SEVERITY_RADIUS = {
  critical: 1.5,
  high: 1.2,
  medium: 0.9,
  low: 0.6,
  info: 0.4,
};

const holo = {
  initialized: false,
  scene: null,
  camera: null,
  renderer: null,
  group: null,
  labels: [],
  container: null,
  raf: null,
  rotate: true,
  drag: { active: false, x: 0, y: 0, rotX: 0.0, rotY: 0.0 },
  state: { level: 0, holonicId: null, holonId: null },
  boundary: null,
  pulseMesh: null,
  starfield: null,
  hoverPause: false,
  raycaster: null,
  pointer: null,
  clickables: new Map(),
};

/**
 * Initialise the holographic 3D scene inside a container element.
 * Safe to call multiple times — re-init is a no-op.
 * @param {HTMLElement} container
 */
function holoInit(container) {
  if (holo.initialized) return;
  holo.container = container;
  holo.scene = new THREE.Scene();
  holo.scene.background = new THREE.Color(0x0a0a0f);
  holo.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  // Slight bird's-eye angle so the ring of spheres sits in the middle of
  // the viewport rather than dropping to the bottom edge.
  holo.camera.position.set(0, 14, 26);
  holo.camera.lookAt(0, 0, 0);
  holo.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  holo.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  container.appendChild(holo.renderer.domElement);

  holo.group = new THREE.Group();
  holo.scene.add(holo.group);

  const ambient = new THREE.AmbientLight(0xb6c8ff, 1.0);
  holo.scene.add(ambient);
  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(10, 22, 12);
  holo.scene.add(dir);
  const rim = new THREE.PointLight(0x88aaff, 1.6, 220);
  rim.position.set(-12, 10, -10);
  holo.scene.add(rim);
  const fill = new THREE.PointLight(0xffd6a3, 0.8, 200);
  fill.position.set(14, -2, 14);
  holo.scene.add(fill);

  holo.starfield = makeStarfield(2000);
  holo.scene.add(holo.starfield);

  holo.raycaster = new THREE.Raycaster();
  holo.pointer = new THREE.Vector2();

  attachHoloPointer();
  holoResize();
  const ro = new ResizeObserver(() => holoResize());
  ro.observe(container);

  holo.initialized = true;
  holoAnimate();
}

/**
 * Build a particle starfield by allocating random 3D points on a unit sphere.
 * @param {number} count
 * @returns {THREE.Points}
 */
function makeStarfield(count) {
  const geom = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1;
    const t = Math.random() * Math.PI * 2;
    const r = 320 + Math.random() * 60;
    const s = Math.sqrt(1 - u * u);
    positions[i * 3] = r * s * Math.cos(t);
    positions[i * 3 + 1] = r * u;
    positions[i * 3 + 2] = r * s * Math.sin(t);
  }
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xddddff,
    size: 0.6,
    transparent: true,
    opacity: 0.75,
    sizeAttenuation: true,
  });
  return new THREE.Points(geom, mat);
}

/**
 * Resize the holographic renderer to its container's current size.
 */
function holoResize() {
  if (!holo.container || !holo.renderer || !holo.camera) return;
  const w = holo.container.clientWidth || 800;
  const h = holo.container.clientHeight || 600;
  holo.camera.aspect = w / h;
  holo.camera.updateProjectionMatrix();
  holo.renderer.setSize(w, h, false);
}

/**
 * Bind manual drag-to-rotate, click-to-select, and hover pause to the canvas.
 * Replaces OrbitControls (which is unavailable in this Three.js build for
 * holographic mode by design).
 */
function attachHoloPointer() {
  const dom = holo.renderer.domElement;
  dom.addEventListener("mousedown", (e) => {
    holo.drag.active = true;
    holo.drag.x = e.clientX;
    holo.drag.y = e.clientY;
  });
  window.addEventListener("mouseup", () => { holo.drag.active = false; });
  window.addEventListener("mousemove", (e) => {
    if (!holo.drag.active) return;
    const dx = e.clientX - holo.drag.x;
    const dy = e.clientY - holo.drag.y;
    holo.drag.rotY += dx * 0.005;
    holo.drag.rotX = Math.max(-1.1, Math.min(1.1, holo.drag.rotX + dy * 0.005));
    holo.drag.x = e.clientX;
    holo.drag.y = e.clientY;
  });
  dom.addEventListener("wheel", (e) => {
    e.preventDefault();
    const z = holo.camera.position.length();
    const next = Math.max(10, Math.min(120, z + e.deltaY * 0.05));
    holo.camera.position.setLength(next);
    holo.camera.lookAt(0, 0, 0);
  }, { passive: false });
  dom.addEventListener("mouseenter", () => { holo.hoverPause = true; });
  dom.addEventListener("mouseleave", () => { holo.hoverPause = false; });
  dom.addEventListener("click", onHoloClick);
}

/**
 * Map a click to the topmost clickable mesh (holonic sphere or holon node).
 * Dispatches the corresponding navigation.
 * @param {MouseEvent} ev
 */
function onHoloClick(ev) {
  const rect = holo.renderer.domElement.getBoundingClientRect();
  holo.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  holo.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  holo.raycaster.setFromCamera(holo.pointer, holo.camera);
  const meshes = [];
  holo.clickables.forEach((entry) => { if (entry.mesh) meshes.push(entry.mesh); });
  const hits = holo.raycaster.intersectObjects(meshes, false);
  if (!hits.length) return;
  const top = hits[0].object;
  const id = top.userData && top.userData.holoId;
  const kind = top.userData && top.userData.holoKind;
  if (!id) return;
  if (kind === "holonic") holoNavigate(1, id, null);
  else if (kind === "holon") holoNavigate(2, holo.state.holonicId, id);
}

/**
 * Run the holographic animation loop. Rotates the cluster on load, pauses
 * on hover, and pulses the selected holon at Level 2.
 */
function holoAnimate() {
  if (!holo.initialized) return;
  const now = performance.now();
  if (holo.rotate && !holo.hoverPause && holo.state.level === 0) {
    holo.drag.rotY += 0.0025;
  }
  // Keep the ring framed in the viewport even after wheel-zoom or drag.
  holo.camera.lookAt(0, 0, 0);
  holo.group.rotation.x = holo.drag.rotX;
  holo.group.rotation.y = holo.drag.rotY;
  if (holo.pulseMesh) {
    const s = 1.0 + 0.075 * Math.sin(now / 380);
    holo.pulseMesh.scale.setScalar(s);
  }
  if (holo.starfield) holo.starfield.rotation.y += 0.0003;
  updateHoloLabels();
  holo.renderer.render(holo.scene, holo.camera);
  holo.raf = requestAnimationFrame(holoAnimate);
}

/**
 * Project each tracked label's world position to screen coords and move the
 * floating <div> element to match. Hidden if behind the camera.
 */
function updateHoloLabels() {
  if (!holo.container) return;
  const rect = holo.container.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  holo.labels.forEach((entry) => {
    const v = entry.position.clone().applyMatrix4(holo.group.matrixWorld);
    v.project(holo.camera);
    const inFront = v.z < 1;
    if (!inFront) {
      entry.el.style.display = "none";
      return;
    }
    entry.el.style.display = "";
    const x = (v.x * 0.5 + 0.5) * w;
    const y = (1 - (v.y * 0.5 + 0.5)) * h;
    entry.el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
  });
}

/**
 * Clear the holographic scene so the next render starts from empty state.
 */
function holoClear() {
  if (!holo.group) return;
  while (holo.group.children.length) {
    const o = holo.group.children[0];
    holo.group.remove(o);
    o.traverse((c) => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        const ms = Array.isArray(c.material) ? c.material : [c.material];
        ms.forEach((m) => m.dispose());
      }
    });
  }
  holo.clickables.clear();
  holo.labels.forEach((l) => l.el.remove());
  holo.labels = [];
  holo.pulseMesh = null;
}

/**
 * Add a floating HTML label that follows a world-space position via the
 * animation loop's projection.
 * @param {string} text
 * @param {THREE.Vector3} position
 * @returns {HTMLElement}
 */
function addHoloLabel(text, position) {
  const el = document.createElement("div");
  el.className = "holo-label";
  el.textContent = text;
  el.style.position = "absolute";
  el.style.pointerEvents = "none";
  holo.container.appendChild(el);
  holo.labels.push({ el, position: position.clone() });
  return el;
}

/**
 * Level 0 — every holonic as a translucent sphere arranged in a circle.
 * @param {object} boundaryData
 */
function renderHoloLevel0(boundaryData) {
  holo.state = { level: 0, holonicId: null, holonId: null };
  holo.boundary = boundaryData;
  holoClear();
  const holonics = boundaryData.holonics || [];
  const n = Math.max(1, holonics.length);
  const ringR = Math.max(9, 5 + n * 1.6);
  holonics.forEach((hc, i) => {
    const a = (2 * Math.PI * i) / n - Math.PI / 2;
    const x = Math.cos(a) * ringR;
    const z = Math.sin(a) * ringR;
    const radius = 3.6;
    const color = HOLO_STATUS_COLOR[hc.aggregateStatus] || HOLO_STATUS_COLOR.unknown;
    // Solid core gives the sphere a clear silhouette against the dark sky.
    const coreGeom = new THREE.SphereGeometry(radius * 0.78, 32, 24);
    const coreMat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.9,
      roughness: 0.35,
      metalness: 0.1,
    });
    const core = new THREE.Mesh(coreGeom, coreMat);
    core.position.set(x, 0, z);
    core.userData = { holoId: hc.id, holoKind: "holonic" };
    holo.group.add(core);
    // Halo shell adds the "translucent boundary" feel without losing the
    // core's contrast.
    const haloGeom = new THREE.SphereGeometry(radius, 32, 24);
    const haloMat = new THREE.MeshStandardMaterial({
      color,
      transparent: true,
      opacity: 0.32,
      emissive: color,
      emissiveIntensity: 0.55,
      roughness: 0.5,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    const halo = new THREE.Mesh(haloGeom, haloMat);
    halo.position.set(x, 0, z);
    halo.userData = { holoId: hc.id, holoKind: "holonic" };
    holo.group.add(halo);
    holo.clickables.set(hc.id, { mesh: core });
    addHoloLabel(
      `${hc.label} · ${Math.round(hc.aggregateScore || 0)}/100`,
      new THREE.Vector3(x, radius + 2.4, z),
    );
  });
}

/**
 * Level 1 — expand a single holonic and render its holons as solid spheres
 * sized by severity inside a translucent boundary sphere.
 * @param {string} holonicId
 * @param {object} boundaryData
 */
function renderHoloLevel1(holonicId, boundaryData) {
  holo.state = { level: 1, holonicId, holonId: null };
  holo.boundary = boundaryData;
  holoClear();
  const hc = (boundaryData.holonics || []).find((x) => x.id === holonicId);
  if (!hc) return;
  const boundaryR = 10;
  const boundaryColor = HOLO_STATUS_COLOR[hc.aggregateStatus] || HOLO_STATUS_COLOR.unknown;

  const shellGeom = new THREE.SphereGeometry(boundaryR, 48, 32);
  const shellMat = new THREE.MeshStandardMaterial({
    color: boundaryColor,
    transparent: true,
    opacity: 0.08,
    emissive: boundaryColor,
    emissiveIntensity: 0.15,
    side: THREE.DoubleSide,
    roughness: 0.3,
    metalness: 0.0,
  });
  const shell = new THREE.Mesh(shellGeom, shellMat);
  holo.group.add(shell);
  addHoloLabel(`${hc.label} · ${Math.round(hc.aggregateScore || 0)}/100`,
    new THREE.Vector3(0, boundaryR + 2, 0));

  const lookup = buildHoloLookup(boundaryData);
  const holons = (hc.holons || []).map((id) => lookup.get(id)).filter(Boolean);
  const positions = fibSphere(holons.length, boundaryR * 0.65);
  holons.forEach((holon, i) => addHoloHolon(holon, positions[i]));
  drawHoloTargetEdges(holons, positions);
}

/**
 * Place N points on a sphere using the Fibonacci lattice for even spread.
 * @param {number} n
 * @param {number} r
 * @returns {THREE.Vector3[]}
 */
function fibSphere(n, r) {
  const out = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  const safe = Math.max(1, n);
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (safe - 1 || 1)) * 2;
    const radius = Math.sqrt(1 - y * y);
    const theta = phi * i;
    out.push(new THREE.Vector3(
      Math.cos(theta) * radius * r,
      y * r,
      Math.sin(theta) * radius * r,
    ));
  }
  return out;
}

/**
 * Add a solid sphere for a single holon, sized by severity and coloured by
 * status, with a floating label.
 * @param {object} holon
 * @param {THREE.Vector3} pos
 */
function addHoloHolon(holon, pos) {
  const radius = HOLO_SEVERITY_RADIUS[holon.severity] || 0.6;
  const color = HOLO_STATUS_COLOR[holon.status] || HOLO_STATUS_COLOR.unknown;
  const geom = new THREE.SphereGeometry(radius, 24, 18);
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.6,
    roughness: 0.35,
    metalness: 0.1,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.copy(pos);
  mesh.userData = { holoId: holon.id, holoKind: "holon" };
  holo.group.add(mesh);
  holo.clickables.set(holon.id, { mesh });
  if (holon.label) {
    addHoloLabel(holon.label, pos.clone().add(new THREE.Vector3(0, radius + 0.6, 0)));
  }
}

/**
 * Draw glowing emissive lines between holons that share the same `target`.
 * @param {Array<object>} holons
 * @param {THREE.Vector3[]} positions
 */
function drawHoloTargetEdges(holons, positions) {
  const byTarget = new Map();
  holons.forEach((h, i) => {
    if (!h.target) return;
    const arr = byTarget.get(h.target) || [];
    arr.push(i);
    byTarget.set(h.target, arr);
  });
  byTarget.forEach((arr) => {
    if (arr.length < 2) return;
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const geom = new THREE.BufferGeometry().setFromPoints([
          positions[arr[i]], positions[arr[j]],
        ]);
        const mat = new THREE.LineBasicMaterial({
          color: 0x58a6ff,
          transparent: true,
          opacity: 0.55,
        });
        holo.group.add(new THREE.Line(geom, mat));
      }
    }
  });
}

/**
 * Index every holon in the boundary (loose + referenced) for O(1) lookups.
 * @param {object} boundaryData
 * @returns {Map<string,object>}
 */
function buildHoloLookup(boundaryData) {
  const m = new Map();
  (boundaryData.loose_holons || []).forEach((h) => m.set(h.id, h));
  return m;
}

/**
 * Level 2 — fade everything except the selected holon, then pulse it with
 * a slow breathing animation. The detail panel is opened by app.js.
 * @param {string} holonId
 * @param {object} boundaryData
 */
function renderHoloLevel2(holonId, boundaryData) {
  if (!holo.state.holonicId) {
    const owning = (boundaryData.holonics || []).find((hc) => (hc.holons || []).includes(holonId));
    if (owning) holo.state.holonicId = owning.id;
  }
  if (holo.state.holonicId) renderHoloLevel1(holo.state.holonicId, boundaryData);
  holo.state = { level: 2, holonicId: holo.state.holonicId, holonId };
  holo.group.traverse((c) => {
    if (!c.isMesh) return;
    const isTarget = c.userData && c.userData.holoId === holonId;
    if (c.material && "opacity" in c.material) {
      c.material.transparent = true;
      c.material.opacity = isTarget ? 1.0 : 0.1;
    }
    if (isTarget) holo.pulseMesh = c;
  });
}

/**
 * Navigate the holographic 3D view between zoom levels.
 * @param {0|1|2} level
 * @param {string|null} holonicId
 * @param {string|null} holonId
 */
function holoNavigate(level, holonicId, holonId) {
  holo.pulseMesh = null;
  if (!holo.boundary) return;
  if (level === 0) renderHoloLevel0(holo.boundary);
  else if (level === 1) renderHoloLevel1(holonicId, holo.boundary);
  else renderHoloLevel2(holonId, holo.boundary);
  if (window.AwsHoloViz3D.onLevelChange) {
    window.AwsHoloViz3D.onLevelChange(level, holonicId, holonId);
  }
  if (level === 2 && window.AwsHoloViz3D.onSelectHolon) {
    const found = buildHoloLookup(holo.boundary).get(holonId);
    if (found) window.AwsHoloViz3D.onSelectHolon(found);
  }
}

/**
 * Render the boundary at whatever holographic state we're currently in.
 * @param {object} boundaryData
 */
function holoRender(boundaryData) {
  holo.boundary = boundaryData;
  if (holo.state.level === 2 && holo.state.holonId) {
    renderHoloLevel2(holo.state.holonId, boundaryData);
  } else if (holo.state.level === 1 && holo.state.holonicId) {
    renderHoloLevel1(holo.state.holonicId, boundaryData);
  } else {
    renderHoloLevel0(boundaryData);
  }
}

window.AwsHoloViz3D = {
  init: holoInit,
  render: holoRender,
  navigate: holoNavigate,
  renderHolonicControlView: renderHoloLevel0,
  renderHolonicView: renderHoloLevel1,
  renderHolonDetailView: renderHoloLevel2,
  isReady: () => holo.initialized,
  getState: () => ({ ...holo.state }),
  onLevelChange: null,
  onSelectHolon: null,
};

