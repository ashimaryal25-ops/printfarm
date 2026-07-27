import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { startFarmPolling, setPrinters, getPrinters, farmState, jobQueue, manualOverrides, settings, printerQueues, chooseAutoDispatchJob } from '../lib/farm.mjs';
import { localSubnets, localSubnet, scanSubnet, normalizeSubnetInput } from '../lib/discovery.mjs';
import { uploadGcode, startPrint, confirmPrinting, pausePrint, resumePrint, cancelPrint } from '../lib/creality.mjs';
import { sanitizeFilename, resolveSafePath } from '../lib/server-helpers.mjs';
import { isPrinterPausedState, isPrinterPrintingState } from '../lib/printer-state.mjs';
import { createJobDispatcher } from '../lib/dispatcher.mjs';
import { assignStablePrinterIds as assignIds, dispatchMatchesState, reconcilePrinterAddresses } from '../lib/printer-identity.mjs';
import { matchesRoute, sendJson, sendText } from '../lib/http-helpers.mjs';
import {
  activeDispatches,
  controlOperations,
  controlWarnings,
  dispatchingPrinters,
  failedJobs,
  localAutoPrint
} from '../lib/workflow-state.mjs';

const PUBLIC_DIR = path.join(process.cwd(), 'public');
const SCRATCH_DIR = path.join(process.cwd(), 'scratch');
if (!fs.existsSync(SCRATCH_DIR)) fs.mkdirSync(SCRATCH_DIR);

// Load printers
const PRINTERS_JSON = "printers.json";
// No default printers: a fresh install starts empty and uses Discovery (or a
// hand-written printers.json) instead of showing a phantom offline printer.
let printers = [];
if (fs.existsSync(PRINTERS_JSON)) {
  try {
    printers = JSON.parse(fs.readFileSync(PRINTERS_JSON, "utf8"));
  } catch(e) {
    console.error("Failed to parse printers.json", e);
  }
}

// Polling is started in the direct execution block below

function getStateByIp(ip) {
  return [...farmState.values()].find(state => state.ip === ip);
}

export function reconcileDiscoveredPrinters(discoveredPrinters) {
  reconcilePrinterAddresses(discoveredPrinters, {
    activeDispatches,
    controlOperations,
    controlWarnings,
    localAutoPrint,
    manualOverrides,
    printerQueues
  });
}

function assignStablePrinterIds(foundPrinters) {
  return assignIds(foundPrinters, getPrinters());
}

export function isPrinterPreparing(state) {
  if (state?.farmState !== 'busy') return false;
  const hasProgress = Number(state.printProgress) > 0;
  const hasTime = Number(state.printJobTime) > 0;
  return !hasProgress && !hasTime;
}

export function deriveActiveJobPhase(state, fallbackPhase, ctl) {
  if (ctl) return ctl;
  if (state?.farmState === 'paused') return 'paused';
  if (state?.farmState === 'busy') {
    return isPrinterPreparing(state) ? 'preparing' : 'printing';
  }
  return fallbackPhase;
}

function reconcileActiveDispatches() {
  for (const [ip, dispatch] of activeDispatches) {
    const state = getStateByIp(ip);
    if (!state) continue;

    const telemetryIsActive = state.farmState === 'busy' || state.farmState === 'paused';
    if (telemetryIsActive && dispatchMatchesState(dispatch, state)) {
      dispatch.phase = deriveActiveJobPhase(state, dispatch.phase);
      dispatch.remoteFilename = state.printFileName;
      dispatch.progress = state.printProgress || 0;
      dispatch.layer = state.layer || 0;
      dispatch.totalLayer = state.totalLayer || 0;
      dispatch.seenBusy = true;
      continue;
    }

    if (dispatch.seenBusy && (state.farmState === 'free' || state.farmState === 'needs_clearing')) {
      activeDispatches.delete(ip);
    }
  }
}

