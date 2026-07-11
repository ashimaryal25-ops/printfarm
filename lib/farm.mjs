import { probe, judge } from "./probe.mjs";

// Central memory store: Holds the latest status of every printer.
export const farmState = new Map();

// Global Queue: Array of { id, filename, filepath }
export const jobQueue = [];

// Global Settings
export const settings = {
  autoAssign: true
};

// Printer-Specific Local Queues: Map of printer IP -> Array of { id, filename, filepath }
export const printerQueues = new Map();

// Manual overrides: Map of printer IP -> "needs_clearing"
export const manualOverrides = new Map();

/**
 * Starts a background polling loop to continuously sweep the network.
 * 
 * @param {Array<{id: string, ip: string}>} printers 
 * @param {number} intervalMs - How often to poll in milliseconds (default: 5000)
 */
export function startFarmPolling(printers, intervalMs = 5000) {
  
  async function poll() {
    // Probe printers ONE AT A TIME. The Creality :9999 socket accepts very few
    // simultaneous connections (verified on real hardware: concurrent probes made
    // reachable printers report as unreachable), so the sweep is serialized.
    for (const p of printers) {
      const raw = await probe(p);
      const final = judge(raw);

      const previous = farmState.get(final.id);
      // If a printer was busy and is now free, lock it into needs_clearing
      if (previous && previous.farmState === 'busy' && final.farmState === 'free') {
        manualOverrides.set(final.ip, 'needs_clearing');
      }

      // Apply the lock
      if (manualOverrides.has(final.ip)) {
        final.farmState = manualOverrides.get(final.ip);
      }

      farmState.set(final.id, final);
    }
  }

  // Self-scheduling loop: the next sweep is scheduled only AFTER the previous one
  // completes. A fixed setInterval would fire mid-sweep whenever offline printers
  // make the sweep slower than the interval, stacking overlapping connections.
  async function loop() {
    try {
      await poll();
    } catch {
      // a failed sweep must never kill the polling loop
    }
    setTimeout(loop, intervalMs);
  }

  loop();
}
