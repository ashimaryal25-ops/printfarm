// PrinterFarm — shared printer probing logic.
//
// No dependencies — Node 22+ global WebSocket only.

import { isPrinterActiveState, isPrinterPausedState, isPrinterTerminalState } from './printer-state.mjs';

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
    let settled = false, ws, collectTimer;

    const done = (status, job) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(collectTimer);
      try { ws?.close(); } catch {}
      resolve({ ...printer, status, job });
    };

    const timer = setTimeout(() => done("unreachable", "timeout"), timeoutMs);

    try {
      ws = new WebSocket(`ws://${printer.ip}:9999/`);
    } catch {
      return done("unreachable", "socket error");
    }

    // Accumulate fragmented JSON payloads
    const state = {};

    ws.addEventListener("open", () => {
      // Dispatch Creality WebSocket status request
      ws.send(JSON.stringify({ method: "get", params: { reqPrintObjects: {} } }));
    });

    ws.addEventListener("message", ({ data }) => {
      try {
        const msg = JSON.parse(data);

        // Accumulate partial telemetry fields
        if (msg.deviceState !== undefined) state.deviceState = msg.deviceState;
        if (msg.state !== undefined) state.printState = msg.state;
        if (msg.hostname !== undefined) state.hostname = msg.hostname;
        if (msg.printFileName    !== undefined) state.printFileName    = msg.printFileName;
        if (msg.printProgress    !== undefined) state.printProgress    = msg.printProgress;
        if (msg.dProgress        !== undefined) state.printProgress    = msg.dProgress;
        if (msg.printJobTime     !== undefined) state.printJobTime     = msg.printJobTime;
        if (msg.layer            !== undefined) state.layer            = msg.layer;
        if (msg.TotalLayer       !== undefined) state.totalLayer       = msg.TotalLayer;
        if (msg.targetNozzleTemp !== undefined) state.targetNozzleTemp = msg.targetNozzleTemp;
        if (msg.targetBedTemp    !== undefined) state.targetBedTemp    = msg.targetBedTemp;
        if (msg.targetBedTemp0   !== undefined) state.targetBedTemp    = msg.targetBedTemp0;
        if (msg.nozzleTemp       !== undefined) state.nozzleTemp       = msg.nozzleTemp;
        if (msg.bedTemp          !== undefined) state.bedTemp          = msg.bedTemp;
        if (msg.bedTemp0         !== undefined) state.bedTemp          = msg.bedTemp0;

        // Telemetry arrives in fragments. Collect briefly after the first real
        // payload so late temperature and progress fields are not discarded.
        if (!collectTimer) collectTimer = setTimeout(() => done("online", state), 400);
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
  const file = String(state.printFileName || "").split(/[\\/]/).pop();
  const progress = state.printProgress || 0;
  const telemetryComplete = state.deviceState !== undefined || state.printState !== undefined;

  let farmState = telemetryComplete ? "free" : "error";
  let displayJob = telemetryComplete ? "-" : "incomplete telemetry";

  if (isPrinterPausedState(state.deviceState, state)) {
    farmState = "paused";
    displayJob = `${file} (Paused)`;
  } else if (isPrinterActiveState(state.deviceState, state)) {
    // A newly-started print can briefly report zero target temperatures. Treating
    // that window as free can dispatch a second job to a moving printer.
    farmState = "busy";
    displayJob = `${file} ${progress}%`;
  } else if (file && isPrinterTerminalState(state.deviceState, state)) {
    farmState = "needs_clearing";
    displayJob = file;
  }

  return { 
    ...printer, 
    farmState, 
    displayJob,
    telemetryComplete,
    deviceState: state.deviceState ?? 0,
    printState: state.printState,
    hostname: state.hostname || printer.hostname || '',
    nozzleTemp: state.nozzleTemp || 0,
    bedTemp: state.bedTemp || 0,
    targetNozzleTemp: state.targetNozzleTemp || 0,
    targetBedTemp: state.targetBedTemp || 0,
    printProgress: progress,
    printJobTime: Number(state.printJobTime) || 0,
    layer: Number(state.layer) || 0,
    totalLayer: Number(state.totalLayer) || 0,
    printFileName: file
  };
}