function statusPayload() {
  reconcileActiveDispatches();

  const effectiveFarmState = {};
  for (const [id, state] of farmState) {
    const dispatch = activeDispatches.get(state.ip);
    const ctl = controlOperations.get(state.ip);
    const warning = controlWarnings.get(state.ip);
    
    // Clear a timeout warning when later telemetry confirms that command.
    if (warning && ctl === undefined) {
      const pauseConfirmed = warning.startsWith('Pause') && state.farmState === 'paused';
      const resumeConfirmed = warning.startsWith('Resume') && state.farmState === 'busy';
      const cancelConfirmed = warning.startsWith('Cancel') && (state.farmState === 'free' || state.farmState === 'needs_clearing');
      if (pauseConfirmed || resumeConfirmed || cancelConfirmed) controlWarnings.delete(state.ip);
    }

    if (ctl) {
      // Temporarily override phase logic for UI
      effectiveFarmState[id] = { ...state, farmState: ctl };
    } else {
      effectiveFarmState[id] = dispatch && state.farmState === 'free'
        ? { ...state, farmState: 'starting', displayJob: dispatch.filename }
        : state;
    }
  }

  const activeJobs = [...activeDispatches.values()].map(dispatch => {
    const ctl = controlOperations.get(dispatch.printerIp);
    const state = getStateByIp(dispatch.printerIp);
    const phase = deriveActiveJobPhase(state, dispatch.phase, ctl);
    return { ...dispatch, phase };
  });

  for (const state of farmState.values()) {
    const telemetryIsActive = state.farmState === 'busy' || state.farmState === 'paused';
    if (telemetryIsActive && !activeDispatches.has(state.ip)) {
      const ctl = controlOperations.get(state.ip);
      activeJobs.push({
        jobId: null,
        filename: state.printFileName || 'Unknown file',
        printerIp: state.ip,
        printerId: state.id,
        phase: deriveActiveJobPhase(state, 'printing', ctl),
        progress: state.printProgress || 0,
        layer: state.layer || 0,
        totalLayer: state.totalLayer || 0,
        source: 'printer'
      });
    }
  }

  return {
    farmState: effectiveFarmState,
    jobQueue,
    settings,
    failedJobs,
    printerQueues: Object.fromEntries(printerQueues),
    localAutoPrint: Object.fromEntries(localAutoPrint),
    activeJobs,
    controlWarnings: Object.fromEntries(controlWarnings)
  };
}

async function runPrinterControl({ res, ip, operation, command, onConfirmed }) {
  const transition = { pause: 'pausing', resume: 'resuming', cancel: 'canceling' }[operation];
  controlOperations.set(ip, transition);
  controlWarnings.delete(ip);

  try {
    await command();
    onConfirmed?.();
    sendJson(res, 200, { status: 'ok' });
  } catch (error) {
    if (error.message === 'timeout') {
      const label = operation[0].toUpperCase() + operation.slice(1);
      const warning = `${label} was sent but the printer did not confirm it. Inspect the printer before trying again.`;
      controlWarnings.set(ip, warning);
      sendJson(res, 504, { error: warning });
    } else {
      sendJson(res, 502, { error: 'socket_error' });
    }
  } finally {
    controlOperations.delete(ip);
  }
}

