// Stock Creality printer control (NO ROOT) — decoded from the Ender 3 V3 KE web UI's own JS.
//
//   Upload:  POST http://<ip>/upload/<filename>   (multipart form, field "file")
//   Start:   ws://<ip>:9999  ->  {method:"set",params:{opGcodeFile:"printprt:<dir>/<filename>"}}
//
// The web UI builds the start path from each file's reported path; uploaded files land in
// /usr/data/printer_data/gcodes (confirmed from a live print). Override with GCODE_DIR if needed.
//
// Run directly to upload + start a print (test the protocol on real hardware):
//   node lib/creality.mjs <printer-ip> my_model.gcode
//
// Zero dependencies — native fetch / FormData / Blob / WebSocket (Node 22+).

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isPrinterPrintingState, isPrinterTerminalState } from './printer-state.mjs';

const GCODE_DIR = process.env.GCODE_DIR ?? "/usr/data/printer_data/gcodes";

export async function uploadGcode(ip, filePath) {
  if (!existsSync(filePath)) throw new Error(`no such file: ${filePath}`);
  const filename = path.basename(filePath);
  const form = new FormData();
  form.append("file", new Blob([readFileSync(filePath)]), filename);
  const httpPort = process.env.HTTP_PORT ?? (ip === '127.0.0.1' ? 9999 : 80);
  const res = await fetch(`http://${ip}:${httpPort}/upload/${filename}`, { method: "POST", body: form, signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`upload failed: HTTP ${res.status} ${await res.text().catch(() => "")}`);
  return filename;
}

export function startPrint(ip, filename, gcodeDir = GCODE_DIR) {
  return new Promise((resolve, reject) => {
    let settled = false, ws;
    const done = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws?.close(); } catch {}
      err ? reject(err) : resolve(`printprt:${gcodeDir}/${filename}`);
    };
    const timer = setTimeout(() => done(new Error("start timeout (no socket response)")), 15000);
    try { ws = new WebSocket(`ws://${ip}:9999/`); } catch (e) { return done(e); }
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ method: "set", params: { opGcodeFile: `printprt:${gcodeDir}/${filename}` } }));
      // give the firmware a moment to accept the command, then resolve
      setTimeout(() => done(), 1500);
    });
    ws.addEventListener("error", () => done(new Error("socket error (wrong IP or not on the printer network?)")));
  });
}

function sendControlAndConfirm(ip, command, conditionCheck, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let settled = false, ws, pollTimer;
    const reported = {};
    const done = (err, ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(pollTimer);
      try { ws?.close(); } catch {}
      if (err) reject(err);
      else resolve(ok);
    };
    const timer = setTimeout(() => done(new Error("timeout")), timeoutMs);
    try { ws = new WebSocket(`ws://${ip}:9999/`); } catch { return done(new Error("socket_error")); }
    
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify(command));
      pollTimer = setInterval(() => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ method: "get", params: { reqPrintObjects: {} } }));
      }, 1000);
    });

    ws.addEventListener("message", (ev) => {
      const t = typeof ev.data === "string" ? ev.data : "";
      if (!t || t === "ok") return;
      let m; try { m = JSON.parse(t); } catch { return; }
      
      if (m.deviceState !== undefined) reported.deviceState = m.deviceState;
      if (m.state !== undefined) reported.printState = m.state;
      if (m.printFileName !== undefined) reported.printFileName = m.printFileName;

      if (conditionCheck(reported)) done(null, true);
    });
    ws.addEventListener("error", () => done(new Error("socket_error")));
  });
}

export function pausePrint(ip, filename, timeoutMs = process.env.TEST_TIMEOUT ? parseInt(process.env.TEST_TIMEOUT) : 15000) {
  const expectedFilename = path.basename(filename).toLowerCase();
  return sendControlAndConfirm(
    ip, 
    { method: "set", params: { pause: 1 } },
    (reported) => {
      const reportedFilename = path.basename(String(reported.printFileName || "")).toLowerCase();
      // '5' is the raw state for paused
      const paused = String(reported.printState) === "5" || String(reported.deviceState) === "5";
      return paused && reportedFilename === expectedFilename;
    },
    timeoutMs
  );
}

