// ZeroBias *platform-ops* client + SME-marketplace board/task/workflow mapping.
//
// The boundary GraphQL endpoint (adapter/zerobias-graphql.js) only returns native
// AWS inventory (AwsVpc / AwsIamUser / …). Boards, tasks, workflows, projects and
// economics are PLATFORM objects (ZeroBias schema → package/w3geekery/smemart):
// SmeMartBoard, SmeMartTask, SmeMartActivity, SmeMartWorkflow, platform.Project,
// Bid, ServiceOffering, ProviderProduct. They are NOT in the boundary GraphQL —
// this module is the platform path the brief asked for.
//
// LIVE transport (confirmed working against api.uat.zerobias.com; CORS is open —
// access-control-allow-origin: * — so the browser can call it directly):
//
//   POST https://<host>/portal/myTasks   body: {}
//   headers: Authorization: APIKey <key>, dana-org-id: <org>, Content-Type: json
//
// returns the signed-in org's assigned SmeMartTask records, each EMBEDDING its
// board, activity, workflow (statuses + transitions), boundary, nextTransitions,
// statusInfo{phase}, phaseCode, priority, links and customFields. That single
// aggregator fully backs the assessor board (lanes + cards) and the lifecycle
// pipeline with real data.
//
// NOT reachable from the browser/REST on this tenant (they need the `zb` MCP's
// platform.* operation routing, which the static app can't invoke):
//   • SmeMartBoard.partition / scope  (board detail)
//   • platform.Project budgets, SmeMartActivity.estimatedTime
//   • Bid, ServiceOffering, ProviderProduct
// So the ECONOMICS roll-up, the OPPORTUNITIES strip and the SME PROFILE scoping
// use a clearly-labelled SAMPLE rate card / sample RFP+bid records / sample
// provider claims. They are flagged `sample:true` and must never be shown as the
// user's real money. Live task structure stays real; only the $ overlay is sample.
//
// Runs in Node (CLI snapshot generation, via module.exports) and the browser
// (window.ZeroBiasPlatform), mirroring how zerobias-graphql.js is shared.
"use strict";
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZeroBiasPlatform = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DEFAULT_HOST = "api.uat.zerobias.com";

  // ---- transport --------------------------------------------------------

  function connFromEnv(env) {
    env = env || (typeof process !== "undefined" && process.env) || {};
    return {
      host: env.ZEROBIAS_GQL_HOST || DEFAULT_HOST,
      apiKey: env.ZEROBIAS_API_KEY || null,
      orgId: env.ZEROBIAS_ORG_ID || null,
    };
  }

  // Pull the signed-in org's real tasks. Returns the raw array (possibly empty —
  // the honest answer) or throws on a transport/auth failure so the caller can
  // show an explicit error state rather than fabricating tasks.
  async function fetchMyTasks(conn) {
    if (!conn || !conn.apiKey || !conn.orgId) {
      throw new Error("platform myTasks needs apiKey + orgId (ZEROBIAS_API_KEY/ORG_ID).");
    }
    const url = `https://${conn.host || DEFAULT_HOST}/portal/myTasks`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `APIKey ${conn.apiKey}`,
        "dana-org-id": conn.orgId,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: "{}",
    });
    if (!res.ok) throw new Error(`myTasks HTTP ${res.status}`);
    const arr = await res.json();
    return Array.isArray(arr) ? arr : [];
  }

  // ---- task mapping -----------------------------------------------------

  // SmeMartTask.priority is {label,value}; value is a rank where lower = hotter.
  function priorityLevel(value) {
    if (value == null) return "medium";
    if (value < 150) return "critical";
    if (value < 200) return "high";
    if (value === 200) return "medium";
    return "low";
  }

  // Normalise a raw /portal/myTasks record into the board's task model. Keeps the
  // embedded board / activity / workflow / boundary so the board + lifecycle can
  // render entirely from this one payload.
  function mapTask(t, source) {
    t = t || {};
    const pv = t.priority && typeof t.priority === "object" ? t.priority.value : null;
    const wf = t.workflow || null;
    const cf = t.customFields || {};
    const product =
      cf.productName ||
      ((t.links || []).find((l) => l && (l.type === "boundary_product" || l.type === "product")) || {}).name ||
      null;
    return {
      id: t.id,
      code: t.code || t.id,
      name: t.name || t.code || t.id,
      description: t.description || firstLinkDescription(t) || "",
      status: String(t.status || "todo"),
      statusName: (t.statusInfo && t.statusInfo.name) || statusLabel(t.status),
      phase: t.phaseCode || (t.statusInfo && t.statusInfo.phase && t.statusInfo.phase.code) || null,
      phaseName: (t.statusInfo && t.statusInfo.phase && t.statusInfo.phase.name) || null,
      priority: { value: pv, label: (t.priority && t.priority.label) || null, level: priorityLevel(pv) },
      rank: t.rank || null,
      boardId: t.boardId || (t.board && t.board.id) || null,
      board: t.board || null,
      activity: t.activity
        ? {
            id: t.activity.id,
            code: t.activity.code,
            name: t.activity.name,
            type: t.activity.activityType || t.activity.type || null,
            workflowId: t.activity.workflowId || (wf && wf.id) || null,
            description: t.activity.description || null,
          }
        : null,
      workflow: wf ? { id: wf.id, name: wf.name, statuses: wf.statuses || [], transitions: wf.transitions || [] } : null,
      nextTransitions: (t.nextTransitions || []).map((x) => ({
        id: x.id, name: x.name, status: x.status, fromStatus: x.fromStatus || [], approval: !!x.approval,
      })),
      boundaryId: t.boundaryId || (t.boundary && t.boundary.id) || null,
      boundary: t.boundary || null,
      product,
      custom: cf,
      links: t.links || [],
      approver: pickApprover(t),
      created: t.created || null,
      updated: t.updated || null,
      // partition (swim-lane in the marketplace sense) is not exposed on
      // /portal/myTasks for this tenant — it lives on the board-detail object the
      // browser can't reach. Left null for live; sample boards may set it.
      partition: t.partition || null,
      source: source || "live",
    };
  }

  function firstLinkDescription(t) {
    const l = (t.links || []).find((x) => x && x.description);
    return l ? l.description : "";
  }
  function pickApprover(t) {
    const a = (t.approvers || [])[0];
    return a ? a.contactName || a.teamId || null : null;
  }

  // ---- status / phase / lane metadata ----------------------------------

  // Display metadata for the Software-Development-Lifecycle statuses (and common
  // synonyms). Order is the canonical left→right board column order.
  const STATUS_META = {
    init:              { label: "Init",        order: -1, color: "#64748b", hideEmpty: true },
    incoming:          { label: "Incoming",    order: 0,  color: "#64748b", hideEmpty: true },
    draft:             { label: "Draft",        order: 0,  color: "#64748b" },
    prototype:         { label: "Prototype",    order: 0,  color: "#38bdf8" },
    todo:              { label: "To Do",        order: 1,  color: "#38bdf8" },
    open:              { label: "Open",         order: 1,  color: "#38bdf8" },
    test:              { label: "Test",         order: 2,  color: "#22d3ee" },
    in_progress:       { label: "In Progress",  order: 2,  color: "#f59e0b" },
    validate:          { label: "Validate",     order: 3,  color: "#f59e0b" },
    "in-progress":     { label: "In Progress",  order: 2,  color: "#f59e0b" },
    awaiting_approval: { label: "In Review",    order: 3,  color: "#a78bfa" },
    in_review:         { label: "In Review",    order: 3,  color: "#a78bfa" },
    "in-review":       { label: "In Review",    order: 3,  color: "#a78bfa" },
    done:              { label: "Done",         order: 5,  color: "#22c55e" },
    complete:          { label: "Done",         order: 5,  color: "#22c55e" },
    completed:         { label: "Done",         order: 5,  color: "#22c55e" },
    published:         { label: "Published",    order: 5,  color: "#22c55e" },
    closed:            { label: "Closed",       order: 5,  color: "#22c55e" },
    cancelled:         { label: "Cancelled",    order: 6,  color: "#ef4444", hideEmpty: true },
    canceled:          { label: "Cancelled",    order: 6,  color: "#ef4444", hideEmpty: true },
  };
  function statusLabel(s) {
    const m = STATUS_META[String(s || "").toLowerCase()];
    return m ? m.label : titleCase(s);
  }
  function statusColor(s) {
    const m = STATUS_META[String(s || "").toLowerCase()];
    return m ? m.color : "#8b9bbb";
  }
  function titleCase(s) {
    return String(s || "").replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // The marketplace swim-lanes (SmeMartBoard.partition). AUDIT = third-party
  // assessor tasks (the default lane for this assessor view). Kept as metadata so
  // partition-grouped boards render with stable labels/colours when the data has
  // them; live myTasks does not populate partition on this tenant.
  const PARTITION_LANES = [
    { key: "AUDIT", label: "Audit", color: "#7c5cff", desc: "Third-party assessor tasks" },
    { key: "PROVIDER", label: "Provider", color: "#22d3ee", desc: "Work you deliver as a provider" },
    { key: "BUYER", label: "Buyer", color: "#f59e0b", desc: "Work you commission as a buyer" },
    { key: "SHARED", label: "Shared", color: "#4dd4ac", desc: "Joint buyer/provider tasks" },
    { key: "ENGAGEMENT_SETUP", label: "Engagement setup", color: "#38bdf8", desc: "Stand up the engagement" },
    { key: "CLOSEOUT", label: "Closeout", color: "#a78bfa", desc: "Wrap-up & sign-off" },
  ];
  const PARTITION_BY_KEY = PARTITION_LANES.reduce((m, l) => ((m[l.key] = l), m), {});

  // ---- board model ------------------------------------------------------

  // Columns are always the workflow statuses (the real Kanban axis). The union is
  // taken across every task's workflow so a board spanning multiple workflows
  // still renders one coherent set of columns, ordered by STATUS_META.
  function statusColumns(tasks) {
    const seen = new Map(); // key -> {key,label,color}
    tasks.forEach((t) => {
      const order = (t.workflow && t.workflow.statuses) || [t.status];
      order.forEach((s) => {
        const key = String(s || "").toLowerCase();
        if (!key || key === "init") return;
        if (!seen.has(key)) seen.set(key, { key, label: statusLabel(key), color: statusColor(key) });
      });
      const key = String(t.status || "").toLowerCase();
      if (key && key !== "init" && !seen.has(key)) seen.set(key, { key, label: statusLabel(key), color: statusColor(key) });
    });
    return Array.from(seen.values()).sort((a, b) => colOrder(a.key) - colOrder(b.key));
  }
  function colOrder(key) {
    const m = STATUS_META[key];
    return m ? m.order : 50;
  }

  // Swim-lanes (rows). axis ∈ {board, partition, phase, none}. Returns lanes that
  // each carry the subset of tasks belonging to that lane.
  function swimLanes(tasks, axis) {
    if (axis === "partition") {
      const lanes = [];
      PARTITION_LANES.forEach((l) => {
        const ts = tasks.filter((t) => t.partition === l.key);
        if (ts.length) lanes.push({ key: l.key, label: l.label, color: l.color, desc: l.desc, tasks: ts });
      });
      const known = new Set(PARTITION_LANES.map((l) => l.key));
      const others = tasks.filter((t) => t.partition && !known.has(t.partition));
      if (others.length) lanes.push({ key: "OTHER", label: "Other", color: "#8b9bbb", desc: "", tasks: others });
      // Tasks with no partition (e.g. live /portal/myTasks, which doesn't expose
      // it) go in an honest "Unassigned" lane rather than being fabricated into a
      // marketplace partition.
      const unspec = tasks.filter((t) => !t.partition);
      if (unspec.length) {
        lanes.push({
          key: "UNSPEC", label: "Unassigned lane", color: "#8b9bbb",
          desc: "No partition (BUYER/PROVIDER/AUDIT…) set — board-detail/partition isn't reachable from the browser here.",
          tasks: unspec,
        });
      }
      return lanes.length ? lanes : [{ key: "UNSPEC", label: "Unassigned lane", color: "#8b9bbb", desc: "", tasks: tasks.slice() }];
    }
    if (axis === "phase") {
      const map = new Map();
      tasks.forEach((t) => {
        const key = t.phase || "open";
        if (!map.has(key)) map.set(key, { key, label: t.phaseName || titleCase(key), color: statusColor(key), tasks: [] });
        map.get(key).tasks.push(t);
      });
      return Array.from(map.values());
    }
    if (axis === "board") {
      const map = new Map();
      tasks.forEach((t) => {
        const key = t.boardId || "none";
        if (!map.has(key)) {
          map.set(key, {
            key, label: (t.board && t.board.name) || "Board", color: "#7c5cff",
            desc: (t.board && t.board.description) || "", tasks: [],
          });
        }
        map.get(key).tasks.push(t);
      });
      return Array.from(map.values());
    }
    return [{ key: "all", label: "All tasks", color: "#7c5cff", desc: "", tasks: tasks.slice() }];
  }

  const OPEN_STATUSES_CLOSED = ["done", "closed", "resolved", "complete", "completed", "cancelled", "canceled"];
  const isOpen = (t) => !OPEN_STATUSES_CLOSED.includes(String(t.status).toLowerCase());

  // Build the full board model: swim-lanes × status-columns, with per-cell tasks,
  // per-lane economics and board totals. `rateCard` drives the (sample) $ roll-up.
  function buildBoard(tasks, opts) {
    opts = opts || {};
    const laneAxis = opts.laneAxis || "board";
    const rateCard = opts.rateCard || SAMPLE_RATE_CARD;
    const withEcon = opts.economics !== false;
    if (withEcon) tasks.forEach((t) => { t.econ = estimateValue(t, rateCard); });

    const columns = statusColumns(tasks);
    const lanes = swimLanes(tasks, laneAxis).map((lane) => {
      const byStatus = {};
      columns.forEach((c) => (byStatus[c.key] = []));
      lane.tasks.forEach((t) => {
        const k = String(t.status).toLowerCase();
        (byStatus[k] || (byStatus[k] = [])).push(t);
      });
      const value = lane.tasks.reduce((s, t) => s + ((t.econ && t.econ.value) || 0), 0);
      return {
        ...lane,
        byStatus,
        count: lane.tasks.length,
        openCount: lane.tasks.filter(isOpen).length,
        value,
      };
    });
    const all = tasks;
    return {
      laneAxis,
      columns,
      lanes,
      sampleEconomics: withEcon,
      total: {
        count: all.length,
        open: all.filter(isOpen).length,
        value: all.reduce((s, t) => s + ((t.econ && t.econ.value) || 0), 0),
      },
    };
  }

  // ---- economics (SAMPLE) ----------------------------------------------
  //
  // Real rolled-up value = task → activity.estimatedTime → project.budgetType/rate.
  // Those fields aren't reachable from the browser on this tenant, so this is an
  // explicit, labelled SAMPLE rate card keyed by activity code. Every value it
  // produces is flagged `sample:true`; the UI badges it amber and never presents
  // it as the user's real money.
  const SAMPLE_RATE_CARD = {
    currency: "USD",
    default: { hours: 3, rate: 150 },
    byActivity: {
      boSetupConn: { hours: 2.5, rate: 150 },     // "Setup a connection for <product>"
      boSetupPipeline: { hours: 6, rate: 165 },   // "Setup a pipeline for <product>"
      task: { hours: 1, rate: 120 },
      // sample-board activities (data/zerobias/board-sample.json)
      assessControl: { hours: 4, rate: 175 },
      publishGuild: { hours: 8, rate: 160 },
      remediate: { hours: 5, rate: 170 },
      engagementSetup: { hours: 2.5, rate: 150 },
      closeout: { hours: 2, rate: 140 },
      reviewSignoff: { hours: 1.5, rate: 200 },
    },
  };

  function estimateValue(task, rateCard) {
    rateCard = rateCard || SAMPLE_RATE_CARD;
    const code = (task.activity && task.activity.code) || null;
    const base = (code && rateCard.byActivity[code]) || rateCard.default;
    const hours = base.hours;
    const rate = base.rate;
    return {
      hours, rate, currency: rateCard.currency || "USD",
      value: Math.round(hours * rate),
      basis: code ? `${code} · ${hours}h @ $${rate}/h` : `${hours}h @ $${rate}/h`,
      sample: true,
    };
  }

  // ---- opportunities (SAMPLE) ------------------------------------------
  //
  // The brief's "I've got $1000 sitting here": open Bid / published platform.Project
  // (RFP) records. Not reachable from the browser here, so these are labelled
  // sample opportunities. Products/frameworks line up with the real task set so
  // the SME-scoping demo (WS5) is coherent.
  const SAMPLE_OPPORTUNITIES = [
    { id: "rfp-ksi-logging", title: "FedRAMP KSI — centralised logging assessment", price: 1000, hours: 6, pricingModel: "HOURLY", framework: "FedRAMP 20x", product: "AWS Security Hub", buyer: "GovCloud SaaS Co.", validUntil: "2026-07-15", source: "sample" },
    { id: "rfp-iam-mfa", title: "IAM / MFA hardening review — 4 products", price: 4500, hours: 30, pricingModel: "FIXED", framework: "NIST 800-53", product: "AWS Identity and Access Management", buyer: "Northwind Retail", validUntil: "2026-07-02", source: "sample" },
    { id: "rfp-soc2", title: "SOC 2 Type II readiness — AWS boundary", price: 24000, hours: 160, pricingModel: "FIXED", framework: "SOC 2", product: "Amazon EC2", buyer: "Acme Corporation", validUntil: "2026-08-01", source: "sample" },
    { id: "rfp-monitoring", title: "Continuous-monitoring retainer", price: 3000, hours: 20, pricingModel: "RETAINER", framework: "ISO 27001", product: "Amazon S3", buyer: "Globex", validUntil: "2026-09-01", source: "sample" },
  ];

  // ---- SME provider profile (SAMPLE) -----------------------------------
  //
  // ProviderProduct / ProviderFramework claims ("4 products I know intimately").
  // Used to score which opportunities/lanes surface (WS5). Sample — the real
  // claims live behind ProviderProduct.list (MCP-only here).
  const SAMPLE_PROVIDER_PROFILE = {
    sample: true,
    products: [
      { name: "Amazon EC2", proficiency: "expert", years: 8, certified: true, verified: true },
      { name: "AWS Identity and Access Management", proficiency: "expert", years: 7, certified: true, verified: true },
      { name: "Amazon S3", proficiency: "advanced", years: 6, certified: true, verified: false },
      { name: "AWS Security Hub", proficiency: "intermediate", years: 3, certified: false, verified: false },
    ],
    frameworks: [
      { name: "SOC 2", assessorCertified: true },
      { name: "NIST 800-53", assessorCertified: true },
      { name: "FedRAMP 20x", assessorCertified: false },
      { name: "ISO 27001", assessorCertified: false },
    ],
  };

  // Score an opportunity against the (sample) provider profile: matches on product
  // and framework. Returns {score, reasons[]} so the UI can sort + explain.
  function scoreOpportunity(op, profile) {
    profile = profile || SAMPLE_PROVIDER_PROFILE;
    const reasons = [];
    let score = 0;
    const prod = profile.products.find((p) => p.name === op.product);
    if (prod) {
      score += prod.proficiency === "expert" ? 3 : prod.proficiency === "advanced" ? 2 : 1;
      if (prod.verified) score += 1;
      reasons.push(`${prod.proficiency} in ${op.product}`);
    }
    const fw = profile.frameworks.find((f) => f.name === op.framework);
    if (fw) {
      score += fw.assessorCertified ? 2 : 1;
      reasons.push(fw.assessorCertified ? `assessor-certified for ${op.framework}` : `familiar with ${op.framework}`);
    }
    return { score, reasons };
  }

  // ---- workflow helpers (lifecycle, WS3) -------------------------------

  // Ordered, display-ready statuses for a workflow's pipeline (drops init).
  function pipelineStatuses(workflow) {
    const list = (workflow && workflow.statuses) || [];
    return list
      .filter((s) => String(s).toLowerCase() !== "init")
      .map((s) => ({ key: String(s).toLowerCase(), label: statusLabel(s), color: statusColor(s) }));
  }
  // Public, non-init transitions leaving `status` (the user's valid next moves).
  function transitionsFrom(workflow, status) {
    const cur = String(status || "").toLowerCase();
    return ((workflow && workflow.transitions) || []).filter(
      (tr) => !tr.isPrivate && (tr.fromStatus || []).map((s) => String(s).toLowerCase()).includes(cur),
    );
  }

  return {
    DEFAULT_HOST,
    connFromEnv,
    fetchMyTasks,
    mapTask,
    priorityLevel,
    statusLabel,
    statusColor,
    STATUS_META,
    PARTITION_LANES,
    PARTITION_BY_KEY,
    statusColumns,
    swimLanes,
    isOpen,
    buildBoard,
    estimateValue,
    SAMPLE_RATE_CARD,
    SAMPLE_OPPORTUNITIES,
    SAMPLE_PROVIDER_PROFILE,
    scoreOpportunity,
    pipelineStatuses,
    transitionsFrom,
  };
});
