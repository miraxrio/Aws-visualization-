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

function parseArgs(argv) {
  const args = { endpoint: {} };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--live") args.live = true;
    else if (a === "--identity") args.identity = true;
    else if (a === "--pretty") args.pretty = true;
    else if (a === "--in") args.in = argv[++i];
    else if (a === "--out") args.out = argv[++i];
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
  --live               fetch from a live ZeroBias tenant instead of --in
  --endpoint k=path    override a live collection path (repeatable)
  --identity           add the identity/access overlay (principals + permissions)
  --identity-type <t>  visualizer type for principal nodes (default: ec2)
  --pretty             pretty-print the output
  -h, --help           this message

Live auth (env): ZEROBIAS_API_KEY, ZEROBIAS_ORG_ID, [ZEROBIAS_BASE_URL]`;

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(HELP);
    return;
  }

  const outPath = args.out || path.join(__dirname, "zerobias-network.json");
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

  const net = transform(zb, { identity: args.identity, identityType: args.identityType });

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