export function resumePrint(ip, filename, timeoutMs = process.env.TEST_TIMEOUT ? parseInt(process.env.TEST_TIMEOUT) : 15000) {
  const expectedFilename = path.basename(filename).toLowerCase();
  return sendControlAndConfirm(
    ip, 
    { method: "set", params: { pause: 0 } },
    (reported) => {
      const reportedFilename = path.basename(String(reported.printFileName || "")).toLowerCase();
      // '1' is the raw state for printing
      const printing = String(reported.printState) === "1"
        || (reported.printState === undefined && String(reported.deviceState) === "1");
      return printing && reportedFilename === expectedFilename;
    },
    timeoutMs
  );
}

export function cancelPrint(ip, timeoutMs = process.env.TEST_TIMEOUT ? parseInt(process.env.TEST_TIMEOUT) : 15000) {
  return sendControlAndConfirm(
    ip, 
    { method: "set", params: { stop: 1 } },
    (reported) => {
      if (reported.deviceState === undefined) return false;
      const state = String(reported.printState ?? reported.deviceState);
      // '0' stopped, '2' complete, '3' failed, '4' aborted
      return String(reported.deviceState) !== "1" && ["0", "2", "3", "4"].includes(state);
    },
    timeoutMs
  );
}

// optional: poll status to confirm the print actually started (printFileName matches)
export function confirmPrinting(ip, filename, timeoutMs = 12000) {
  return new Promise((resolve) => {
    let settled = false, ws, pollTimer;
    const reported = {};
    const expectedFilename = path.basename(filename).toLowerCase();
    const done = (ok) => { 
      if (settled) return; 
      settled = true; 
      clearTimeout(timer); 
      clearInterval(pollTimer);
      try { ws?.close(); } catch {} 
      resolve(ok); 
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    try { ws = new WebSocket(`ws://${ip}:9999/`); } catch { return done(false); }
    
    ws.addEventListener("open", () => {
      // Actively request status every second until the firmware reports the new file
      pollTimer = setInterval(() => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ method: "get", params: { reqPrintObjects: {} } }));
      }, 1000);
    });

    ws.addEventListener("message", (ev) => {
      const t = typeof ev.data === "string" ? ev.data : "";
      if (!t || t === "ok") return;
      let m; try { m = JSON.parse(t); } catch { return; }
      if (m.printFileName !== undefined) reported.printFileName = m.printFileName;
      if (m.deviceState !== undefined) reported.deviceState = m.deviceState;

      const reportedFilename = path.basename(String(reported.printFileName || "")).toLowerCase();
      const isPrinting = isPrinterPrintingState(reported.deviceState);
      if (isPrinting && reportedFilename === expectedFilename) done(true);
    });
    ws.addEventListener("error", () => done(false));
  });
}

export async function uploadAndPrint(ip, filePath) {
  const filename = await uploadGcode(ip, filePath);
  await startPrint(ip, filename);
  const confirmed = await confirmPrinting(ip, filename);
  return { filename, confirmed };
}

// run directly = test on real hardware
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [ip, file] = process.argv.slice(2);
  if (!ip || !file) {
    console.error("usage: node lib/creality.mjs <printer-ip> <gcode-file>");
    process.exit(1);
  }
  console.log(`uploading ${path.basename(file)} to ${ip} ...`);
  try {
    const filename = await uploadGcode(ip, file);
    console.log(`uploaded. starting print: printprt:${GCODE_DIR}/${filename}`);
    await startPrint(ip, filename);
    console.log("start command sent. confirming via status ...");
    const ok = await confirmPrinting(ip, filename);
    console.log(ok ? "CONFIRMED: printer reports it is printing this file." : "sent, but could not confirm from status within timeout (check the printer screen).");
  } catch (e) {
    console.error("FAILED:", e.message);
    process.exit(1);
  }
}
