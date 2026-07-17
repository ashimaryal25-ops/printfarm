import { probe, judge } from "./probe.mjs";

// Central memory store: Holds the latest status of every printer.
export const farmState = new Map();

// Global Queue: Array of { id, filename, filepath }
export const jobQueue = [];

// Global Settings
export const settings = {
  autoAssign: false
};

// Printer-Specific Local Queues: Map of printer IP -> Array of { id, filename, filepath }
export const printerQueues = new Map();

// Manual overrides: Map of printer IP -> "needs_clearing"
export const manualOverrides = new Map();

/**
 * Selects which queue may feed a free printer.
 * A printer with local Auto-Print enabled is exclusively reserved for its local
 * queue, even when that queue is empty.
 */
export function chooseAutoDispatchJob({
  localQueue,
  globalQueue,
  localAutoEnabled,
  globalAutoEnabled
}) {
  if (localAutoEnabled) {
    const job = localQueue.find(candidate => !candidate.status);
    return job ? { job, queue: localQueue, source: 'local' } : null;
  }

  if (globalAutoEnabled) {
    const job = globalQueue.find(candidate => !candidate.status);
    return job ? { job, queue: globalQueue, source: 'global' } : null;
  }

  return null;
}

export let activePrinters = [];
let pollingTimer = null;
let pollingGeneration = 0;

export function getPrinters() {
  return activePrinters;
}

export function setPrinters(nextPrinters) {
  const nextById = new Map(nextPrinters.map(p => [p.id, p]));
  
  // Prune farmState keys that are no longer in activePrinters
  for (const [id, state] of farmState.entries()) {
    if (nextById.get(id)?.ip !== state.ip) {
      farmState.delete(id);
    }
  }
  
  activePrinters = [...nextPrinters];
}

/**
 * Starts a background polling loop to continuously sweep the network.
 * 
 * @param {Array<{id: string, ip: string}>} initialPrinters 
 * @param {number} intervalMs - How often to poll in milliseconds (default: 5000)
 */
export function startFarmPolling(initialPrinters, intervalMs = 5000) {
  stopFarmPolling();
  activePrinters = [...initialPrinters];
  const generation = pollingGeneration;
  
  async function poll() {
    // Probe printers ONE AT A TIME. The Creality :9999 socket accepts very few
    // simultaneous connections (verified on real hardware: concurrent probes made
    // reachable printers report as unreachable), so the sweep is serialized.
    for (const p of activePrinters) {
      const raw = await probe(p);
      const final = judge(raw);

      // Discovery can replace the farm while a serialized sweep is awaiting a
      // printer. Never let the obsolete sweep reinsert a removed IP afterward.
      if (!activePrinters.some(current => current.id === p.id && current.ip === p.ip)) continue;

      const previous = farmState.get(final.id);
      // If a printer was busy and is now free, lock it into needs_clearing.
      if (previous && previous.farmState === 'busy' && final.farmState === 'free') {
        manualOverrides.set(final.ip, 'needs_clearing');
      }

      // A cleared-bed override survives stale terminal firmware states, but a
      // real new print always removes it.
      if (manualOverrides.get(final.ip) === 'free' && (final.farmState === 'busy' || final.farmState === 'paused')) {
        manualOverrides.delete(final.ip);
      }

      const override = manualOverrides.get(final.ip);
      if (override === 'needs_clearing') {
        final.farmState = 'needs_clearing';
      } else if (override === 'free' && (final.farmState === 'free' || final.farmState === 'needs_clearing')) {
        final.farmState = 'free';
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
    if (generation === pollingGeneration) {
      pollingTimer = setTimeout(loop, intervalMs);
    }
  }

  loop();
}

export function stopFarmPolling() {
  pollingGeneration += 1;
  if (pollingTimer) {
    clearTimeout(pollingTimer);
    pollingTimer = null;
  }
}
