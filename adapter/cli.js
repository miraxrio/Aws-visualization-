#!/usr/bin/env node
// CLI: turn a ZeroBias export into a visualizer network file.
//
//   node adapter/cli.js                         # sample export -> zerobias-network.json
//   node adapter/cli.js --in export.json --out net.json
//   node adapter/cli.js --identity              # include the identity/access overlay
//   node adapter/cli.js --live                  # pull from a live ZeroBias tenant (needs creds)
//   node adapter/cli.js --live --endpoint assets=/my/assets/path
//
// Auth for --live (see adapter/live.js): ZEROBIAS_API_KEY + ZEROBIAS_ORG_ID.
"use strict";

const fs = require("fs");
const path = require("path");
const { transform, validate } = require("./zerobias-adapter");
const live = require("./live");
const graphql = require("./zerobias-graphql");

function parseArgs(argv) {
  const args = { endpoint: {} };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--live") args.live = true;
    else if (a === "--graphql" || a === "--aws") args.graphql = true;
    else if (a === "--introspect") args.introspect = true;
    else if (a === "--identity") args.identity = true;
    else if (a === "--pretty") args.pretty = true;
    else if (a === "--in") args.in = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--boundary") args.boundary = argv[++i];
    else if (a === "--host") args.host = argv[++i];
    else if (a === "--page-size") args.pageSize = Number(argv[++i]);
    else if (a === "--identity-type") args.identityType = argv[++i];
    else if (a === "--endpoint") {
      const [k, v] = String(argv[++i] || "").split("=");
      if (k && v) args.endpoint[k] = v;
    } else if (a === "-h" || a === "--help") args.help = true;
  }
  return args;
}

const HELP = `ZeroBias → Network Visualizer adapter

Usage: node adapter/cli.js [options]

  --in <file>          ZeroBias export JSON (default: adapter/sample-zerobias-export.json)
  --out <file>         output network JSON (default: adapter/zerobias-network.json)
  --graphql, --aws     pull native AWS inventory via the ZeroBias boundaries GraphQL API
  --boundary <id>      boundary id for --graphql (or env ZEROBIAS_BOUNDARY_ID)
  --host <host>        GraphQL host (default ${graphql.DEFAULT_HOST})
  --page-size <n>      GraphQL pageSize (default 100)
  --introspect         list the boundary's GraphQL query fields (discover Aws* types) and exit
  --live               fetch from a live ZeroBias tenant (generic asset model) instead of --in
  --endpoint k=path    override a live collection path (repeatable)
  --identity           add the identity/access overlay (principals / IAM users)
  --identity-type <t>  visualizer type for principal nodes (default: ec2)
  --pretty             pretty-print the output
  -h, --help           this message

Auth (env): ZEROBIAS_API_KEY, ZEROBIAS_ORG_ID [, ZEROBIAS_BOUNDARY_ID, ZEROBIAS_GQL_HOST]`;

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(HELP);
    return;
  }

  const outPath = args.out || path.join(__dirname, "zerobias-network.json");
  let net;

  // ---- GraphQL / AWS-inventory path ----
  if (args.introspect || args.graphql) {
    const conn = graphql.connFromEnv();
    if (args.host) conn.host = args.host;
    if (args.boundary) conn.boundaryId = args.boundary;
    if (args.pageSize) conn.pageSize = args.pageSize;

    if (args.introspect) {
      const data = await graphql.gql(conn, graphql.INTROSPECT_FIELDS);
      const fields = ((data.__schema || {}).queryType || {}).fields || [];
      const aws = fields.map((f) => f.name).filter((n) => /^Aws/.test(n));
      console.log(`• ${fields.length} query fields (${aws.length} Aws*):`);
      console.log("  " + (aws.length ? aws.join("\n  ") : fields.map((f) => f.name).join("\n  ")));
      return;
    }

    let raw;
    if (args.in) {
      // Treat --in as pre-fetched, per-type inventory JSON (offline testing or
      // a saved dump). No network needed.
      raw = JSON.parse(fs.readFileSync(args.in, "utf8"));
      console.log(`• Loaded AWS inventory: ${path.relative(process.cwd(), args.in)}`);
    } else {
      if (!conn.apiKey || !conn.orgId || !conn.boundaryId) {
        console.error("✗ --graphql needs ZEROBIAS_API_KEY, ZEROBIAS_ORG_ID and --boundary <id> (or ZEROBIAS_BOUNDARY_ID).");
        process.exit(2);
      }
      console.log(`• Querying ${conn.host} boundary ${conn.boundaryId} …`);
      raw = await graphql.fetchInventory(conn);
      if (raw._warnings) raw._warnings.forEach((w) => console.warn("  ! " + w));
    }
    net = graphql.awsInventoryToVisualizer(raw, { identity: args.identity, identityType: args.identityType });
    finish(net, outPath, args);
    return;
  }

  let zb;
  if (args.live) {
    if (!live.hasCreds()) {
      console.error(
        "✗ --live requires ZEROBIAS_API_KEY and ZEROBIAS_ORG_ID in the environment.\n" +
          "  Set them, or drop --live to use a local export file. See adapter/README.md.",
      );
      process.exit(2);
    }
    console.log("• Fetching live data from ZeroBias …");
    zb = await live.fetchExport({ paths: args.endpoint });
    if (zb._warnings && zb._warnings.length) {
      zb._warnings.forEach((w) => console.warn("  ! " + w));
    }
  } else {
    const inPath = args.in || path.join(__dirname, "sample-zerobias-export.json");
    if (!fs.existsSync(inPath)) {
      console.error(`✗ input not found: ${inPath}`);
      process.exit(2);
    }
    zb = JSON.parse(fs.readFileSync(inPath, "utf8"));
    console.log(`• Loaded export: ${path.relative(process.cwd(), inPath)}`);
  }

  net = transform(zb, { identity: args.identity, identityType: args.identityType });
  finish(net, outPath, args);
}

function finish(net, outPath, args) {
  const problems = validate(net);
  const counts = net.vpcs.reduce(
    (acc, v) => {
      acc.subnets += (v.subnets || []).length;
      acc.gateways += (v.gateways || []).length;
      acc.resources += (v.resources || []).length;
      return acc;
    },
    { subnets: 0, gateways: 0, resources: 0 },
  );

  fs.writeFileSync(outPath, JSON.stringify(net, null, args.pretty ? 2 : 0));
  console.log(`✓ Wrote ${path.relative(process.cwd(), outPath)}`);
  console.log(
    `  ${net.vpcs.length} VPC(s) · ${counts.subnets} subnets · ${counts.gateways} gateways · ` +
      `${counts.resources} resources · ${net.flows.length} flows`,
  );
  if (problems.length) {
    console.warn("  ⚠ validation notes:");
    problems.forEach((p) => console.warn("    - " + p));
  } else {
    console.log("  ✓ validates against the visualizer schema");
  }
  console.log(`\nLoad it: open index.html → “Import network” → choose ${path.basename(outPath)} (or drag it onto the canvas).`);
}

main().catch((err) => {
  console.error("✗ " + (err && err.stack ? err.stack : err));
  process.exit(1);
});
