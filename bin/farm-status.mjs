// PrinterFarm CLI — check status across your printer farm.
//
// Usage:
//   node bin/farm-status.mjs
//   node bin/farm-status.mjs 192.168.137.10 192.168.137.78

import { readFileSync, existsSync } from "node:fs";
import { probe, judge } from "../lib/probe.mjs";

const PRINTERS_JSON = "printers.json";
const ipArgs = process.argv.slice(2);
let printers = ipArgs.map((ip, i) => ({ id: String(i + 1), ip }));

if (printers.length === 0 && existsSync(PRINTERS_JSON)) {
  printers = JSON.parse(readFileSync(PRINTERS_JSON, "utf8"));
}

if (printers.length === 0) {
  console.error("usage: node bin/farm-status.mjs <ip> [ip...]   (or create printers.json)");
  process.exit(1);
}

console.log("");
console.log("id    ip                status      job");
console.log("----  ----------------  ----------  -------------------------");

async function run() {
  // Dispatch concurrent network probes
  const networkPromises = printers.map(p => probe(p));
  
  // Await resolution or timeouts
  const rawResults = await Promise.all(networkPromises);

  // Evaluate state and render output
  for (const raw of rawResults) {
    const final = judge(raw);
    console.log(
      `${final.id.padEnd(4)}  ` +
      `${final.ip.padEnd(16)}  ` +
      `${final.farmState.padEnd(10)}  ` +
      `${final.displayJob}`
    );
  }
}

run();
