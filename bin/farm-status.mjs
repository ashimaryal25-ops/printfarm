// PrinterFarm CLI — check status across your printer farm.
//
// Usage:
//   node bin/farm-status.mjs
//   node bin/farm-status.mjs 192.168.137.10 192.168.137.78

import { readFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { startFarmPolling, farmState } from "../lib/farm.mjs";

const PRINTERS_JSON = "printers.json";
if (printers.length === 0) {
  console.error("usage: node bin/farm-status.mjs <ip> [ip...]   (or create printers.json)");
  process.exit(1);
}

// Start the background engine (it will run forever)
startFarmPolling(printers);

// Render the UI every 5 seconds using the global memory state
setInterval(() => {
  console.clear();
  console.log("PrinterFarm Live Status (Updates every 5s)");
  console.log("--------------------------------------------");
  console.log("id    ip                status      job");
  console.log("----  ----------------  ----------  -------------------------");

  // Read directly from the Map
  for (const [id, final] of farmState.entries()) {
    console.log(
      `${final.id.padEnd(4)}  ` +
      `${final.ip.padEnd(16)}  ` +
      `${final.farmState.padEnd(10)}  ` +
      `${final.displayJob}`
    );
  }
}, 5000);
