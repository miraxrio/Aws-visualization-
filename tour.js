// Guided tour: builds an ordered walk through the loaded network and narrates
// each element. Drives the visualizer's focus()/highlight() APIs.

(function () {
  const STEP_MS = 6500;

  const els = {
    bar: document.getElementById("tour-bar"),
    start: document.getElementById("start-tour"),
    play: document.getElementById("tour-play"),
    playIcon: document.getElementById("tour-play-icon"),
    next: document.getElementById("tour-next"),
    prev: document.getElementById("tour-prev"),
    close: document.getElementById("tour-close"),
    speak: document.getElementById("tour-speak"),
    speakOn: document.getElementById("tour-speak-on"),
    speakOff: document.getElementById("tour-speak-off"),
    voice: document.getElementById("tour-voice"),
    voicePopover: document.getElementById("voice-popover"),
    voiceSelect: document.getElementById("voice-select"),
    voiceRate: document.getElementById("voice-rate"),
    voiceRateVal: document.getElementById("voice-rate-val"),
    progress: document.getElementById("tour-progress"),
    stage: document.getElementById("tour-stage"),
    stepCount: document.getElementById("tour-step-count"),
    title: document.getElementById("tour-title"),
    narration: document.getElementById("tour-narration"),
    extra: document.getElementById("tour-extra"),
  };

  const ICON_PLAY = '<path d="M8 5v14l11-7z"/>';
  const ICON_PAUSE = '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>';

  let steps = [];
  let index = 0;
  let playing = false;
  let timer = null;

  // --- Speech synthesis ------------------------------------------------

  const synth = window.speechSynthesis;
  const speechSupported = !!synth;
  let voices = [];
  let selectedVoiceURI = localStorage.getItem("aws-viz.voice") || "";
  let speechRate = parseFloat(localStorage.getItem("aws-viz.rate") || "1") || 1;
  let speakEnabled = localStorage.getItem("aws-viz.speak") !== "0" && speechSupported;
  let currentUtter = null;
  let utterQueue = []; // utterances we've queued for the current step

  // Preprocess text so the TTS reads things naturally.
  function prepareForSpeech(text) {
    if (!text) return "";
    let t = String(text);

    // CIDRs and IPv4 addresses: drop the dots so digits are read consecutively
    // ("zero zero zero zero slash zero" instead of "zero dot zero dot zero…").
    t = t.replace(
      /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(\/(\d{1,2}))?\b/g,
      (_m, a, b, c, d, _slash, mask) =>
        `${a} ${b} ${c} ${d}${mask ? " slash " + mask : ""}`,
    );

    // Bare CIDR like "/24" — read the slash
    t = t.replace(/(^|\s)\/(\d{1,2})\b/g, "$1slash $2");

    // Dotted segment lists like "us-east-1a" read fine; leave alone.
    return t;
  }

  // Split text into short chunks (each well under the ~15s Chrome cutoff).
  // Splits on sentence boundaries first; if a sentence is still too long,
  // splits on commas/semicolons, then on whitespace as a last resort.
  function chunkForSpeech(text, maxLen = 140) {
    const sentences = text.split(/(?<=[.!?])\s+/);
    const out = [];

    const pushSplit = (s) => {
      if (s.length <= maxLen) { out.push(s); return; }
      // Split on , ; : — preserve the punctuation
      const sub = s.split(/(?<=[,;:])\s+/);
      let cur = "";
      for (const p of sub) {
        const cand = cur ? cur + " " + p : p;
        if (cand.length > maxLen && cur) {
          // Still too big? Hard-wrap on whitespace.
          if (cur.length > maxLen) {
            const words = cur.split(/\s+/);
            let line = "";
            for (const w of words) {
              if ((line + " " + w).length > maxLen && line) { out.push(line); line = w; }
              else line = line ? line + " " + w : w;
            }
            if (line) out.push(line);
          } else {
            out.push(cur);
          }
          cur = p;
        } else {
          cur = cand;
        }
      }
      if (cur) out.push(cur);
    };

    let cur = "";
    for (const s of sentences) {
      const cand = cur ? cur + " " + s : s;
      if (cand.length > maxLen && cur) {
        pushSplit(cur);
        cur = s;
      } else {
        cur = cand;
      }
    }
    if (cur) pushSplit(cur);
    return out;
  }

  function reflectSpeakState() {
    if (!speechSupported) {
      els.speak.disabled = true;
      els.voice.disabled = true;
      els.speak.title = "Speech not supported in this browser";
      return;
    }
    els.speak.setAttribute("aria-pressed", speakEnabled ? "true" : "false");
    els.speakOn.style.display = speakEnabled ? "" : "none";
    els.speakOff.style.display = speakEnabled ? "none" : "";
  }

  function loadVoices() {
    if (!speechSupported) return;
    voices = synth.getVoices() || [];

    // Prefer English neural-ish / "Google" / "Microsoft" voices.
    const score = (v) => {
      let s = 0;
      if (/^en[-_]/.test(v.lang)) s += 5;
      if (/google|natural|neural|enhanced|premium/i.test(v.name)) s += 3;
      if (/female|samantha|victoria|aria|jenny|emma/i.test(v.name)) s += 1;
      if (v.localService) s += 1;
      return s;
    };
    voices = voices.slice().sort((a, b) => score(b) - score(a));

    // Populate the picker
    els.voiceSelect.innerHTML = "";
    voices.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v.voiceURI;
      opt.textContent = `${v.name} (${v.lang})${v.default ? " · default" : ""}`;
      els.voiceSelect.appendChild(opt);
    });

    if (selectedVoiceURI && voices.some((v) => v.voiceURI === selectedVoiceURI)) {
      els.voiceSelect.value = selectedVoiceURI;
    } else if (voices[0]) {
      selectedVoiceURI = voices[0].voiceURI;
      els.voiceSelect.value = selectedVoiceURI;
    }
  }

  if (speechSupported) {
    loadVoices();
    synth.addEventListener("voiceschanged", loadVoices);
    els.voiceRate.value = String(speechRate);
    els.voiceRateVal.textContent = `${speechRate.toFixed(2)}×`;
  }
  reflectSpeakState();

  function pickVoice() {
    if (!voices.length) return null;
    return voices.find((v) => v.voiceURI === selectedVoiceURI) || voices[0];
  }

  // Estimate how long an utterance will take; used as a fallback timer in
  // case `onend` never fires (some browsers misbehave).
  function estimateMs(text, rate) {
    const wordsPerMin = 165 * rate;
    const words = (text || "").split(/\s+/).filter(Boolean).length;
    return Math.max(2500, Math.round((words / wordsPerMin) * 60000) + 800);
  }

  function stopSpeaking() {
    if (!speechSupported) return;
    // Detach handlers so cancel()'s synthetic onend/onerror don't leak through.
    utterQueue.forEach((u) => { u.onend = null; u.onerror = null; });
    utterQueue = [];
    currentUtter = null;
    try { synth.cancel(); } catch (_) {}
    els.speak.classList.remove("speaking");
  }

  function speak(text, onEnd) {
    if (!speechSupported || !speakEnabled || !text) {
      if (onEnd) onEnd("disabled");
      return 0;
    }
    stopSpeaking();

    const prepared = prepareForSpeech(text);
    const chunks = chunkForSpeech(prepared);
    if (!chunks.length) {
      if (onEnd) onEnd("end");
      return 0;
    }

    const v = pickVoice();
    const totalEstMs = estimateMs(prepared, speechRate);
    let endedCount = 0;
    let finalized = false;

    const finalize = (reason) => {
      if (finalized) return;
      finalized = true;
      utterQueue = [];
      currentUtter = null;
      els.speak.classList.remove("speaking");
      if (onEnd) onEnd(reason);
    };

    chunks.forEach((c) => {
      const u = new SpeechSynthesisUtterance(c);
      if (v) u.voice = v;
      u.lang = (v && v.lang) || "en-US";
      u.rate = speechRate;
      u.pitch = 1;
      u.volume = 1;
      u.onend = () => {
        endedCount++;
        if (endedCount >= chunks.length) finalize("end");
      };
      u.onerror = () => {
        endedCount++;
        if (endedCount >= chunks.length) finalize("error");
      };
      utterQueue.push(u);
    });

    currentUtter = utterQueue[utterQueue.length - 1];
    els.speak.classList.add("speaking");

    // Defer slightly so Chrome's cancel() has time to settle before speak().
    setTimeout(() => {
      utterQueue.forEach((u) => {
        try { synth.speak(u); } catch (_) {}
      });
    }, 30);

    return totalEstMs;
  }

  // --- Step generation -------------------------------------------------

  function buildSteps(data) {
    if (!data || !data.vpcs) return [];
    const out = [];
    const tier = (s) => s.tier || "private";
    const nodeName = (id) => {
      const lay = AwsViz.getLayout();
      const n = lay && lay.nodes.get(id);
      return n ? n.name || n.id : id;
    };

    out.push({
      id: "internet",
      stage: "Origin",
      title: "The public internet",
      narration:
        "Every external request starts here. To reach your services it has to pass through an Internet Gateway and the routing rules of a public subnet. Security Groups and (optionally) WAF decide what's actually allowed in.",
      extra: "Outside the VPC. Not under your control.",
    });

    data.vpcs.forEach((vpc) => {
      out.push({
        id: vpc.id,
        stage: "VPC",
        title: `${vpc.name || vpc.id} — your private network`,
        narration: `A logically isolated network with CIDR ${vpc.cidr || "—"}${vpc.region ? " in " + vpc.region : ""}. Everything inside this box is yours: subnets, gateways, instances. Traffic between subnets is private by default.`,
        extra: `${(vpc.subnets || []).length} subnets · ${(vpc.gateways || []).length} gateways · ${(vpc.resources || []).length} resources`,
      });

      // IGW(s) at the top
      (vpc.gateways || []).filter((g) => g.type !== "nat").forEach((g) => {
        out.push({
          id: g.id,
          stage: "Gateway",
          title: `${g.name || g.id} — the front door`,
          narration:
            "The Internet Gateway is the only legitimate path between the public internet and your VPC. It's horizontally scaled, redundant, and stateless — it doesn't filter traffic itself; that's the job of Security Groups and Network ACLs.",
        });
      });

      // Public tier first (LB, WAF, NAT)
      const pub = (vpc.subnets || []).filter((s) => tier(s) === "public");
      pub.forEach((s) => {
        out.push({
          id: s.id,
          stage: "Public subnet",
          title: `${s.name || s.id} — public-facing tier`,
          narration: `A subnet whose route table sends 0.0.0.0/0 to the Internet Gateway, in availability zone ${s.az || "—"}. This is where load balancers, NAT gateways and bastions live. Application servers should not.`,
          extra: `CIDR ${s.cidr || "—"}`,
        });

        const inSubnet = (r) => r.subnet === s.id;
        const lbs = (vpc.resources || []).filter((r) => inSubnet(r) && /^(alb|nlb|waf)$/.test(r.type));
        lbs.forEach((r) => out.push(narrateResource(r, vpc, "Public-facing service")));

        const nats = (vpc.gateways || []).filter((g) => g.type === "nat" && g.subnet === s.id);
        nats.forEach((g) => {
          out.push({
            id: g.id,
            stage: "NAT",
            title: `${g.name || g.id} — outbound translator`,
            narration:
              "A NAT Gateway lets private-subnet workloads reach the internet (for OS updates, third-party APIs) without ever being reachable from it. It's stateful, has its own Elastic IP, and lives in a public subnet. One per AZ for resilience.",
          });
        });
      });

      // Private tier (apps)
      const prv = (vpc.subnets || []).filter((s) => tier(s) === "private");
      prv.forEach((s) => {
        out.push({
          id: s.id,
          stage: "Private subnet",
          title: `${s.name || s.id} — application tier`,
          narration: `Private subnet in ${s.az || "—"} — no inbound route from the internet. Reachable only via load balancers in public subnets. Outbound traffic exits through a NAT.`,
          extra: `CIDR ${s.cidr || "—"}`,
        });

        const apps = (vpc.resources || []).filter(
          (r) => r.subnet === s.id && /^(ec2|asg|ecs|eks|lambda)$/.test(r.type),
        );
        apps.forEach((r) => out.push(narrateResource(r, vpc, "Application workload")));
      });

      // Data tier
      const data2 = (vpc.subnets || []).filter((s) => tier(s) === "data");
      data2.forEach((s) => {
        out.push({
          id: s.id,
          stage: "Data subnet",
          title: `${s.name || s.id} — data tier`,
          narration: `Restricted subnet in ${s.az || "—"}. Typically no internet egress at all — only reachable from app subnets, and only on database ports.`,
          extra: `CIDR ${s.cidr || "—"}`,
        });

        const dbs = (vpc.resources || []).filter(
          (r) => r.subnet === s.id && /^(rds|aurora|dynamodb)$/.test(r.type),
        );
        dbs.forEach((r) => out.push(narrateResource(r, vpc, "Stateful service")));
      });

      // Anything left behind (orphans)
      const seen = new Set(out.map((s) => s.id));
      (vpc.resources || []).forEach((r) => {
        if (!seen.has(r.id)) out.push(narrateResource(r, vpc, "Resource"));
      });
    });

    // End-of-tour summary step (no focus)
    out.push({
      id: null,
      stage: "End",
      title: "End of the tour",
      narration:
        "That's the whole path: internet → IGW → public subnet → load balancer → app subnet → app servers → data subnet → database. Outbound responses follow the reverse path; outbound-initiated traffic exits through NAT. Hover any element to revisit it.",
      extra: "Press ← to step back, or close to keep exploring on your own.",
    });

    return out;
  }

  function narrateResource(r, vpc, role) {
    const meta = (window.AWS_EXPLAIN && window.AWS_EXPLAIN[r.type]) || window.AWS_EXPLAIN.unknown;
    const data = AwsViz.getData() || {};
    const flows = (data.flows || []).filter((f) => f.from === r.id || f.to === r.id);
    const flowText = flows.length
      ? "Traffic involving this element: " +
        flows
          .map((f) => {
            const dir = f.from === r.id ? "→" : "←";
            const other = f.from === r.id ? f.to : f.from;
            return `${dir} ${other}${f.label ? " (" + f.label + ")" : ""}`;
          })
          .join(", ") +
        "."
      : "";
    return {
      id: r.id,
      stage: role,
      title: `${r.name || r.id} — ${meta.title}`,
      narration: `${meta.summary} ${flowText}`,
      extra: meta.bullets && meta.bullets.length ? meta.bullets[0] : "",
    };
  }

  // --- Tour control ----------------------------------------------------

  function open() {
    const data = AwsViz.getData();
    if (!data) return;
    steps = buildSteps(data);
    if (!steps.length) return;
    index = 0;
    els.bar.classList.add("open");
    // iOS Safari: speech synthesis needs to be unlocked from a user gesture.
    // The Start-tour click counts; speak a silent blip so subsequent calls work.
    if (speechSupported && speakEnabled) {
      try {
        const blip = new SpeechSynthesisUtterance(" ");
        blip.volume = 0;
        synth.speak(blip);
      } catch (_) {}
    }
    play();
  }

  function close() {
    pause();
    els.bar.classList.remove("open");
    AwsViz.clearHighlight();
    AwsViz.resetZoom();
  }

  function play() {
    if (!steps.length) return;
    playing = true;
    setPlayIcon();
    show(index, true);
  }

  function pause() {
    playing = false;
    setPlayIcon();
    if (timer) clearTimeout(timer);
    timer = null;
    stopSpeaking();
    freezeProgress();
  }

  function toggle() {
    playing ? pause() : play();
  }

  function next() {
    if (index >= steps.length - 1) {
      pause();
      return;
    }
    index++;
    show(index, true);
  }

  function prev() {
    if (index <= 0) return;
    index--;
    show(index, true);
  }

  function advanceFromTimer() {
    timer = null;
    if (!playing) return;
    if (index >= steps.length - 1) pause();
    else next();
  }

  function composeText(step) {
    if (!step) return "";
    return [step.title, step.narration, step.extra].filter(Boolean).join(". ");
  }

  function freezeProgress() {
    const span = els.progress.querySelector("span");
    if (!span) return;
    const rect = span.getBoundingClientRect();
    const parent = els.progress.getBoundingClientRect();
    els.progress.classList.remove("advance");
    span.style.transitionDuration = "0s";
    span.style.right = parent.width > 0
      ? `${100 - (rect.width / parent.width) * 100}%`
      : "100%";
  }

  function resetProgress() {
    const span = els.progress.querySelector("span");
    if (!span) return;
    els.progress.classList.remove("advance");
    span.style.transitionDuration = "0s";
    span.style.right = "100%";
  }

  function animateProgress(ms) {
    const span = els.progress.querySelector("span");
    if (!span) return;
    els.progress.classList.remove("advance");
    span.style.transitionDuration = "0s";
    span.style.right = "100%";
    // Force reflow so the next transition kicks in
    void span.offsetWidth;
    span.style.transitionDuration = `${ms}ms`;
    els.progress.classList.add("advance");
    span.style.right = "0%";
  }

  function show(i, animate) {
    const step = steps[i];
    if (!step) return;
    els.stage.textContent = step.stage || "";
    els.stepCount.textContent = `${i + 1} / ${steps.length}`;
    els.title.textContent = step.title;
    els.narration.textContent = step.narration;
    els.extra.textContent = step.extra || "";

    els.prev.toggleAttribute("disabled", i === 0);
    els.next.toggleAttribute("disabled", i === steps.length - 1);

    if (timer) { clearTimeout(timer); timer = null; }
    stopSpeaking();
    resetProgress();

    const in3D = window.AwsMode && window.AwsMode.is3D() && window.AwsViz3D && window.AwsViz3D.isReady();
    if (step.id) {
      // 2D side: keep the spotlight in sync even if hidden, in case user toggles mid-tour.
      AwsViz.highlight(step.id);
      AwsViz.focus(step.id, { duration: animate ? 700 : 400, pad: 120 });
      if (in3D) {
        window.AwsViz3D.focus(step.id, { duration: animate ? 1500 : 700 });
      }
    } else {
      AwsViz.clearHighlight();
      AwsViz.resetZoom();
      if (in3D) window.AwsViz3D.clearFocus();
    }

    const text = composeText(step);
    let estMs = STEP_MS;
    let usingSpeech = false;

    if (speakEnabled && speechSupported && text) {
      usingSpeech = true;
      estMs = speak(text, () => {
        // Speech ended (or errored): if we're still playing on this step, advance.
        if (!playing || index !== i) return;
        if (timer) { clearTimeout(timer); timer = null; }
        // Brief pause between steps so the spoken sentences don't run together.
        setTimeout(() => {
          if (playing && index === i) advanceFromTimer();
        }, 450);
      });
    }

    if (playing) {
      // Schedule a fallback advance in case onend never fires (e.g. browser
      // dropped the utterance). Use a generous buffer past the speech estimate.
      const fallbackMs = usingSpeech ? estMs + 2500 : STEP_MS;
      timer = setTimeout(advanceFromTimer, fallbackMs);
      // The progress bar visually tracks the *speech* (or the fixed step time).
      animateProgress(usingSpeech ? estMs : STEP_MS);
    }
  }

  function setPlayIcon() {
    els.playIcon.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
  }

  // --- Wire up events --------------------------------------------------

  els.start.addEventListener("click", open);
  els.play.addEventListener("click", toggle);
  els.next.addEventListener("click", next);
  els.prev.addEventListener("click", prev);
  els.close.addEventListener("click", close);

  // Speech toggle
  els.speak.addEventListener("click", () => {
    if (!speechSupported) return;
    speakEnabled = !speakEnabled;
    localStorage.setItem("aws-viz.speak", speakEnabled ? "1" : "0");
    reflectSpeakState();
    // If turning off mid-step, stop talking immediately. If turning on while
    // a step is showing, re-speak the current step.
    if (!speakEnabled) {
      stopSpeaking();
    } else if (els.bar.classList.contains("open")) {
      show(index, false);
    }
  });

  // Voice picker popover toggle
  els.voice.addEventListener("click", (e) => {
    e.stopPropagation();
    els.voicePopover.hidden = !els.voicePopover.hidden;
  });
  document.addEventListener("click", (e) => {
    if (els.voicePopover.hidden) return;
    if (els.voicePopover.contains(e.target) || els.voice.contains(e.target)) return;
    els.voicePopover.hidden = true;
  });

  els.voiceSelect.addEventListener("change", () => {
    selectedVoiceURI = els.voiceSelect.value;
    localStorage.setItem("aws-viz.voice", selectedVoiceURI);
    // Re-speak current step with the new voice for instant feedback
    if (speakEnabled && els.bar.classList.contains("open")) show(index, false);
  });

  els.voiceRate.addEventListener("input", () => {
    speechRate = parseFloat(els.voiceRate.value) || 1;
    els.voiceRateVal.textContent = `${speechRate.toFixed(2)}×`;
    localStorage.setItem("aws-viz.rate", String(speechRate));
  });
  els.voiceRate.addEventListener("change", () => {
    if (speakEnabled && els.bar.classList.contains("open")) show(index, false);
  });

  document.addEventListener("keydown", (e) => {
    if (!els.bar.classList.contains("open")) return;
    // Don't hijack typing in form fields
    const tag = (e.target && e.target.tagName) || "";
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
    if (e.key === "ArrowRight") { e.preventDefault(); next(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    else if (e.key === " ") { e.preventDefault(); toggle(); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "m" || e.key === "M") { e.preventDefault(); els.speak.click(); }
  });

  // Cancel speech if the user navigates away or hides the tab for a while.
  window.addEventListener("beforeunload", stopSpeaking);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && currentUtter) stopSpeaking();
  });

  // Expose for debugging
  window.AwsTour = { open, close, play, pause, next, prev };
})();
