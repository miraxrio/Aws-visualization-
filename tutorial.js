// Interactive onboarding tutorial.
//
// Dims the whole page except a spotlight cut‑out over a target element,
// frames that target with a glowing ring, and narrates each step with a
// presenter + speech bubble. Narration plays a pre‑recorded clip when one is
// present (assets/tutorial/line-N.<ext>) and otherwise falls back to the
// browser's text‑to‑speech (shared window.AwsSpeak from tour.js).
//
// This is intentionally separate from the network "tour" (tour.js / AwsTour),
// which walks a *loaded topology*. This tutorial teaches the app itself and
// works on a fresh load with nothing imported.

(function () {
  "use strict";

  // --- Steps -----------------------------------------------------------
  // Add more entries to extend the walkthrough. `advanceOn: "target"` means
  // the step is completed by clicking the highlighted element.
  const STEPS = [
    {
      target: "#zb-account-btn",
      // Your recording. Looked for in assets/tutorial/ first, then the site
      // root — so "line 1.mp3" works whether it sits beside index.html or
      // under assets/tutorial/. Falls back to text-to-speech if not found.
      audioBases: ["assets/tutorial/line 1", "line 1"],
      // Shown in the bubble (\n becomes a line break).
      text:
        "Welcome to the AuditCrowd visualization site. I'll explain the basics of this tool.\n" +
        "To start, you need to log in to your ZeroBias account so you can interact with your data here.\n" +
        "Press Connect to ZeroBias.",
      // What text‑to‑speech reads when no audio clip is found.
      speech:
        "Welcome to the audit crowd visualization site, I'll explain the basics of this tool. " +
        "To start you need to login into your zero bias account so you can interact with your data here. " +
        "Press Connect to Zero Bias.",
      cta: "Click “Connect ZeroBias” to continue",
      advanceOn: "target",
    },
    {
      target: "#zb-demo-btn",
      audioBases: ["assets/tutorial/line 2", "line 2"],
      text:
        "Here you can enter your ZeroBias credentials.\n" +
        "But for this demo, click “Continue with demo data”.",
      speech:
        "Here you can put your Zero Bias credentials, but for this demo, click on Continue with demo data.",
      cta: "Click “Continue with demo data”",
      advanceOn: "target",
    },
    {
      // Frame the whole task board. It renders asynchronously after the demo
      // data loads, so wait for a task card to appear before spotlighting the
      // board area (.zb-board-scroll is clipped to the visible board, so it
      // doesn't bleed into the sidebar the way the overflowing grid would).
      target: ".zb-board-scroll",
      waitFor: ".zb-card",
      audioBases: ["assets/tutorial/line 3", "line 3"],
      text:
        "Now you can see the sample data — these are your tasks.\n" +
        "Each task has a reward value. Once you complete a task, submit it to review and get paid.",
      speech:
        "Now you can see the sample data. Here you will see your tasks. Each task has a reward value. " +
        "Once you complete that task, submit it to review and get paid.",
    },
    {
      // Opportunities sit below the board grid — wait for it, then scroll it in.
      target: ".zb-opps",
      waitFor: true,
      scrollIntoView: true,
      audioBases: ["assets/tutorial/line 4", "line 4"],
      text:
        "Scroll down to the Opportunities menu.\n" +
        "Here you can see posted bids that match your profile.",
      speech:
        "Scroll down and you will see the opportunities menu. Here you can see posted bids that match your profile.",
    },
    {
      target: "#mode-2d",
      audioBases: ["assets/tutorial/line 5", "line 5"],
      text: "Now click the 2D button to switch to the basic Network View.",
      speech: "Now click on the 2D button to switch to the basic Network View.",
      cta: "Click “2D”",
      advanceOn: "target",
    },
    {
      // Load the deterministic sample network (which carries a version timeline)
      // so the 2D view, the 3D view and the tour all show the same known topology.
      target: "#diagram",
      loadNetwork: "sample-network.json",
      audioBases: ["assets/tutorial/line 6", "line 6"],
      text:
        "Here is the 2D view of the sample network.\n" +
        "It shows how the different elements connect and interact with each other.",
      speech:
        "Here is the 2D view of the sample network. It shows you how the different elements connect and interact with each other.",
    },
    {
      target: "#mode-3d",
      audioBases: ["assets/tutorial/line 7", "line 7"],
      text: "Now let's move to the Holographic view.",
      speech: "Now let's move to the Holographic view.",
      cta: "Click “Holographic View”",
      advanceOn: "target",
    },
    {
      target: "#stage-3d",
      waitFor: true,
      audioBases: ["assets/tutorial/line 8", "line 8"],
      text:
        "In the holographic view you can see your network rendered in 3D.\n" +
        "Right‑click to move, hold left‑click to rotate, and use the mouse wheel to zoom.",
      speech:
        "In the holographic view you can see your network rendered in 3D. Use right click to move, " +
        "hold left click to rotate, and use the mouse wheel to zoom in and out.",
    },
    {
      target: "#start-tour",
      audioBases: ["assets/tutorial/line 9", "line 9"],
      text: "Press Start tour, and I'll explain every component of this network to you.",
      speech: "Press Start tour, and I'll explain every component of this network to you.",
      cta: "Click “Start tour”",
      advanceOn: "target",
      // Hide the tutorial while the network tour runs; resume with the next
      // step once the tour bar closes.
      resumeAfterTour: true,
    },

    // --- The security-system timeline walk --------------------------------
    // Steps 11–16 scrub through the network's recorded versions one by one
    // (selectVersion is silent so the app's own generated narration doesn't
    // talk over these clips). Each step auto-advances when its clip ends.
    // The walk plays over the holographic view with the network left fully
    // visible (dim: false — ring only), and the presenter docked on the left
    // so she doesn't cover the timeline she's narrating.
    {
      targets: ["#boundary-panel", "#timeline-panel"],
      onEnter: () => { if (window.AwsMode && window.AwsMode.set) window.AwsMode.set("3d"); },
      dim: false,
      stageSide: "left",
      scrollIntoView: true,
      scrollBlock: "start",
      audioBases: ["assets/tutorial/line 10", "line 10"],
      text:
        "Now let's review the security system timeline.\n" +
        "Every change to this network was recorded here — who made it, when, and whether it left the system healthy.",
      speech:
        "Now let's review the security system timeline. Every change to this network is recorded here — " +
        "who made it, when, and whether it left the system healthy. Let's walk through it together.",
      autoAdvance: true,
    },
    {
      target: '.version-item[data-version-id="v1"]',
      onEnter: () => { if (window.AwsApp && window.AwsApp.selectVersion) window.AwsApp.selectVersion("v1", { silent: true }); },
      dim: false,
      stageSide: "left",
      scrollIntoView: true,
      audioBases: ["assets/tutorial/line 11", "line 11"],
      text:
        "Jan 15 — Alice's initial three-tier deployment.\n" +
        "Load balancer, app tasks in two zones, Aurora underneath. All green.",
      speech:
        "The story opens on January fifteenth, with Alice's original deployment: a load balancer out front, " +
        "application tasks spread across two availability zones, and an Aurora database underneath. " +
        "Clean, production ready, and green across the board.",
      autoAdvance: true,
    },
    {
      target: '.version-item[data-version-id="v2"]',
      onEnter: () => { if (window.AwsApp && window.AwsApp.selectVersion) window.AwsApp.selectVersion("v2", { silent: true }); },
      dim: false,
      stageSide: "left",
      scrollIntoView: true,
      audioBases: ["assets/tutorial/line 12", "line 12"],
      text:
        "Feb 3 — the red dot. Bob expanded into a third zone but forgot its NAT gateway.\n" +
        "Webhooks timed out, and zone 1c depended on 1a for its internet access.",
      speech:
        "Then February third — the red dot. Bob expanded the network into a third availability zone, " +
        "but he forgot to give the new zone its own NAT gateway. Its traffic had to borrow the NAT in zone one A, " +
        "so webhook calls started timing out, every request paid a cross-zone toll, and if zone one A ever went down, " +
        "the new zone would lose the internet completely. This one was on Bob.",
      autoAdvance: true,
    },
    {
      target: '.version-item[data-version-id="v3"]',
      onEnter: () => { if (window.AwsApp && window.AwsApp.selectVersion) window.AwsApp.selectVersion("v3", { silent: true }); },
      dim: false,
      stageSide: "left",
      scrollIntoView: true,
      audioBases: ["assets/tutorial/line 13", "line 13"],
      text:
        "Feb 4 — Alice shipped the fix the very next morning:\n" +
        "a proper NAT gateway inside 1c, with the route table pointed at it.",
      speech:
        "The very next morning, Alice shipped the fix. She provisioned a proper NAT gateway inside the new zone, " +
        "gave it its own elastic IP, and repointed the route table to it. Webhooks recovered on the spot, " +
        "the extra transfer charges vanished, and the zone could finally stand on its own.",
      autoAdvance: true,
    },
    {
      target: '.version-item[data-version-id="v4"]',
      onEnter: () => { if (window.AwsApp && window.AwsApp.selectVersion) window.AwsApp.selectVersion("v4", { silent: true }); },
      dim: false,
      stageSide: "left",
      scrollIntoView: true,
      audioBases: ["assets/tutorial/line 14", "line 14"],
      text:
        "Mar 12 — Carol added a search service and a Redis cache.\n" +
        "Reads got faster, and Aurora got a break.",
      speech:
        "On March twelfth, Carol added some muscle: a dedicated search service backed by OpenSearch, " +
        "plus a Redis cache sitting in front of the database. Reads got noticeably faster, " +
        "and Aurora finally caught its breath.",
      autoAdvance: true,
    },
    {
      target: '.version-item[data-version-id="v5"]',
      onEnter: () => { if (window.AwsApp && window.AwsApp.selectVersion) window.AwsApp.selectVersion("v5", { silent: true }); },
      dim: false,
      stageSide: "left",
      scrollIntoView: true,
      audioBases: ["assets/tutorial/line 15", "line 15"],
      text:
        "Apr 5 — Bob retired the webhook Lambda.\n" +
        "CloudFront now fronts the site, and partners get their own API gateway.",
      speech:
        "In early April, Bob made up for the earlier slip. He retired the aging webhook Lambda, " +
        "put a CloudFront edge in front of the whole site, and gave partners a dedicated API gateway " +
        "for their integrations.",
      autoAdvance: true,
    },
    {
      target: '.version-item[data-version-id="v6"]',
      onEnter: () => { if (window.AwsApp && window.AwsApp.selectVersion) window.AwsApp.selectVersion("v6", { silent: true }); },
      dim: false,
      stageSide: "left",
      scrollIntoView: true,
      audioBases: ["assets/tutorial/line 16", "line 16"],
      text:
        "May 1 — audit storage and a session store, ready for SOC 2.\n" +
        "Heads-up: the WAF is out for maintenance right now.\n" +
        "That's the full history — one bad day in February, fixed within 24 hours.",
      speech:
        "Finally, on the first of May, Carol prepared the network for its audit: a storage bucket for " +
        "compliance evidence, and a dedicated session store so the app servers no longer need sticky sessions. " +
        "One heads-up — the web application firewall is temporarily out while its rules are rewritten. " +
        "And that's the whole story: six versions, one bad day in February, and a fix that landed " +
        "within twenty-four hours.",
      autoAdvance: true,
    },

    // --- Builder & attack-simulation chapter -------------------------------
    {
      target: "#builder-btn",
      onEnter: () => { if (window.AwsMode && window.AwsMode.set) window.AwsMode.set("2d"); },
      audioBases: ["assets/tutorial/line 17", "line 17"],
      text:
        "You can also edit your network.\n" +
        "Press Builder to enter the edit mode.",
      speech: "You can also edit your networks. Press Builder to enter the edit mode.",
      cta: "Click “Builder”",
      advanceOn: "target",
    },
    {
      // The inventory drawer opens on the left; leave the page undimmed so the
      // drag from the drawer onto a subnet actually works during the step.
      target: "#builder-drawer",
      waitFor: true,
      dim: false,
      audioBases: ["assets/tutorial/line 18", "line 18"],
      text:
        "Drag an element from the inventory onto a subnet.\n" +
        "Watch how it wires into the rest of the network.",
      speech:
        "Now drag an element from the inventory and drop it into a subnet, " +
        "then watch how it connects and interacts with the rest of the network.",
      cta: "Try a drag, then press Next",
    },
    {
      target: "#mode-3d",
      audioBases: ["assets/tutorial/line 19", "line 19"],
      text:
        "Your changes in the 2D view also appear in the 3D holographic view.\n" +
        "Click Holographic View to see them.",
      speech:
        "By the way, your changes in the 2D view also appear in the 3D holographic view. " +
        "Let's switch over and take a look.",
      cta: "Click “Holographic View”",
      advanceOn: "target",
    },
    {
      // The Simulate-attack button only exists in the 3D view — wait for it.
      target: "#attack-btn",
      waitFor: true,
      audioBases: ["assets/tutorial/line 20", "line 20"],
      text:
        "Good — now let's watch a simulation of a cyber attack.\n" +
        "Press Simulate attack.",
      speech: "Good. Now let's watch a simulation of a cyber attack. Press Simulate attack.",
      cta: "Click “Simulate attack”",
      advanceOn: "target",
    },
    {
      // The scenario picker fills in when the modal opens; clicking the DDoS
      // card starts the simulation. The tutorial hides while the attack plays
      // and resumes once its summary is dismissed.
      target: '.attack-card[data-attack="ddos"]',
      waitFor: true,
      audioBases: ["assets/tutorial/line 21", "line 21"],
      text:
        "Here's a list of cyber attacks you can simulate against your network.\n" +
        "Let's try the DDoS flood.",
      speech:
        "Here you have a list of cyber attacks to simulate against your network. " +
        "Let's try the DDoS volumetric flood.",
      cta: "Click “DDoS Volumetric Flood”",
      advanceOn: "target",
      resumeAfterAttack: true,
    },

    // --- Explore mode & the holons view ------------------------------------
    {
      target: "#explore-btn",
      waitFor: true,
      onEnter: () => { if (window.AwsMode && window.AwsMode.set) window.AwsMode.set("3d"); },
      audioBases: ["assets/tutorial/line 22", "line 22"],
      text:
        "Want to get closer? Explore mode drops you inside the network, in first person.\n" +
        "Use the arrow keys on your keyboard to walk around and wander between your services.",
      speech:
        "Want to get closer? Explore mode drops you right inside the network, in first person. " +
        "Just use the arrow keys on your keyboard to walk around and wander between your services, " +
        "like rooms in a building.",
      cta: "Click “Explore”, walk around — press Esc to come back",
      advanceOn: "target",
      resumeAfterExplore: true,
    },
    {
      target: "#load-boundary",
      audioBases: ["assets/tutorial/line 23", "line 23"],
      text:
        "Now press Load boundary to open the holons view —\n" +
        "a living map of your system, organised into layers.",
      speech:
        "Now press Load boundary to enter the holons view — a living map of your whole system, " +
        "organised into layers, from the big picture right down to the smallest part.",
      cta: "Click “Load boundary”",
      advanceOn: "target",
    },
    // The layer walk uses the holons view's real zoom hierarchy — biggest to
    // smallest: the whole boundary → into one cluster → down to a single
    // control. The 3D scene itself is the subject, so there's no spotlight
    // target: keep it fully visible (dim:false) with the presenter docked left.
    // The assembly-level pill bar is hidden for this chapter (drilling in is
    // the clearer mechanism); it's restored when the tutorial ends.
    {
      onEnter: () => { hideAsmBar(); holoNav(0, null, null); },
      dim: false,
      stageSide: "left",
      audioBases: ["assets/tutorial/line 24", "line 24"],
      text:
        "We start at the top — the whole boundary.\n" +
        "Every control in your system lives in here, gathered into these glowing clusters.",
      speech:
        "We start at the very top, with the whole boundary. Every control in your system lives in here, " +
        "gathered into these glowing clusters. This is the big picture — your entire system at a glance.",
      autoAdvance: true,
    },
    {
      onEnter: () => holoNav(1, "holonic-checkout-service", null),
      dim: false,
      stageSide: "left",
      audioBases: ["assets/tutorial/line 25", "line 25"],
      text:
        "Now we zoom into one cluster.\n" +
        "Watch it open up — inside, each individual control orbits the core.",
      speech:
        "Now let's zoom into one of those clusters. Watch it open up: inside, each individual control " +
        "orbits its core, so you can see exactly what this part of the system is made of.",
      autoAdvance: true,
    },
    {
      onEnter: () => holoNav(2, "holonic-checkout-service", "cve-vm-kernel-2026-0142"),
      dim: false,
      stageSide: "left",
      audioBases: ["assets/tutorial/line 26", "line 26"],
      text:
        "And we zoom in one last time, onto a single control.\n" +
        "The smallest piece — one check, with its status and full detail.",
      speech:
        "And we zoom in one last time, onto a single control. This is the smallest piece of all: " +
        "one check, with its status and every detail laid out. From the whole system, all the way down " +
        "to a single item. That's the tour — enjoy exploring.",
    },
  ];

  const PAD = 8;                  // spotlight padding around the target (px)
  const AUDIO_EXTS = [".mp3", ".m4a", ".wav", ".ogg"];
  // Your presenter.png is preferred (assets/tutorial/ then site root); the
  // bundled illustration is the final fallback.
  const PRESENTER_SRCS = ["assets/tutorial/presenter.png", "presenter.png", "assets/tutorial/presenter.svg"];
  const SEEN_KEY = "aws-viz.tutorial.seen";

  // Named sections for the jump-to menu. `step` is the 0-based index the
  // section starts at; `setup` prepares app state so the section works when
  // jumped to directly (load the sample network, switch view, connect demo…).
  const SECTIONS = [
    { label: "Connect to ZeroBias", step: 0, setup: () => zbCloseModal() },
    { label: "Your task board", step: 2, setup: () => zbConnectDemo() },
    { label: "Network views · 2D & 3D", step: 5, setup: () => { loadSampleNet(); setViewMode("2d"); } },
    { label: "Security-system timeline", step: 9, setup: () => { loadSampleNet(); setViewMode("3d"); } },
    { label: "Edit with the Builder", step: 16, setup: () => { loadSampleNet(); setViewMode("2d"); } },
    { label: "Cyber-attack simulation", step: 19, setup: () => { loadSampleNet(); setViewMode("3d"); } },
    { label: "Explore & the holons view", step: 21, setup: () => { loadSampleNet(); setViewMode("3d"); } },
  ];

  let root, masks, ring, stage, bubble, textEl, ctaEl, nextBtn, replayBtn, presenter, presenterImg;
  let sectionsBtn, sectionsMenu, secLabel;
  let built = false;
  let active = false;
  let suspended = false;          // hidden while the network tour runs
  let index = 0;
  let showSeq = 0;
  let currentTarget = null;
  let currentAudio = null;
  let targetHandler = null;
  let targetHandlerEl = null;

  // --- DOM --------------------------------------------------------------

  function build() {
    if (built) return;
    built = true;

    root = document.createElement("div");
    root.className = "tut-root";
    root.hidden = true;
    root.innerHTML =
      '<div class="tut-mask tut-mask-top"></div>' +
      '<div class="tut-mask tut-mask-bottom"></div>' +
      '<div class="tut-mask tut-mask-left"></div>' +
      '<div class="tut-mask tut-mask-right"></div>' +
      '<div class="tut-ring" aria-hidden="true"></div>' +
      '<div class="tut-stage">' +
      '  <div class="tut-bubble" role="dialog" aria-live="polite" aria-label="Tutorial">' +
      '    <button class="tut-close" type="button" title="Skip tutorial" aria-label="Skip tutorial">✕</button>' +
      '    <p class="tut-text"></p>' +
      '    <div class="tut-cta"></div>' +
      '    <div class="tut-foot">' +
      '      <button class="tut-replay" type="button" title="Replay narration" aria-label="Replay narration">' +
      '        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54z"/></svg>' +
      '        <span>Replay</span>' +
      '      </button>' +
      '      <div class="tut-sections">' +
      '        <button class="tut-sections-btn" type="button" aria-haspopup="true" aria-expanded="false" title="Jump to a section">' +
      '          <span class="tut-sec-label"></span>' +
      '          <svg class="tut-sec-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5z"/></svg>' +
      '        </button>' +
      '        <div class="tut-sections-menu" role="menu" hidden></div>' +
      '      </div>' +
      '      <button class="tut-next" type="button">Next ›</button>' +
      '    </div>' +
      '    <span class="tut-tail"></span>' +
      '  </div>' +
      '  <div class="tut-presenter">' +
      '    <img class="tut-presenter-img" alt="AuditCrowd guide" />' +
      '  </div>' +
      "</div>";
    document.body.appendChild(root);

    masks = {
      top: root.querySelector(".tut-mask-top"),
      bottom: root.querySelector(".tut-mask-bottom"),
      left: root.querySelector(".tut-mask-left"),
      right: root.querySelector(".tut-mask-right"),
    };
    ring = root.querySelector(".tut-ring");
    stage = root.querySelector(".tut-stage");
    bubble = root.querySelector(".tut-bubble");
    textEl = root.querySelector(".tut-text");
    ctaEl = root.querySelector(".tut-cta");
    nextBtn = root.querySelector(".tut-next");
    replayBtn = root.querySelector(".tut-replay");
    presenter = root.querySelector(".tut-presenter");
    presenterImg = root.querySelector(".tut-presenter-img");
    sectionsBtn = root.querySelector(".tut-sections-btn");
    sectionsMenu = root.querySelector(".tut-sections-menu");
    secLabel = root.querySelector(".tut-sec-label");

    loadPresenter(0);
    buildSectionsMenu();

    root.querySelector(".tut-close").addEventListener("click", finish);
    replayBtn.addEventListener("click", () => playNarration(STEPS[index]));
    nextBtn.addEventListener("click", onNextButton);
    sectionsBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleSectionsMenu(); });
    document.addEventListener("click", (e) => {
      if (!sectionsMenu.hidden && !root.querySelector(".tut-sections").contains(e.target)) closeSectionsMenu();
    });
    // Clicking the dimmed area nudges the bubble — the rest of the UI is locked
    // until the highlighted action is taken.
    Object.values(masks).forEach((m) => m.addEventListener("click", nudge));
  }

  // Try presenter.png, then the bundled presenter.svg.
  function loadPresenter(i) {
    if (i >= PRESENTER_SRCS.length) { presenter.classList.add("no-img"); return; }
    presenterImg.onerror = () => loadPresenter(i + 1);
    presenterImg.src = PRESENTER_SRCS[i];
  }

  // --- Geometry ---------------------------------------------------------

  function place(el, top, left, width, height) {
    el.style.top = top + "px";
    el.style.left = left + "px";
    el.style.width = Math.max(0, width) + "px";
    el.style.height = Math.max(0, height) + "px";
  }

  function positionSpotlight(target) {
    const vw = window.innerWidth, vh = window.innerHeight;
    if (!target) {
      // No target: dim the whole screen with the top mask, hide the others.
      place(masks.top, 0, 0, vw, vh);
      [masks.bottom, masks.left, masks.right].forEach((m) => place(m, 0, 0, 0, 0));
      ring.style.display = "none";
      return;
    }
    const r = target.getBoundingClientRect();
    const top = Math.max(0, r.top - PAD);
    const left = Math.max(0, r.left - PAD);
    const right = Math.min(vw, r.right + PAD);
    const bottom = Math.min(vh, r.bottom + PAD);
    const w = right - left, h = bottom - top;

    // Four panels around the hole: target stays at full brightness & clickable.
    place(masks.top, 0, 0, vw, top);
    place(masks.bottom, bottom, 0, vw, vh - bottom);
    place(masks.left, top, 0, left, h);
    place(masks.right, top, right, vw - right, h);

    ring.style.display = "block";
    place(ring, top, left, w, h);
  }

  function targetAlive(t) {
    if (!t) return false;
    if (t.elements) return t.elements.every((e) => document.body.contains(e));
    return document.body.contains(t);
  }

  function reposition() {
    if (!active || suspended) return;
    positionSpotlight(targetAlive(currentTarget) ? currentTarget : null);
  }

  // --- Narration --------------------------------------------------------

  function reflectSpeaking(on) {
    presenter.classList.toggle("talking", !!on);
    replayBtn.classList.toggle("speaking", !!on);
  }

  function stopNarration() {
    if (currentAudio) {
      try { currentAudio.pause(); } catch (_) {}
      currentAudio.onended = currentAudio.onerror = null;
      currentAudio = null;
    }
    if (window.AwsSpeak && window.AwsSpeak.stop) {
      try { window.AwsSpeak.stop(); } catch (_) {}
    }
    reflectSpeaking(false);
  }

  function speakFallback(step, onDone) {
    const text = (step && (step.speech || step.text)) || "";
    if (text && window.AwsSpeak && window.AwsSpeak.enabled && window.AwsSpeak.enabled()) {
      reflectSpeaking(true);
      window.AwsSpeak.speak(text, () => {
        reflectSpeaking(false);
        if (onDone) onDone("spoken");
      });
    } else {
      reflectSpeaking(false);
      if (onDone) onDone("unavailable");
    }
  }

  // Ordered list of audio URLs to try for a step: every basename × every
  // extension. First one that actually plays wins.
  function audioCandidates(step) {
    const bases = step.audioBases || (step.audioBase ? [step.audioBase] : []);
    const out = [];
    bases.forEach((b) => AUDIO_EXTS.forEach((e) => out.push(b + e)));
    return out;
  }

  // onDone (optional) fires once when the narration finishes — with "played"
  // (clip ended), "spoken" (TTS ended) or "unavailable" (no narration at all).
  function playNarration(step, onDone) {
    stopNarration();
    if (!step) return;
    const cands = audioCandidates(step);
    if (!cands.length) { speakFallback(step, onDone); return; }

    let i = 0;
    const attempt = () => {
      if (i >= cands.length) { speakFallback(step, onDone); return; }
      const src = encodeURI(cands[i++]);   // encode spaces, e.g. "line 1.mp3"
      const a = new Audio(src);
      let settled = false;
      const fail = () => { if (!settled) { settled = true; attempt(); } };
      a.addEventListener("error", fail);
      a.addEventListener("playing", () => { settled = true; reflectSpeaking(true); });
      a.addEventListener("ended", () => {
        reflectSpeaking(false);
        if (onDone) onDone("played");
      });
      currentAudio = a;
      const p = a.play();
      if (p && p.catch) p.catch(fail);
    };
    attempt();
  }

  // --- Step rendering ---------------------------------------------------

  // --- Sections (jump-to) menu -----------------------------------------

  function escHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function buildSectionsMenu() {
    sectionsMenu.innerHTML = SECTIONS.map((s, i) =>
      '<button class="tut-sec-item" type="button" role="menuitem" data-sec="' + i + '">' +
        '<span class="tut-sec-num">' + (i + 1) + "</span>" +
        '<span class="tut-sec-name">' + escHtml(s.label) + "</span></button>",
    ).join("");
    sectionsMenu.querySelectorAll(".tut-sec-item").forEach((el) =>
      el.addEventListener("click", () => jumpToSection(Number(el.getAttribute("data-sec")))));
  }

  function currentSectionIndex() {
    let s = 0;
    for (let i = 0; i < SECTIONS.length; i++) if (index >= SECTIONS[i].step) s = i;
    return s;
  }

  // Update the sections button label + active menu item (was: progress dots).
  function renderDots() {
    if (!secLabel) return;
    const si = currentSectionIndex();
    secLabel.textContent = SECTIONS[si].label + " · " + (index + 1) + "/" + STEPS.length;
    sectionsMenu.querySelectorAll(".tut-sec-item").forEach((el, i) =>
      el.classList.toggle("is-active", i === si));
  }

  function toggleSectionsMenu() { sectionsMenu.hidden ? openSectionsMenu() : closeSectionsMenu(); }
  function openSectionsMenu() {
    renderDots();
    sectionsMenu.hidden = false;
    sectionsBtn.setAttribute("aria-expanded", "true");
  }
  function closeSectionsMenu() {
    if (!sectionsMenu) return;
    sectionsMenu.hidden = true;
    sectionsBtn.setAttribute("aria-expanded", "false");
  }

  function jumpToSection(i) {
    const sec = SECTIONS[i];
    if (!sec) return;
    closeSectionsMenu();
    if (sec.setup) { try { sec.setup(); } catch (_) {} }
    // Give async setup (network load / view switch / demo connect) a beat to
    // settle before showing the step (the step's own waitFor covers the rest).
    setTimeout(() => { if (active) show(sec.step); }, 300);
  }

  // --- Section jump-setup helpers --------------------------------------
  function zbCloseModal() {
    try { if (window.ZeroBias && window.ZeroBias.closeModal) window.ZeroBias.closeModal(); } catch (_) {}
  }
  function zbConnectDemo() {
    try {
      const st = window.ZeroBias && window.ZeroBias.getState ? window.ZeroBias.getState() : null;
      if (window.ZeroBias && window.ZeroBias.connectDemo && (!st || !st.connected)) {
        window.ZeroBias.connectDemo();          // connects demo tenant → assessor board
      } else if (window.AwsMode && window.AwsMode.set) {
        window.AwsMode.set("board");
      }
    } catch (_) {}
  }
  function loadSampleNet() { maybeLoadNetwork("sample-network.json"); }
  function setViewMode(m) {
    try { if (window.AwsMode && window.AwsMode.set) window.AwsMode.set(m); } catch (_) {}
  }

  function show(i) {
    const step = STEPS[i];
    if (!step) { finish(); return; }
    index = i;
    const seq = ++showSeq;
    detachTargetClick();
    closeSectionsMenu();

    // Per-step side effect (switch view mode, select a timeline version, …).
    if (typeof step.onEnter === "function") {
      try { step.onEnter(); } catch (_) {}
    }

    if (step.loadNetwork) maybeLoadNetwork(step.loadNetwork);

    textEl.textContent = step.text || "";
    ctaEl.textContent = step.cta || "";
    ctaEl.hidden = !step.cta;
    nextBtn.textContent = i >= STEPS.length - 1 ? "Got it" : "Next ›";
    renderDots();

    // Step presentation flags: `dim: false` keeps the page fully visible
    // (glowing ring only); `stageSide: "left"` docks the presenter + bubble
    // on the left with the presenter mirrored to face the content.
    root.classList.toggle("tut-no-dim", step.dim === false);
    root.classList.toggle("tut-stage-left", step.stageSide === "left");

    // Re-trigger the pop animation each step.
    bubble.classList.remove("pop");
    void bubble.offsetWidth;
    bubble.classList.add("pop");

    playNarration(step, (how) => {
      // Auto-advancing steps move on once their narration finishes. If there
      // was no narration at all, allow a reading pause instead of flashing by.
      if (!step.autoAdvance || !active || suspended || seq !== showSeq) return;
      const delay = how === "unavailable" ? 6500 : 800;
      setTimeout(() => {
        if (active && !suspended && seq === showSeq) next();
      }, delay);
    });

    // Dim everything while we (possibly) wait for an async-rendered target.
    if (!queryStepTarget(step)) { currentTarget = null; positionSpotlight(null); }

    resolveTarget(step, seq, (target) => {
      if (seq !== showSeq) return;             // user moved on while we waited
      currentTarget = target;
      if (target && step.scrollIntoView) {
        const scrollEl = target.elements ? target.elements[0] : target;
        try { scrollEl.scrollIntoView({ block: step.scrollBlock || "center", inline: "nearest" }); } catch (_) {}
      }
      positionSpotlight(target);
      if (target && step.advanceOn === "target" && !target.elements) attachTargetClick(target);
      settleReposition(seq);                   // re-measure after transitions settle
    });
  }

  // A step can spotlight one element (`target`) or the union of several
  // (`targets`, e.g. the security-state panel + the versions timeline). The
  // union is a lightweight facade exposing the combined bounding box.
  function makeUnionTarget(els) {
    return {
      elements: els,
      getBoundingClientRect() {
        let top = Infinity, left = Infinity, right = -Infinity, bottom = -Infinity;
        els.forEach((e) => {
          const r = e.getBoundingClientRect();
          top = Math.min(top, r.top); left = Math.min(left, r.left);
          right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
        });
        return { top, left, right, bottom, width: right - left, height: bottom - top };
      },
    };
  }

  function queryStepTarget(step) {
    if (step.targets) {
      const els = step.targets.map((s) => document.querySelector(s));
      return els.every(Boolean) ? makeUnionTarget(els) : null;
    }
    return step.target ? document.querySelector(step.target) : null;
  }

  // Resolve a step's target, polling briefly for ones that render asynchronously
  // (after a view switch / data load) when `waitFor` is set. `waitFor` may be a
  // boolean (poll for the target itself) or a selector string (poll for that to
  // exist — e.g. wait for a task card before framing the whole board area).
  function resolveTarget(step, seq, cb) {
    if (!step.target && !step.targets) { cb(null); return; }
    const waitSel = typeof step.waitFor === "string" ? step.waitFor : null;
    const get = () => {
      if (step.waitFor && waitSel && !document.querySelector(waitSel)) return null;
      return queryStepTarget(step);
    };
    const now = get();
    if (now || !step.waitFor) { cb(now); return; }
    const t0 = Date.now();
    const tick = () => {
      if (seq !== showSeq || !active) return;
      const el = get();
      if (el) { cb(el); return; }
      if (Date.now() - t0 > 6000) { cb(queryStepTarget(step)); return; }
      setTimeout(tick, 120);
    };
    setTimeout(tick, 120);
  }

  // Re-measure a few times after a step shows, to catch modal fade-in, view
  // switches and scroll settling that move the target after first paint.
  function settleReposition(seq) {
    [60, 220, 480].forEach((ms) => setTimeout(() => {
      if (seq === showSeq && active) reposition();
    }, ms));
  }

  // Load a network file into the app unless it's already the one showing (so
  // the tutorial's 2D/3D/tour steps share one known topology, and a section
  // jump re-loads it if a prior section swapped in a different network).
  function maybeLoadNetwork(url) {
    if (!(window.AwsApp && window.AwsApp.load)) return;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        const cur = window.AwsApp.getData && window.AwsApp.getData();
        const curName = cur && typeof cur.name === "string" ? cur.name : "";
        const marker = String(data.name || "").split(" · ")[0];   // e.g. "Three-Tier Web App"
        if (marker && curName.indexOf(marker) === 0) return;      // already loaded
        try { window.AwsApp.load(data); } catch (_) {}
        if (active) reposition();
      })
      .catch(() => {});
  }

  function attachTargetClick(target) {
    detachTargetClick();
    targetHandlerEl = target;
    // No { once } — the target's own handlers run first (e.g. opening the
    // ZeroBias modal); we then advance the tutorial.
    targetHandler = () => {
      const step = STEPS[index];
      if (step && step.resumeAfterTour) suspendUntil(tourBarOpen);
      else if (step && step.resumeAfterAttack) suspendUntil(attackRunning);
      else if (step && step.resumeAfterExplore) suspendUntil(exploreRunning);
      else next();
    };
    target.addEventListener("click", targetHandler);
  }

  function tourBarOpen() {
    const bar = document.getElementById("tour-bar");
    return !!(bar && bar.classList.contains("open"));
  }
  function attackRunning() {
    const hud = document.getElementById("attack-hud");
    const sum = document.getElementById("attack-summary");
    return !!((hud && !hud.hidden) || (sum && !sum.hidden));
  }
  function exploreRunning() {
    return !!(window.AwsViz3D && window.AwsViz3D.isExploring && window.AwsViz3D.isExploring());
  }

  // Hand the stage to another feature (the network tour, or the attack sim):
  // hide the tutorial, wait for that feature to start and then finish, then
  // resume with the next step. `isRunning` reports whether it's on screen.
  function suspendUntil(isRunning) {
    if (suspended || !active) return;
    suspended = true;
    stopNarration();
    detachTargetClick();
    currentTarget = null;
    root.classList.remove("show", "tut-no-dim", "tut-stage-left");
    root.hidden = true;

    const started = Date.now();
    const waitForStart = () => {
      if (!active || !suspended) return;
      if (isRunning()) { waitForEnd(); return; }
      // Never started (e.g. no data) — don't stay hidden forever.
      if (Date.now() - started > 6000) { resumeTutorial(); return; }
      setTimeout(waitForStart, 250);
    };
    const waitForEnd = () => {
      if (!active || !suspended) return;
      if (!isRunning()) { resumeTutorial(); return; }
      setTimeout(waitForEnd, 350);
    };
    waitForStart();
  }

  function resumeTutorial() {
    if (!active || !suspended) return;
    suspended = false;
    root.hidden = false;
    void root.offsetWidth;
    root.classList.add("show");
    show(index + 1);
  }

  // Drive the holographic view's zoom hierarchy (Boundary → Holonic → Holon),
  // waiting for the 3D holo scene to be ready first.
  function holoNav(level, holonicId, holonId) {
    const go = () => {
      try { window.AwsHoloViz3D.navigate(level, holonicId || null, holonId || null); } catch (_) {}
    };
    const ready = () => window.AwsHoloViz3D && window.AwsHoloViz3D.isReady && window.AwsHoloViz3D.isReady();
    if (ready()) { go(); return; }
    let tries = 20;
    const poll = () => {
      if (tries-- <= 0 || !active) return;
      if (ready()) { go(); return; }
      setTimeout(poll, 300);
    };
    setTimeout(poll, 300);
  }

  // The assembly-level pill bar is hidden during the holon-drill chapter and
  // restored when the tutorial ends.
  function hideAsmBar() {
    const bar = document.getElementById("asm-filter-bar");
    if (bar) bar.style.display = "none";
  }
  function showAsmBar() {
    const bar = document.getElementById("asm-filter-bar");
    if (bar) bar.style.display = "";
  }

  function detachTargetClick() {
    if (targetHandlerEl && targetHandler) {
      targetHandlerEl.removeEventListener("click", targetHandler);
    }
    targetHandlerEl = null;
    targetHandler = null;
  }

  function onNextButton() {
    const step = STEPS[index];
    // Explore is optional immersion — Next skips it rather than dropping the
    // user into first-person view.
    if (step && step.resumeAfterExplore) { next(); return; }
    // For a "click the target" step, the footer button does the same thing as
    // clicking the target so the user can proceed either way.
    if (step && step.advanceOn === "target" && currentTarget && document.body.contains(currentTarget)) {
      currentTarget.click();
    } else {
      next();
    }
  }

  function next() {
    if (index >= STEPS.length - 1) { finish(); return; }
    show(index + 1);
  }

  function nudge() {
    bubble.classList.remove("nudge");
    void bubble.offsetWidth;
    bubble.classList.add("nudge");
  }

  // --- Lifecycle --------------------------------------------------------

  function start() {
    build();
    if (active) return;
    active = true;
    suspended = false;
    index = 0;
    root.hidden = false;
    show(0);                          // set geometry while the masks are still transparent
    void root.offsetWidth;            // flush, then fade the dimming in
    root.classList.add("show");
    window.addEventListener("resize", reposition, { passive: true });
    window.addEventListener("scroll", reposition, { passive: true, capture: true });
    document.addEventListener("keydown", onKey, true);
  }

  function finish() {
    if (!active) return;
    active = false;
    suspended = false;
    showAsmBar();
    closeSectionsMenu();
    stopNarration();
    detachTargetClick();
    currentTarget = null;
    root.classList.remove("show", "tut-no-dim", "tut-stage-left");
    root.hidden = true;
    window.removeEventListener("resize", reposition, { passive: true });
    window.removeEventListener("scroll", reposition, { passive: true, capture: true });
    document.removeEventListener("keydown", onKey, true);
    try { localStorage.setItem(SEEN_KEY, "1"); } catch (_) {}
  }

  function onKey(e) {
    if (!active) return;
    // While the network tour is running the tutorial is hidden — let the
    // tour own the keyboard (its Escape closes the tour, which resumes us).
    if (suspended) return;
    if (e.key === "Escape") { e.preventDefault(); finish(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); next(); }
  }

  // --- Wire up ----------------------------------------------------------

  function init() {
    const btn = document.getElementById("start-tutorial");
    if (btn) btn.addEventListener("click", start);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.AwsTutorial = {
    start,
    finish,
    next,
    seen: () => {
      try { return localStorage.getItem(SEEN_KEY) === "1"; } catch (_) { return false; }
    },
  };
})();
