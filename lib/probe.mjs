// PrinterFarm — shared printer probing logic.
//
// No dependencies — Node 22+ global WebSocket only.

/**
 * Probe a single printer to check network connectivity.
 * Opens a WebSocket connection to port 9999 and resolves when connected.
 * 
 * @param {{ id: string, ip: string }} printer
 * @param {number} [timeoutMs=4000]
 * @returns {Promise<{ id, ip, status, job }>}
 */
export function probe(printer, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let settled = false, ws;

    const done = (status, job) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws?.close(); } catch {}
      resolve({ ...printer, status, job });
    };

    const timer = setTimeout(() => done("unreachable", "timeout"), timeoutMs);

    try {
      ws = new WebSocket(`ws://${printer.ip}:9999/`);
    } catch {
      return done("unreachable", "socket error");
    }

    // Accumulate state — printer answers in multiple separate messages
    const state = {};

    ws.addEventListener("open", () => {
      // Send Creality's own status request (reverse-engineered from their web UI)
      ws.send(JSON.stringify({ method: "get", params: { reqPrintObjects: {} } }));
    });

    ws.addEventListener("message", ({ data }) => {
      try {
        const msg = JSON.parse(data);

        // Each message only contains some fields — accumulate them all
        if (msg.deviceState      !== undefined) state.deviceState      = msg.deviceState;
        if (msg.printFileName    !== undefined) state.printFileName    = msg.printFileName;
        if (msg.printProgress    !== undefined) state.printProgress    = msg.printProgress;
        if (msg.targetNozzleTemp !== undefined) state.targetNozzleTemp = msg.targetNozzleTemp;
        if (msg.targetBedTemp    !== undefined) state.targetBedTemp    = msg.targetBedTemp;

        // deviceState indicates the payload is complete
        if (state.deviceState !== undefined) {
          done("online", state);
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.addEventListener("error", () => {
      done("unreachable", "connection failed");
    });
  });
}

/**
 * Classifies raw printer data into a simple "free" or "busy" farm status.
 * Also patches the Creality firmware bug where canceled prints get stuck on "print".
 */
export function judge(printer) {
  // If the network connection failed, it's an error.
  if (printer.status !== "online") {
    return { ...printer, farmState: "error", displayJob: printer.job };
  }

  const state = printer.job; // Raw telemetry payload from probe()
  const file = state.printFileName || "";
  const progress = state.printProgress || 0;

  let farmState = "free";
  let displayJob = "-";

  if (state.deviceState === "print") {
    // BUG FIX: Printer says "print", but heaters are off. It's actually a canceled, dead job.
    if (state.targetNozzleTemp === 0 && state.targetBedTemp === 0) {
      farmState = "free";
    } else {
      farmState = "busy";
      displayJob = `${file} ${progress}%`;
    }
  } else if (state.deviceState === "pause") {
    farmState = "paused";
    displayJob = `${file} (Paused)`;
  }

  return { ...printer, farmState, displayJob };
}
