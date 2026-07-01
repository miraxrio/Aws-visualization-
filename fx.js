/* fx.js — site-wide FX layer: synthesized sound effects, a particle engine,
   button ripples, panel tilt, cursor spotlight and view-transition effects.
   Self-contained (no dependencies, no audio assets — everything is generated
   with WebAudio). Loaded by index.html, wizard.html and reference.html.
   Public surface: window.FX = { sound, burst, confetti, setSoundEnabled }.  */
(() => {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const SOUND_KEY = "aws-viz.fx.sound";

  /* ================= Sound engine (WebAudio, fully synthesized) ============ */

  const Sound = {
    ctx: null,
    master: null,
    enabled: localStorage.getItem(SOUND_KEY) !== "off",
    lastHover: 0,

    ensure() {
      if (!this.ctx) {
        // Don't create the context before the first user gesture — autoplay
        // policy would leave it suspended and pile up stale scheduled sounds.
        const act = navigator.userActivation;
        if (act && !act.hasBeenActive) return null;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.28;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
      return this.ctx.state === "running" ? this.ctx : null;
    },

    /* One enveloped oscillator. */
    tone({ freq = 440, end = null, type = "sine", dur = 0.12, gain = 0.5, when = 0, curve = "exp" }) {
      const ctx = this.ctx;
      const t0 = ctx.currentTime + when;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (end != null) {
        if (curve === "exp") osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), t0 + dur);
        else osc.frequency.linearRampToValueAtTime(end, t0 + dur);
      }
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    },

    /* Filtered noise burst — whooshes, thuds, static. */
    noise({ dur = 0.3, gain = 0.4, when = 0, from = 400, to = 2400, type = "bandpass", q = 1.2 }) {
      const ctx = this.ctx;
      const t0 = ctx.currentTime + when;
      const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.Q.value = q;
      filter.frequency.setValueAtTime(from, t0);
      filter.frequency.exponentialRampToValueAtTime(Math.max(30, to), t0 + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filter).connect(g).connect(this.master);
      src.start(t0);
      src.stop(t0 + dur + 0.05);
    },

    play(name) {
      if (!this.enabled) return;
      if (!this.ensure()) return;
      switch (name) {
        case "click":
          this.tone({ freq: 1900, end: 1100, type: "triangle", dur: 0.06, gain: 0.35 });
          this.noise({ dur: 0.04, gain: 0.12, from: 3200, to: 1600 });
          break;
        case "hover": {
          const now = performance.now();
          if (now - this.lastHover < 90) return;   // throttle rapid sweeps
          this.lastHover = now;
          this.tone({ freq: 2700, type: "sine", dur: 0.03, gain: 0.06 });
          break;
        }
        case "pop":
          this.tone({ freq: 520, end: 940, type: "sine", dur: 0.09, gain: 0.4 });
          break;
        case "toggle":
          this.tone({ freq: 780, type: "triangle", dur: 0.05, gain: 0.35 });
          this.tone({ freq: 1240, type: "triangle", dur: 0.07, gain: 0.3, when: 0.07 });
          break;
        case "whoosh":
          this.noise({ dur: 0.4, gain: 0.35, from: 300, to: 2600, q: 1.4 });
          break;
        case "success":  // rising C-E-G arpeggio
          this.tone({ freq: 523.25, type: "triangle", dur: 0.16, gain: 0.4 });
          this.tone({ freq: 659.25, type: "triangle", dur: 0.16, gain: 0.4, when: 0.09 });
          this.tone({ freq: 783.99, type: "triangle", dur: 0.28, gain: 0.42, when: 0.18 });
          this.noise({ dur: 0.35, gain: 0.06, from: 4000, to: 8000, when: 0.18, q: 0.7 });
          break;
        case "error":
          this.tone({ freq: 220, end: 140, type: "sawtooth", dur: 0.22, gain: 0.3 });
          this.tone({ freq: 165, end: 110, type: "sawtooth", dur: 0.26, gain: 0.22, when: 0.05 });
          break;
        case "drop":
          this.tone({ freq: 240, end: 85, type: "sine", dur: 0.15, gain: 0.5 });
          this.noise({ dur: 0.08, gain: 0.15, from: 900, to: 250 });
          break;
        case "alarm":
          this.tone({ freq: 880, type: "square", dur: 0.12, gain: 0.16 });
          this.tone({ freq: 660, type: "square", dur: 0.12, gain: 0.16, when: 0.16 });
          this.tone({ freq: 880, type: "square", dur: 0.12, gain: 0.16, when: 0.32 });
          break;
        case "chime":
          this.tone({ freq: 987.77, type: "sine", dur: 0.18, gain: 0.3 });
          this.tone({ freq: 1318.5, type: "sine", dur: 0.3, gain: 0.28, when: 0.1 });
          break;
      }
    },
  };

  /* ================= Particle engine (single canvas overlay) =============== */

  const Particles = {
    canvas: null,
    g: null,
    parts: [],
    ambient: [],
    colors: ["#ff9900", "#58a6ff", "#4dd4ac", "#c084fc"],
    running: false,
    lastTrail: 0,
    trailX: 0,
    trailY: 0,

    init() {
      this.canvas = document.createElement("canvas");
      this.canvas.className = "fx-canvas";
      this.canvas.setAttribute("aria-hidden", "true");
      document.body.appendChild(this.canvas);
      this.g = this.canvas.getContext("2d");
      this.resize();
      window.addEventListener("resize", () => this.resize());
      this.refreshColors();
      if (!reducedMotion.matches) this.seedAmbient();
      this.kick();
    },

    resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.canvas.width = Math.floor(innerWidth * dpr);
      this.canvas.height = Math.floor(innerHeight * dpr);
      this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    },

    refreshColors() {
      const cs = getComputedStyle(document.body);
      const pick = (name, fallback) => (cs.getPropertyValue(name) || fallback).trim() || fallback;
      this.colors = [
        pick("--accent", "#ff9900"),
        pick("--accent-2", "#58a6ff"),
        pick("--public", "#4dd4ac"),
        pick("--data", "#c084fc"),
      ];
      this.ambient.forEach((p, i) => { p.color = this.colors[i % this.colors.length]; });
    },

    seedAmbient() {
      const count = Math.min(55, Math.round((innerWidth * innerHeight) / 34000));
      for (let i = 0; i < count; i++) {
        this.ambient.push({
          x: Math.random() * innerWidth,
          y: Math.random() * innerHeight,
          vx: (Math.random() - 0.5) * 0.12,
          vy: -0.06 - Math.random() * 0.22,
          size: 0.7 + Math.random() * 1.7,
          alpha: 0.05 + Math.random() * 0.16,
          phase: Math.random() * Math.PI * 2,
          color: this.colors[i % this.colors.length],
        });
      }
    },

    /* Radial spark burst — clicks, drops. */
    burst(x, y, { count = 10, speed = 3, colors = null, size = 2, ttl = 600, gravity = 0.04 } = {}) {
      if (reducedMotion.matches) return;
      const palette = colors || this.colors;
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = speed * (0.35 + Math.random() * 0.9);
        this.parts.push({
          kind: "spark",
          x, y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          g: gravity,
          size: size * (0.5 + Math.random()),
          ttl, age: 0,
          color: palette[(Math.random() * palette.length) | 0],
        });
      }
      this.kick();
    },

    /* Celebration confetti — network loaded, attack repelled, export done. */
    confetti(x = innerWidth / 2, y = innerHeight * 0.28, count = 110) {
      if (reducedMotion.matches) return;
      for (let i = 0; i < count; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
        const v = 4 + Math.random() * 7;
        this.parts.push({
          kind: "confetti",
          x: x + (Math.random() - 0.5) * 120,
          y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          g: 0.16,
          w: 4 + Math.random() * 5,
          h: 2.5 + Math.random() * 3.5,
          rot: Math.random() * Math.PI * 2,
          vr: (Math.random() - 0.5) * 0.3,
          ttl: 1800 + Math.random() * 900,
          age: 0,
          color: this.colors[(Math.random() * this.colors.length) | 0],
        });
      }
      this.kick();
    },

    /* Faint comet trail behind the pointer over the stage. */
    trail(x, y) {
      if (reducedMotion.matches) return;
      const now = performance.now();
      const dx = x - this.trailX, dy = y - this.trailY;
      if (now - this.lastTrail < 28 || dx * dx + dy * dy < 320) return;
      this.lastTrail = now;
      this.trailX = x; this.trailY = y;
      this.parts.push({
        kind: "spark",
        x, y,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35 - 0.15,
        g: 0,
        size: 1 + Math.random() * 1.4,
        ttl: 480, age: 0,
        color: this.colors[(Math.random() * this.colors.length) | 0],
      });
      this.kick();
    },

    kick() {
      if (this.running) return;
      this.running = true;
      requestAnimationFrame((t) => this.step(t));
    },

    step() {
      const g = this.g;
      g.clearRect(0, 0, innerWidth, innerHeight);
      const t = performance.now();

      if (!document.hidden && !reducedMotion.matches) {
        for (const p of this.ambient) {
          p.x += p.vx + Math.sin(t / 2400 + p.phase) * 0.08;
          p.y += p.vy;
          if (p.y < -6) { p.y = innerHeight + 6; p.x = Math.random() * innerWidth; }
          if (p.x < -6) p.x = innerWidth + 6;
          if (p.x > innerWidth + 6) p.x = -6;
          g.globalAlpha = p.alpha * (0.75 + 0.25 * Math.sin(t / 900 + p.phase));
          g.fillStyle = p.color;
          g.beginPath();
          g.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          g.fill();
        }
      }

      const keep = [];
      for (const p of this.parts) {
        p.age += 16.7;
        if (p.age >= p.ttl) continue;
        p.vy += p.g;
        p.x += p.vx;
        p.y += p.vy;
        const life = 1 - p.age / p.ttl;
        g.globalAlpha = Math.max(0, life);
        g.fillStyle = p.color;
        if (p.kind === "confetti") {
          p.rot += p.vr;
          p.vx *= 0.985;
          g.save();
          g.translate(p.x, p.y);
          g.rotate(p.rot);
          g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * (0.4 + 0.6 * Math.abs(Math.sin(p.rot * 2))));
          g.restore();
        } else {
          g.beginPath();
          g.arc(p.x, p.y, p.size * (0.4 + 0.6 * life), 0, Math.PI * 2);
          g.fill();
        }
        keep.push(p);
      }
      this.parts = keep.length > 700 ? keep.slice(-700) : keep;
      g.globalAlpha = 1;

      const ambientAlive = this.ambient.length > 0 && !reducedMotion.matches;
      if (this.parts.length || ambientAlive) {
        requestAnimationFrame(() => this.step());
      } else {
        this.running = false;
        g.clearRect(0, 0, innerWidth, innerHeight);
      }
    },
  };

  /* ================= Ripples, tilt, spotlight ============================== */

  const INTERACTIVE =
    ".btn, .seg-btn, .tour-btn, .zb-menu-item, .asm-pill, .wizard-step, " +
    ".attack-card, .inv-tile, .catalog-card, .tut-next, .tut-replay, .holo-crumb";

  function spawnRipple(el, x, y) {
    const rect = el.getBoundingClientRect();
    const d = Math.max(rect.width, rect.height) * 2.1;
    const span = document.createElement("span");
    span.className = "fx-ripple";
    span.style.width = span.style.height = d + "px";
    span.style.left = x - rect.left - d / 2 + "px";
    span.style.top = y - rect.top - d / 2 + "px";
    el.appendChild(span);
    span.addEventListener("animationend", () => span.remove(), { once: true });
    setTimeout(() => span.remove(), 800);   // safety net if animations are off
  }

  /* Subtle 3D tilt for sidebar panels and cards. */
  const Tilt = {
    el: null,
    move(e) {
      if (reducedMotion.matches) return;
      const el = e.target.closest ? e.target.closest(".panel, .catalog-card, .attack-card") : null;
      if (el !== this.el) this.reset();
      if (!el || el.closest(".stage")) return;
      this.el = el;
      el.classList.add("fx-tilt");
      const r = el.getBoundingClientRect();
      const rx = ((e.clientY - r.top) / r.height - 0.5) * -3.2;
      const ry = ((e.clientX - r.left) / r.width - 0.5) * 3.2;
      el.style.transform = `perspective(760px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateY(-1px)`;
    },
    reset() {
      if (!this.el) return;
      this.el.style.transform = "";
      this.el.classList.remove("fx-tilt");
      this.el = null;
    },
  };

  /* Soft light that follows the cursor across the diagram stage. */
  function initSpotlight() {
    const stage = document.getElementById("stage");
    if (!stage) return;
    const spot = document.createElement("div");
    spot.className = "fx-spotlight";
    spot.setAttribute("aria-hidden", "true");
    stage.appendChild(spot);
    stage.addEventListener("pointermove", (e) => {
      const r = stage.getBoundingClientRect();
      spot.style.setProperty("--fx-mx", ((e.clientX - r.left) / r.width) * 100 + "%");
      spot.style.setProperty("--fx-my", ((e.clientY - r.top) / r.height) * 100 + "%");
      spot.classList.add("is-on");
      Particles.trail(e.clientX, e.clientY);
    });
    stage.addEventListener("pointerleave", () => spot.classList.remove("is-on"));
  }

  /* ================= Sound toggle button =================================== */

  const SPEAKER_ON =
    '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54z"/></svg>';
  const SPEAKER_OFF =
    '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M16.5 12a4.5 4.5 0 0 0-2.5-4v2.18l2.45 2.45c.03-.21.05-.42.05-.63zM19 12c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.93 8.93 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73 4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>';

  function initSoundToggle() {
    const btn = document.createElement("button");
    btn.id = "fx-sound-toggle";
    btn.className = "btn ghost icon-only fx-sound-btn";
    const paint = () => {
      btn.innerHTML = Sound.enabled ? SPEAKER_ON : SPEAKER_OFF;
      btn.title = Sound.enabled ? "Mute sound effects" : "Unmute sound effects";
      btn.setAttribute("aria-label", btn.title);
      btn.setAttribute("aria-pressed", String(Sound.enabled));
      btn.classList.toggle("is-muted", !Sound.enabled);
    };
    paint();
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      Sound.enabled = !Sound.enabled;
      localStorage.setItem(SOUND_KEY, Sound.enabled ? "on" : "off");
      paint();
      if (Sound.enabled) Sound.play("toggle");
      const r = btn.getBoundingClientRect();
      Particles.burst(r.left + r.width / 2, r.top + r.height / 2, { count: 8, speed: 2.2 });
    });
    const controls = document.querySelector(".topbar .controls");
    if (controls) controls.insertBefore(btn, document.getElementById("theme-toggle"));
    else { btn.classList.add("fx-sound-float"); document.body.appendChild(btn); }
  }

  /* ================= Global wiring ========================================= */

  function currentMode() {
    const c = document.body.classList;
    if (c.contains("mode-3d")) return "3d";
    if (c.contains("mode-map")) return "map";
    if (c.contains("mode-board")) return "board";
    return "2d";
  }

  function stageElFor(mode) {
    return {
      "2d": document.getElementById("diagram"),
      "3d": document.getElementById("stage-3d"),
      map: document.getElementById("stage-map"),
      board: document.getElementById("stage-board"),
    }[mode];
  }

  function animateViewEnter(mode) {
    const el = stageElFor(mode);
    if (!el || reducedMotion.matches) return;
    el.classList.remove("fx-view-enter");
    void el.getBoundingClientRect();   // restart the animation
    el.classList.add("fx-view-enter");
    setTimeout(() => el.classList.remove("fx-view-enter"), 700);
  }

  function shakeStage() {
    const stage = document.getElementById("stage");
    if (!stage || reducedMotion.matches) return;
    stage.classList.add("fx-shake");
    setTimeout(() => stage.classList.remove("fx-shake"), 550);
  }

  function initInteractions() {
    // Click: ripple + spark burst + sound on anything interactive.
    document.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      const el = e.target.closest ? e.target.closest(INTERACTIVE) : null;
      if (!el) return;
      spawnRipple(el, e.clientX, e.clientY);
      const primary = el.classList.contains("primary") || el.classList.contains("seg-btn");
      Particles.burst(e.clientX, e.clientY, { count: primary ? 12 : 6, speed: primary ? 3 : 2 });
      Sound.play(el.classList.contains("seg-btn") ? "pop" : "click");
    }, { capture: true, passive: true });

    // Hover ticks (mouse only — no ticks while scrolling on touch).
    document.addEventListener("mouseover", (e) => {
      const el = e.target.closest ? e.target.closest(INTERACTIVE) : null;
      if (!el || el.contains(e.relatedTarget)) return;
      Sound.play("hover");
    }, { passive: true });

    // Panel / card tilt.
    document.addEventListener("pointermove", (e) => Tilt.move(e), { passive: true });
    document.addEventListener("pointerleave", () => Tilt.reset());

    // Drag-and-drop (topology files onto the canvas, services onto subnets).
    document.addEventListener("drop", (e) => {
      Sound.play("drop");
      Particles.burst(e.clientX, e.clientY, { count: 16, speed: 3.4 });
    }, { capture: true, passive: true });

    const fileInput = document.getElementById("file-input");
    if (fileInput) fileInput.addEventListener("change", () => Sound.play("drop"));
  }

  function initObservers() {
    // A network finished loading → chime + confetti over the stage.
    const netName = document.getElementById("net-name");
    if (netName) {
      let last = netName.textContent.trim();
      new MutationObserver(() => {
        const now = netName.textContent.trim();
        if (now && now !== last && now !== "No network loaded") {
          Sound.play("success");
          const stage = document.getElementById("stage");
          const r = stage ? stage.getBoundingClientRect() : { left: 0, width: innerWidth, top: 0 };
          Particles.confetti(r.left + r.width / 2, r.top + 90, 90);
        }
        last = now;
      }).observe(netName, { childList: true, characterData: true, subtree: true });
    }

    // View-mode / theme switches (body class changes).
    let mode = currentMode();
    let day = document.body.classList.contains("theme-day");
    new MutationObserver(() => {
      const m = currentMode();
      if (m !== mode) {
        mode = m;
        Sound.play("whoosh");
        animateViewEnter(m);
      }
      const d = document.body.classList.contains("theme-day");
      if (d !== day) {
        day = d;
        Sound.play("chime");
        Particles.refreshColors();
      }
    }).observe(document.body, { attributes: true, attributeFilter: ["class"] });

    // Attack simulation drama: alarm + screen shake when the HUD appears,
    // verdict sting + confetti when the summary lands.
    const hud = document.getElementById("attack-hud");
    if (hud) {
      new MutationObserver(() => {
        if (!hud.hidden) { Sound.play("alarm"); shakeStage(); }
      }).observe(hud, { attributes: true, attributeFilter: ["hidden"] });
    }
    const summary = document.getElementById("attack-summary");
    if (summary) {
      new MutationObserver(() => {
        if (summary.hidden) return;
        const outcome = (document.getElementById("attack-summary-outcome") || {}).textContent || "";
        if (/defend|blocked|repel|held|safe|surviv|no .*breach/i.test(outcome)) {
          Sound.play("success");
          Particles.confetti(innerWidth / 2, innerHeight * 0.3, 120);
        } else {
          Sound.play("error");
        }
      }).observe(summary, { attributes: true, attributeFilter: ["hidden"] });
    }

    // Toasts and modals get a soft pop as they appear.
    for (const id of ["holo-toast", "wizard-toast", "attack-modal", "zb-modal", "import-menu", "wizard-modal"]) {
      const el = document.getElementById(id);
      if (!el) continue;
      new MutationObserver(() => { if (!el.hidden) Sound.play("pop"); })
        .observe(el, { attributes: true, attributeFilter: ["hidden"] });
    }
  }

  /* Wizard-only extras: celebrate export / publish actions. */
  function initWizardHooks() {
    if (!document.body.classList.contains("wizard-body")) return;
    for (const id of ["copy-json-btn", "download-json-btn", "load-into-viz-btn", "publish-draft-btn"]) {
      const btn = document.getElementById(id);
      if (!btn) continue;
      btn.addEventListener("click", () => {
        Sound.play("success");
        const r = btn.getBoundingClientRect();
        Particles.confetti(r.left + r.width / 2, r.top, 70);
      });
    }
  }

  /* ================= Boot ================================================== */

  function boot() {
    document.body.classList.add("fx-page-enter");
    Particles.init();
    initSoundToggle();
    initSpotlight();
    initInteractions();
    initObservers();
    initWizardHooks();

    reducedMotion.addEventListener?.("change", () => {
      if (reducedMotion.matches) { Particles.ambient = []; Particles.parts = []; }
      else if (!Particles.ambient.length) { Particles.seedAmbient(); Particles.kick(); }
    });

    window.FX = {
      sound: (name) => Sound.play(name),
      burst: (x, y, opts) => Particles.burst(x, y, opts),
      confetti: (x, y, n) => Particles.confetti(x, y, n),
      setSoundEnabled(on) {
        Sound.enabled = !!on;
        localStorage.setItem(SOUND_KEY, on ? "on" : "off");
      },
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
