// PrinterFarm CLI — check status across your printer farm.
//
// Usage:
//   node bin/farm-status.mjs
//   node bin/farm-status.mjs 192.168.137.10 192.168.137.78

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
const PRINTERS_JSON = path.join(here, "..", "printers.json");

const args    = process.argv.slice(2);
const ipArgs  = args.filter((a) => !a.startsWith("--"));

let printers = ipArgs.map((ip, i) => ({ id: String(i + 1), ip }));
if (printers.length === 0 && existsSync(PRINTERS_JSON)) {
  printers = JSON.parse(readFileSync(PRINTERS_JSON, "utf8"));
}
if (printers.length === 0) {
  console.error("usage: node bin/farm-status.mjs <ip> [ip...]   (or create printers.json)");
  process.exit(1);
}

console.log("");
console.log("id    ip");
console.log("----  -----------------");
for (const p of printers) {
  console.log(`${p.id.padEnd(4)}  ${p.ip}`);
}