export async function requestHandler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (matchesRoute(req, url, 'GET', '/api/status')) {
    sendJson(res, 200, statusPayload());
    return;
  }

  if (matchesRoute(req, url, 'GET', '/api/discovery/subnets')) {
    sendJson(res, 200, localSubnets());
    return;
  }
  
  if (matchesRoute(req, url, 'GET', '/api/discover')) {
    const subnetParam = url.searchParams.get('subnet');
    
    const rawSubnet = subnetParam || localSubnet();
    if (!rawSubnet) {
      sendJson(res, 400, { error: 'could not detect local subnet' });
      return;
    }

    let subnet;
    try {
      subnet = normalizeSubnetInput(rawSubnet);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
      return;
    }
    
    try {
      const result = await scanSubnet(subnet);
      
      // Update farm ONLY if we found printers
      if (result.found && result.found.length > 0) {
        // Sort IPs numerically
        result.found.sort((a, b) => {
          const numA = Number(a.ip.split('.').pop());
          const numB = Number(b.ip.split('.').pop());
          return numA - numB;
        });
        
        result.found = assignStablePrinterIds(result.found);
        reconcileDiscoveredPrinters(result.found);
        const newPrinters = result.found.map((p) => ({ id: p.id, ip: p.ip, hostname: p.hostname }));
        setPrinters(newPrinters);
        fs.writeFileSync(PRINTERS_JSON, JSON.stringify(newPrinters, null, 2));
      }
      
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }
  
  if (matchesRoute(req, url, 'POST', '/api/clear-bed')) {
    const ip = url.searchParams.get('ip');
    if (ip) {
      const state = getStateByIp(ip);
      if (state && state.farmState === 'needs_clearing') {
        manualOverrides.set(ip, 'free');
        state.farmState = 'free';
        activeDispatches.delete(ip);
      }
    }
    sendText(res, 200, 'Cleared');
    return;
  }
  
  if (matchesRoute(req, url, 'POST', '/api/jobs/requeue')) {
    const jobId = url.searchParams.get('jobId');
    if (!jobId) {
      sendText(res, 400, 'Missing jobId');
      return;
    }
    
    let job = null;
    const sourceArray = failedJobs;
    const idx = failedJobs.findIndex(j => j.id === jobId);
    if (idx !== -1) {
      job = failedJobs[idx];
    }
    
    if (!job) {
      sendJson(res, 404, { error: 'Job not found in failed jobs' });
      return;
    }
    
    if (!fs.existsSync(job.filePath)) {
      sendJson(res, 410, { error: 'Source file no longer exists on disk' });
      return;
    }
    
    // Remove from source array
    sourceArray.splice(idx, 1);
    
    // Assign a fresh id and reset transient failure metadata.
    const newJob = {
      ...job,
      id: `${Date.now()}_${randomUUID()}`,
      attempts: 0
    };
    
    // Clean up old metadata
    delete newJob.status;
    delete newJob.failureMessage;
    delete newJob.failureReason;
    delete newJob.failedAt;
    delete newJob.lastPrinterIp;
    delete newJob.printerIp;
    delete newJob.printerId;

    jobQueue.push(newJob);
    
    sendJson(res, 200, { success: true, message: 'Job requeued' });
    return;
  }
  
  if (matchesRoute(req, url, 'POST', '/api/settings/auto-assign')) {
    const value = url.searchParams.get('value') === 'true';
    settings.autoAssign = value;
    sendText(res, 200, 'Settings updated');
    return;
  }

  if (matchesRoute(req, url, 'POST', '/api/printers/local-auto-print')) {
    const ip = url.searchParams.get('ip');
    const value = url.searchParams.get('value') === 'true';

    if (!ip) {
      sendText(res, 400, 'Missing ip');
      return;
    }

    localAutoPrint.set(ip, value);
    sendText(res, 200, 'Local auto-print updated');
    return;
  }
  
  if (matchesRoute(req, url, 'POST', '/api/printers/queue-job')) {
    const ip = url.searchParams.get('ip');
    const jobId = url.searchParams.get('jobId');
    
    if (!ip || !jobId) {
      sendText(res, 400, 'Missing ip or jobId');
      return;
    }
    
    const jobIndex = jobQueue.findIndex(j => j.id === jobId);
    if (jobIndex === -1) {
      sendText(res, 404, 'Job not found in global queue');
      return;
    }

    if (jobQueue[jobIndex].status === 'sending') {
      sendText(res, 409, 'Job is already being sent to a printer');
      return;
    }
    
    const [job] = jobQueue.splice(jobIndex, 1);
    if (!printerQueues.has(ip)) printerQueues.set(ip, []);
    printerQueues.get(ip).push(job);
    
    sendText(res, 200, 'Job added to local queue');
    return;
  }
  
  if (matchesRoute(req, url, 'DELETE', '/api/printers/queue-job')) {
    const ip = url.searchParams.get('ip');
    const jobId = url.searchParams.get('jobId');
    
    if (!ip || !jobId) {
      sendText(res, 400, 'Missing ip or jobId');
      return;
    }
    
    const localQ = printerQueues.get(ip) || [];
    const jobIndex = localQ.findIndex(j => j.id === jobId);
    
    if (jobIndex === -1) {
      sendText(res, 404, 'Job not found in local queue');
      return;
    }

    if (localQ[jobIndex].status === 'sending') {
      sendText(res, 409, 'Cannot remove a job while it is being sent');
      return;
    }
    
    // Remove it from the local queue
    localQ.splice(jobIndex, 1);
    
    sendText(res, 200, 'Job removed from local queue');
    return;
  }

  if (matchesRoute(req, url, 'POST', '/api/printers/start-job')) {
    const ip = url.searchParams.get('ip');
    const jobId = url.searchParams.get('jobId');
    
    if (!ip || !jobId) {
      sendText(res, 400, 'Missing ip or jobId');
      return;
    }
    
    const localQ = printerQueues.get(ip) || [];
    const jobIndex = localQ.findIndex(j => j.id === jobId);
    
    if (jobIndex === -1) {
      sendText(res, 404, 'Job not found in local queue');
      return;
    }
    
    const state = getStateByIp(ip);
    if (!state || state.farmState !== 'free' || dispatchingPrinters.has(ip) || activeDispatches.has(ip)) {
      sendText(res, 400, 'Printer not available');
      return;
    }
    
    const job = localQ[jobIndex];
    if (job.status === 'sending') {
      sendText(res, 400, 'Job is already sending');
      return;
    }
    
    void jobDispatcher.dispatch({ state, job, queue: localQ, source: 'manual' });
    
    sendText(res, 200, 'Started');
    return;
  }

  if (matchesRoute(req, url, 'POST', '/api/printers/pause')) {
    const ip = url.searchParams.get('ip');
    const state = getStateByIp(ip);
    if (!state) { sendText(res, 404, 'Printer not found'); return; }
    
    if (controlOperations.has(ip)) { sendJson(res, 409, { error: 'Operation already in flight' }); return; }
    if (!isPrinterPrintingState(state.deviceState, state)) { sendText(res, 400, 'Printer is not printing'); return; }
    if (isPrinterPreparing(state)) {
      sendJson(res, 409, { error: 'Printer is still heating or preparing. Pause becomes available when printing begins.' });
      return;
    }

    await runPrinterControl({
      res,
      ip,
      operation: 'pause',
      command: () => pausePrint(ip, state.printFileName)
    });
    return;
  }

  if (matchesRoute(req, url, 'POST', '/api/printers/resume')) {
    const ip = url.searchParams.get('ip');
    const state = getStateByIp(ip);
    if (!state) { sendText(res, 404, 'Printer not found'); return; }
    
    if (controlOperations.has(ip)) { sendJson(res, 409, { error: 'Operation already in flight' }); return; }
    if (!isPrinterPausedState(state.deviceState, state)) { sendText(res, 400, 'Printer is not paused'); return; }

    await runPrinterControl({
      res,
      ip,
      operation: 'resume',
      command: () => resumePrint(ip, state.printFileName)
    });
    return;
  }

  if (matchesRoute(req, url, 'POST', '/api/printers/cancel')) {
    const ip = url.searchParams.get('ip');
    const state = getStateByIp(ip);
    if (!state) { sendText(res, 404, 'Printer not found'); return; }
    
    if (controlOperations.has(ip)) { sendJson(res, 409, { error: 'Operation already in flight' }); return; }
    if (!isPrinterPrintingState(state.deviceState, state) && !isPrinterPausedState(state.deviceState, state)) {
      sendText(res, 400, 'Printer is not actively printing or paused'); return;
    }

    await runPrinterControl({
      res,
      ip,
      operation: 'cancel',
      command: () => cancelPrint(ip),
      onConfirmed: () => {
        activeDispatches.delete(ip);
        manualOverrides.set(ip, 'needs_clearing');
        state.farmState = 'needs_clearing';
      }
    });
    return;
  }
  
  if (matchesRoute(req, url, 'POST', '/api/upload')) {
    const filenameParam = url.searchParams.get('filename') || 'unknown.gcode';
    const filename = sanitizeFilename(filenameParam);
    const targetIp = url.searchParams.get('ip'); // Optional: bypass global queue
    const savePath = path.join(SCRATCH_DIR, `${Date.now()}_${filename}`);
    const writeStream = fs.createWriteStream(savePath);
    
    let uploadedBytes = 0;
    const MAX_SIZE = 100 * 1024 * 1024; // 100MB
    let exceeded = false;
    let responded = false;

    const respondOnce = (status, body) => {
      if (responded || res.headersSent) return;
      responded = true;
      res.writeHead(status);
      res.end(body);
    };

    req.on('data', chunk => {
      uploadedBytes += chunk.length;
      if (uploadedBytes > MAX_SIZE && !exceeded) {
        exceeded = true;
        req.unpipe(writeStream);
        writeStream.end();
        fs.unlink(savePath, () => {});
        respondOnce(413, 'Payload Too Large');
        req.destroy();
      }
    });

    req.pipe(writeStream);
    
    writeStream.on('finish', () => {
      if (exceeded) return;
      const job = {
        id: `${Date.now()}_${randomUUID()}`,
        filename,
        filePath: savePath,
        attempts: 0
      };
      
      if (targetIp) {
        if (!printerQueues.has(targetIp)) printerQueues.set(targetIp, []);
        printerQueues.get(targetIp).push(job);
        console.log(`[API] File uploaded directly to local queue of ${targetIp}: ${filename}`);
      } else {
        jobQueue.push(job);
        console.log(`[API] Queueing file ${filename}...`);
      }
      
      respondOnce(200, 'Uploaded');
    });

    writeStream.on('error', (err) => {
      console.error('Upload stream error:', err);
      if (!exceeded) respondOnce(500, 'Server error during upload');
      fs.unlink(savePath, () => {});
    });
    return;
  }
  
  // Static file server
  const requestedPath = url.pathname === '/' ? 'index.html' : url.pathname;
  const filepath = resolveSafePath(PUBLIC_DIR, requestedPath);
  if (!filepath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (fs.existsSync(filepath) && fs.statSync(filepath).isFile()) {
    const ext = path.extname(filepath);
    const mime = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript'
    }[ext] || 'text/plain';
    
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(filepath).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
}

export const server = http.createServer(requestHandler);

// Dispatcher Loop: Matches queued jobs to free printers
const jobDispatcher = createJobDispatcher({
  uploadGcode,
  startPrint,
  confirmPrinting,
  activeDispatches,
  failedJobs,
  dispatchingPrinters
});

let dispatcherInterval = null;

export function startDispatcher() {
  if (dispatcherInterval) return;
  dispatcherInterval = setInterval(async () => {
  reconcileActiveDispatches();
  for (const state of farmState.values()) {
    if (state.farmState === 'free' 
        && !dispatchingPrinters.has(state.ip) 
        && !activeDispatches.has(state.ip) 
        && !controlOperations.has(state.ip)
        && manualOverrides.get(state.ip) !== 'needs_clearing') {
      
      const localQ = printerQueues.get(state.ip) || [];
      const selection = chooseAutoDispatchJob({
        localQueue: localQ,
        globalQueue: jobQueue,
        localAutoEnabled: localAutoPrint.get(state.ip) === true,
        globalAutoEnabled: settings.autoAssign
      });
      const job = selection?.job;
      const queueSource = selection?.queue;
      
      if (!job) continue; // No jobs available for auto-assign

      await jobDispatcher.dispatch({
        state,
        job,
        queue: queueSource,
        source: selection.source
      });
    }
  }
  }, 3000);
}

export function stopDispatcher() {
  if (dispatcherInterval) {
    clearInterval(dispatcherInterval);
    dispatcherInterval = null;
  }
}

import { pathToFileURL } from 'node:url';

const PORT = process.env.PORT || 3000;
// Bind every loopback address, not just one. On Windows `localhost` resolves to
// ::1 before 127.0.0.1, so an IPv4-only bind leaves the browser knocking on a
// closed IPv6 port and loading only when it happens to fall back.
const HOSTS = process.env.HOST ? [process.env.HOST] : ['127.0.0.1', '::1'];

function listenOn(host, onReady) {
  const instance = host === HOSTS[0] ? server : http.createServer(requestHandler);

  instance.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use — PrinterFarm may still be running from an earlier start.`);
      console.error(`Stop it, or pick another port with: PORT=3100 npm start`);
      process.exit(1);
    }
    // A missing IPv6 stack is not fatal; the IPv4 bind still serves the dashboard.
    if (host === '::1' && (err.code === 'EAFNOSUPPORT' || err.code === 'EADDRNOTAVAIL')) return;
    throw err;
  });

  instance.listen(PORT, host, onReady);
  return instance;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Start polling the farm
  startFarmPolling(printers, 2000);
  startDispatcher();

  let announced = false;
  for (const host of HOSTS) {
    listenOn(host, () => {
      if (announced) return;
      announced = true;
      console.log(`PrinterFarm Dashboard running at http://localhost:${PORT}`);
    });
  }
}

