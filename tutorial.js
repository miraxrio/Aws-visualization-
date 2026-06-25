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
    },
  ];

  const PAD = 8;                  // spotlight padding around the target (px)
  const AUDIO_EXTS = [".mp3", ".m4a", ".wav", ".ogg"];
  // Your presenter.png is preferred (assets/tutorial/ then site root); the
  // bundled illustration is the final fallback.
  const PRESENTER_SRCS = ["assets/tutorial/presenter.png", "presenter.png", "assets/tutorial/presenter.svg"];
  const SEEN_KEY = "aws-viz.tutorial.seen";

  let root, masks, ring, stage, bubble, textEl, ctaEl, dotsEl, nextBtn, replayBtn, presenter, presenterImg;
  let built = false;
  let active = false;
  let index = 0;
  let showSeq = 0;
  let currentTarget = null;
  const loadedNets = new Set();   // network files already loaded this run (load once)
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
      '      <div class="tut-dots" aria-hidden="true"></div>' +
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
    dotsEl = root.querySelector(".tut-dots");
    nextBtn = root.querySelector(".tut-next");
    replayBtn = root.querySelector(".tut-replay");
    presenter = root.querySelector(".tut-presenter");
    presenterImg = root.querySelector(".tut-presenter-img");

    loadPresenter(0);

    root.querySelector(".tut-close").addEventListener("click", finish);
    replayBtn.addEventListener("click", () => playNarration(STEPS[index]));
    nextBtn.addEventListener("click", onNextButton);
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

  function reposition() {
    if (!active) return;
    positionSpotlight(currentTarget && document.body.contains(currentTarget) ? currentTarget : null);
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

  function speakFallback(step) {
    const text = (step && (step.speech || step.text)) || "";
    if (text && window.AwsSpeak && window.AwsSpeak.enabled && window.AwsSpeak.enabled()) {
      reflectSpeaking(true);
      window.AwsSpeak.speak(text, () => reflectSpeaking(false));
    } else {
      reflectSpeaking(false);
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

  function playNarration(step) {
    stopNarration();
    if (!step) return;
    const cands = audioCandidates(step);
    if (!cands.length) { speakFallback(step); return; }

    let i = 0;
    const attempt = () => {
      if (i >= cands.length) { speakFallback(step); return; }
      const src = encodeURI(cands[i++]);   // encode spaces, e.g. "line 1.mp3"
      const a = new Audio(src);
      let settled = false;
      const fail = () => { if (!settled) { settled = true; attempt(); } };
      a.addEventListener("error", fail);
      a.addEventListener("playing", () => { settled = true; reflectSpeaking(true); });
      a.addEventListener("ended", () => reflectSpeaking(false));
      currentAudio = a;
      const p = a.play();
      if (p && p.catch) p.catch(fail);
    };
    attempt();
  }

  // --- Step rendering ---------------------------------------------------

  function renderDots() {
    if (STEPS.length < 2) { dotsEl.innerHTML = ""; return; }
    dotsEl.innerHTML = STEPS
      .map((_, i) => '<span class="tut-dot' + (i === index ? " is-active" : "") + '"></span>')
      .join("");
  }

  function show(i) {
    const step = STEPS[i];
    if (!step) { finish(); return; }
    index = i;
    const seq = ++showSeq;
    detachTargetClick();

    if (step.loadNetwork) maybeLoadNetwork(step.loadNetwork);

    textEl.textContent = step.text || "";
    ctaEl.textContent = step.cta || "";
    ctaEl.hidden = !step.cta;
    nextBtn.textContent = i >= STEPS.length - 1 ? "Got it" : "Next ›";
    renderDots();

    // Re-trigger the pop animation each step.
    bubble.classList.remove("pop");
    void bubble.offsetWidth;
    bubble.classList.add("pop");

    playNarration(step);

    // Dim everything while we (possibly) wait for an async-rendered target.
    const immediate = step.target ? document.querySelector(step.target) : null;
    if (!immediate) { currentTarget = null; positionSpotlight(null); }

    resolveTarget(step, seq, (target) => {
      if (seq !== showSeq) return;             // user moved on while we waited
      currentTarget = target;
      if (target && step.scrollIntoView) {
        try { target.scrollIntoView({ block: "center", inline: "nearest" }); } catch (_) {}
      }
      positionSpotlight(target);
      if (target && step.advanceOn === "target") attachTargetClick(target);
      settleReposition(seq);                   // re-measure after transitions settle
    });
  }

  // Resolve a step's target, polling briefly for ones that render asynchronously
  // (after a view switch / data load) when `waitFor` is set. `waitFor` may be a
  // boolean (poll for the target itself) or a selector string (poll for that to
  // exist — e.g. wait for a task card before framing the whole board area).
  function resolveTarget(step, seq, cb) {
    if (!step.target) { cb(null); return; }
    const waitSel = typeof step.waitFor === "string" ? step.waitFor : step.target;
    const get = () => (step.waitFor && !document.querySelector(waitSel)) ? null : document.querySelector(step.target);
    const now = get();
    if (now || !step.waitFor) { cb(now); return; }
    const t0 = Date.now();
    const tick = () => {
      if (seq !== showSeq || !active) return;
      const el = get();
      if (el) { cb(el); return; }
      if (Date.now() - t0 > 6000) { cb(document.querySelector(step.target)); return; }
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

  // Load a network file into the app once (so the tutorial's 2D/3D/tour steps
  // all show the same known topology). Re-measures once it has rendered.
  function maybeLoadNetwork(url) {
    if (loadedNets.has(url)) return;
    loadedNets.add(url);
    if (!(window.AwsApp && window.AwsApp.load)) return;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
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
    targetHandler = () => next();
    target.addEventListener("click", targetHandler);
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
    index = 0;
    loadedNets.clear();
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
    stopNarration();
    detachTargetClick();
    currentTarget = null;
    root.classList.remove("show");
    root.hidden = true;
    window.removeEventListener("resize", reposition, { passive: true });
    window.removeEventListener("scroll", reposition, { passive: true, capture: true });
    document.removeEventListener("keydown", onKey, true);
    try { localStorage.setItem(SEEN_KEY, "1"); } catch (_) {}
  }

  function onKey(e) {
    if (!active) return;
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
