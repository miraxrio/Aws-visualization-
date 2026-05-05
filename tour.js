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
    scheduleAdvance();
  }

  function pause() {
    playing = false;
    setPlayIcon();
    if (timer) clearTimeout(timer);
    timer = null;
    // Freeze the progress bar at its current position
    const span = els.progress.querySelector("span");
    if (span) {
      const rect = span.getBoundingClientRect();
      const parent = els.progress.getBoundingClientRect();
      els.progress.classList.remove("advance");
      span.style.transitionDuration = "0s";
      span.style.right = `${100 - (rect.width / parent.width) * 100}%`;
    }
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
    show(index, playing);
    if (playing) scheduleAdvance();
  }

  function prev() {
    if (index <= 0) return;
    index--;
    show(index, playing);
    if (playing) scheduleAdvance();
  }

  function scheduleAdvance() {
    if (timer) clearTimeout(timer);
    if (!playing) return;
    timer = setTimeout(() => {
      if (index >= steps.length - 1) {
        pause();
      } else {
        next();
      }
    }, STEP_MS);
    animateProgress(STEP_MS);
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

    if (step.id) {
      AwsViz.highlight(step.id);
      AwsViz.focus(step.id, { duration: animate ? 700 : 400, pad: 120 });
    } else {
      AwsViz.clearHighlight();
      AwsViz.resetZoom();
    }

    if (!animate) {
      const span = els.progress.querySelector("span");
      if (span) {
        els.progress.classList.remove("advance");
        span.style.transitionDuration = "0s";
        span.style.right = "100%";
      }
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

  document.addEventListener("keydown", (e) => {
    if (!els.bar.classList.contains("open")) return;
    // Don't hijack typing in form fields
    const tag = (e.target && e.target.tagName) || "";
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
    if (e.key === "ArrowRight") { e.preventDefault(); next(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    else if (e.key === " ") { e.preventDefault(); toggle(); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  });

  // Expose for debugging
  window.AwsTour = { open, close, play, pause, next, prev };
})();
