import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { startFarmPolling, setPrinters, getPrinters, farmState, jobQueue, manualOverrides, settings, printerQueues, chooseAutoDispatchJob } from '../lib/farm.mjs';
import { localSubnets, localSubnet, scanSubnet, normalizeSubnetInput } from '../lib/discovery.mjs';
import { uploadGcode, startPrint, confirmPrinting, pausePrint, resumePrint, cancelPrint } from '../lib/creality.mjs';
import { sanitizeFilename, resolveSafePath } from '../lib/server-helpers.mjs';
import { isPrinterPausedState, isPrinterPrintingState } from '../lib/printer-state.mjs';

export const failedJobs = [];
export const completedJobs = [];
export const localAutoPrint = new Map();
export const activeDispatches = new Map();
export const controlOperations = new Map();
export const controlWarnings = new Map();

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

function sameFilename(left, right) {
  const leftName = path.basename(String(left || '')).toLowerCase();
  const rightName = path.basename(String(right || '')).toLowerCase();
  return Boolean(leftName && rightName && leftName === rightName);
}

function dispatchMatchesState(dispatch, state) {
  return [dispatch.remoteFilename, dispatch.filePath, dispatch.filename]
    .some(filename => sameFilename(state?.printFileName, filename));
}

function moveMapKey(map, oldIp, newIp) {
  if (!map.has(oldIp)) return;
  const value = map.get(oldIp);
  map.delete(oldIp);
  map.set(newIp, value);
}

export function reconcileDiscoveredPrinters(discoveredPrinters) {
  const discoveredIps = new Set(discoveredPrinters.map(printer => printer.ip));

  for (const [oldIp, dispatch] of [...activeDispatches]) {
    if (discoveredIps.has(oldIp)) continue;

    const matches = discoveredPrinters.filter(printer =>
      (printer.farmState === 'busy' || printer.farmState === 'paused')
      && dispatchMatchesState(dispatch, printer)
    );

    activeDispatches.delete(oldIp);
    if (matches.length !== 1) {
      controlOperations.delete(oldIp);
      controlWarnings.delete(oldIp);
      continue;
    }

    const replacement = matches[0];
    dispatch.printerIp = replacement.ip;
    dispatch.printerId = replacement.id;
    dispatch.hostname = replacement.hostname;
    dispatch.remoteFilename = replacement.printFileName;
    dispatch.phase = replacement.farmState === 'paused' ? 'paused' : 'printing';
    dispatch.progress = replacement.printProgress || 0;
    dispatch.layer = replacement.layer || 0;
    dispatch.totalLayer = replacement.totalLayer || 0;
    dispatch.seenBusy = true;
    activeDispatches.set(replacement.ip, dispatch);

    for (const job of completedJobs) {
      if (job.id === dispatch.jobId) {
        job.printerIp = replacement.ip;
        job.printerId = replacement.id;
      }
    }

    if (printerQueues.has(oldIp)) {
      const migratedQueue = printerQueues.get(oldIp);
      printerQueues.delete(oldIp);
      printerQueues.set(replacement.ip, migratedQueue);
    }
    moveMapKey(localAutoPrint, oldIp, replacement.ip);
    moveMapKey(manualOverrides, oldIp, replacement.ip);
    moveMapKey(controlWarnings, oldIp, replacement.ip);
  }
}

function assignStablePrinterIds(foundPrinters) {
  const priorByHostname = new Map(
    getPrinters().filter(printer => printer.hostname).map(printer => [printer.hostname, printer.id])
  );
  const usedIds = new Set();

  return foundPrinters.map(printer => {
    let id = priorByHostname.get(printer.hostname);
    if (!id || usedIds.has(id)) {
      let candidate = 1;
      while (usedIds.has(String(candidate))) candidate += 1;
      id = String(candidate);
    }
    usedIds.add(id);
    return { ...printer, id };
  });
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
  // Clean legacy canceled records
  for (let i = failedJobs.length - 1; i >= 0; i--) {
    const fj = failedJobs[i];
    if (fj.failureReason === 'canceled' || fj.failureReason === 'user_canceled' || fj.failureMessage === 'User canceled the print.') {
      failedJobs.splice(i, 1);
    }
  }

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
    manualOverrides: Object.fromEntries(manualOverrides),
    failedJobs,
    completedJobs,
    printerQueues: Object.fromEntries(printerQueues),
    localAutoPrint: Object.fromEntries(localAutoPrint),
    activeJobs,
    controlWarnings: Object.fromEntries(controlWarnings)
  };
}

function beginDispatch(state, job, source) {
  activeDispatches.set(state.ip, {
    jobId: job.id,
    filename: job.filename,
    filePath: job.filePath,
    attempts: job.attempts,
    printerIp: state.ip,
    printerId: state.id,
    phase: 'uploading',
    source,
    startedAt: Date.now(),
    seenBusy: false
  });
}

function setDispatchPhase(ip, phase) {
  const dispatch = activeDispatches.get(ip);
  if (dispatch) dispatch.phase = phase;
}

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  if (req.method === 'GET' && url.pathname.startsWith('/api/status')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(statusPayload()));
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/active-printers')) {
    import('../lib/farm.mjs').then(module => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(module.activePrinters));
    });
    return;
  }

  
  if (req.method === 'GET' && url.pathname.startsWith('/api/discovery/subnets')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(localSubnets()));
    return;
  }
  
  if (req.method === 'GET' && url.pathname.startsWith('/api/discover')) {
    const subnetParam = url.searchParams.get('subnet');
    
    const rawSubnet = subnetParam || localSubnet();
    if (!rawSubnet) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'could not detect local subnet' }));
      return;
    }

    let subnet;
    try {
      subnet = normalizeSubnetInput(rawSubnet);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
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
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }
  
  if (req.method === 'POST' && url.pathname.startsWith('/api/clear-bed')) {
    const ip = url.searchParams.get('ip');
    if (ip) {
      const state = getStateByIp(ip);
      if (state && state.farmState === 'needs_clearing') {
        manualOverrides.set(ip, 'free');
        state.farmState = 'free';
        activeDispatches.delete(ip);
      }
    }
    res.writeHead(200);
    res.end('Cleared');
    return;
  }
  
  if (req.method === 'POST' && url.pathname.startsWith('/api/jobs/requeue')) {
    const jobId = url.searchParams.get('jobId');
    if (!jobId) {
      res.writeHead(400);
      res.end('Missing jobId');
      return;
    }
    
    let job = null;
    let sourceArray = null;
    let idx = failedJobs.findIndex(j => j.id === jobId);
    if (idx !== -1) {
      job = failedJobs[idx];
      sourceArray = failedJobs;
    } else {
      idx = completedJobs.findIndex(j => j.id === jobId);
      if (idx !== -1) {
        job = completedJobs[idx];
        sourceArray = completedJobs;
      }
    }
    
    if (!job) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Job not found in failed or completed lists' }));
      return;
    }
    
    if (!fs.existsSync(job.filePath)) {
      res.writeHead(410, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Source file no longer exists on disk' }));
      return;
    }
    
    // Remove from source array
    sourceArray.splice(idx, 1);
    
    // Assign fresh id, preserve sourceJobId
    const newJob = {
      ...job,
      sourceJobId: job.id,
      id: `${Date.now()}_${randomUUID()}`,
      attempts: 0
    };
    
    // Clean up old metadata
    delete newJob.status;
    delete newJob.failureMessage;
    delete newJob.failureReason;
    delete newJob.failedAt;
    delete newJob.completedAt;
    delete newJob.lastPrinterIp;
    delete newJob.printerIp;
    delete newJob.printerId;

    jobQueue.push(newJob);
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Job requeued' }));
    return;
  }
  
  if (req.method === 'POST' && url.pathname.startsWith('/api/settings/auto-assign')) {
    const value = url.searchParams.get('value') === 'true';
    settings.autoAssign = value;
    res.writeHead(200);
    res.end('Settings updated');
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/printers/local-auto-print')) {
    const ip = url.searchParams.get('ip');
    const value = url.searchParams.get('value') === 'true';

    if (!ip) {
      res.writeHead(400);
      res.end('Missing ip');
      return;
    }

    localAutoPrint.set(ip, value);
    res.writeHead(200);
    res.end('Local auto-print updated');
    return;
  }
  
  if (req.method === 'POST' && url.pathname.startsWith('/api/printers/queue-job')) {
    const ip = url.searchParams.get('ip');
    const jobId = url.searchParams.get('jobId');
    
    if (!ip || !jobId) {
      res.writeHead(400);
      res.end('Missing ip or jobId');
      return;
    }
    
    const jobIndex = jobQueue.findIndex(j => j.id === jobId);
    if (jobIndex === -1) {
      res.writeHead(404);
      res.end('Job not found in global queue');
      return;
    }

    if (jobQueue[jobIndex].status === 'sending') {
      res.writeHead(409);
      res.end('Job is already being sent to a printer');
      return;
    }
    
    const [job] = jobQueue.splice(jobIndex, 1);
    if (!printerQueues.has(ip)) printerQueues.set(ip, []);
    printerQueues.get(ip).push(job);
    
    res.writeHead(200);
    res.end('Job added to local queue');
    return;
  }
  
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/printers/queue-job')) {
    const ip = url.searchParams.get('ip');
    const jobId = url.searchParams.get('jobId');
    
    if (!ip || !jobId) {
      res.writeHead(400);
      res.end('Missing ip or jobId');
      return;
    }
    
    const localQ = printerQueues.get(ip) || [];
    const jobIndex = localQ.findIndex(j => j.id === jobId);
    
    if (jobIndex === -1) {
      res.writeHead(404);
      res.end('Job not found in local queue');
      return;
    }

    if (localQ[jobIndex].status === 'sending') {
      res.writeHead(409);
      res.end('Cannot remove a job while it is being sent');
      return;
    }
    
    // Remove it from the local queue
    localQ.splice(jobIndex, 1);
    
    res.writeHead(200);
    res.end('Job removed from local queue');
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/printers/start-job')) {
    const ip = url.searchParams.get('ip');
    const jobId = url.searchParams.get('jobId');
    
    if (!ip || !jobId) {
      res.writeHead(400);
      res.end('Missing ip or jobId');
      return;
    }
    
    const localQ = printerQueues.get(ip) || [];
    const jobIndex = localQ.findIndex(j => j.id === jobId);
    
    if (jobIndex === -1) {
      res.writeHead(404);
      res.end('Job not found in local queue');
      return;
    }
    
    const state = getStateByIp(ip);
    if (!state || state.farmState !== 'free' || dispatchingPrinters.has(ip) || activeDispatches.has(ip)) {
      res.writeHead(400);
      res.end('Printer not available');
      return;
    }
    
    const job = localQ[jobIndex];
    if (job.status === 'sending') {
      res.writeHead(400);
      res.end('Job is already sending');
      return;
    }
    
    console.log(`[API] Manually starting ${job.filename} on printer ${ip}...`);
    dispatchingPrinters.add(ip);
    job.status = 'sending';
    beginDispatch(state, job, 'manual');
    
    (async () => {
      try {
        const remoteFilename = await uploadGcode(ip, job.filePath);
        const dispatch = activeDispatches.get(ip);
        if (dispatch) dispatch.remoteFilename = remoteFilename;
        setDispatchPhase(ip, 'starting');
        await startPrint(ip, remoteFilename);
        setDispatchPhase(ip, 'confirming');
        const confirmed = await confirmPrinting(ip, remoteFilename);
        // On success or unconfirmed start (which is a hard fail), remove from localQ
        const finalIndex = localQ.findIndex(j => j.id === job.id);
        if (finalIndex !== -1) localQ.splice(finalIndex, 1);

        if (confirmed) {
          setDispatchPhase(ip, 'preparing');
          console.log(`[Dispatcher] Successfully started ${remoteFilename} on ${ip}`);
          const completedJob = {
            ...job,
            completedAt: Date.now(),
            printerIp: ip,
            printerId: state.id,
            source: 'manual'
          };
          delete completedJob.status;
          completedJobs.push(completedJob);
        } else {
          console.warn(`[Dispatcher] sent but UNCONFIRMED - requeued ${remoteFilename} for ${ip}`);
          throw new Error('Unconfirmed start');
        }
      } catch (err) {
        activeDispatches.delete(ip);
        if (err.message === 'Unconfirmed start') {
          console.error(`[Dispatcher] Unconfirmed start for ${ip} - moving directly to failedJobs.`);
          const failedJob = {
            ...job,
            failureReason: "unconfirmed_start",
            failureMessage: "Start command was sent but firmware did not confirm the active file. Check printer before requeueing.",
            lastPrinterIp: ip,
            failedAt: Date.now()
          };
          delete failedJob.status;
          failedJobs.push(failedJob);
        } else {
          console.error(`[Dispatcher] Failed manual start to ${ip}:`, err.message);
          job.attempts = (job.attempts || 0) + 1;
          if (job.attempts >= 3) {
            console.error(`[Dispatcher] Job ${job.filename} reached 3 failures, moving to failedJobs.`);
            const finalIndex = localQ.findIndex(j => j.id === job.id);
            if (finalIndex !== -1) localQ.splice(finalIndex, 1);
            const failedJob = {
              ...job,
              failureMessage: err.message,
              lastPrinterIp: ip,
              failedAt: Date.now()
            };
            delete failedJob.status;
            failedJobs.push(failedJob);
          } else {
            // It stays in localQ, just clear the sending status
            delete job.status;
          }
        }
      } finally {
        dispatchingPrinters.delete(ip);
      }
    })();
    
    res.writeHead(200);
    res.end('Started');
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/printers/pause')) {
    const ip = url.searchParams.get('ip');
    const state = getStateByIp(ip);
    if (!state) { res.writeHead(404); res.end('Printer not found'); return; }
    
    if (controlOperations.has(ip)) { res.writeHead(409, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Operation already in flight' })); return; }
    if (!isPrinterPrintingState(state.deviceState, state)) { res.writeHead(400); res.end('Printer is not printing'); return; }
    if (isPrinterPreparing(state)) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Printer is still heating or preparing. Pause becomes available when printing begins.' }));
      return;
    }

    controlOperations.set(ip, 'pausing');
    controlWarnings.delete(ip);
    
    try {
      await pausePrint(ip, state.printFileName);
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ status: 'ok' }));
    } catch (err) {
      if (err.message === 'timeout') {
        const warning = 'Pause was sent but the printer did not confirm it. Inspect the printer before trying again.';
        controlWarnings.set(ip, warning);
        res.writeHead(504, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: warning }));
      } else {
        res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'socket_error' }));
      }
    } finally {
      controlOperations.delete(ip);
    }
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/printers/resume')) {
    const ip = url.searchParams.get('ip');
    const state = getStateByIp(ip);
    if (!state) { res.writeHead(404); res.end('Printer not found'); return; }
    
    if (controlOperations.has(ip)) { res.writeHead(409, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Operation already in flight' })); return; }
    if (!isPrinterPausedState(state.deviceState, state)) { res.writeHead(400); res.end('Printer is not paused'); return; }

    controlOperations.set(ip, 'resuming');
    controlWarnings.delete(ip);
    
    try {
      await resumePrint(ip, state.printFileName);
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ status: 'ok' }));
    } catch (err) {
      if (err.message === 'timeout') {
        const warning = 'Resume was sent but the printer did not confirm it. Inspect the printer before trying again.';
        controlWarnings.set(ip, warning);
        res.writeHead(504, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: warning }));
      } else {
        res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'socket_error' }));
      }
    } finally {
      controlOperations.delete(ip);
    }
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/printers/cancel')) {
    const ip = url.searchParams.get('ip');
    const state = getStateByIp(ip);
    if (!state) { res.writeHead(404); res.end('Printer not found'); return; }
    
    if (controlOperations.has(ip)) { res.writeHead(409, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Operation already in flight' })); return; }
    if (!isPrinterPrintingState(state.deviceState, state) && !isPrinterPausedState(state.deviceState, state)) {
      res.writeHead(400); res.end('Printer is not actively printing or paused'); return; 
    }

    controlOperations.set(ip, 'canceling');
    controlWarnings.delete(ip);
    
    try {
      await cancelPrint(ip);
      
      const dispatch = activeDispatches.get(ip);
      activeDispatches.delete(ip);
      manualOverrides.set(ip, 'needs_clearing');
      if (state) state.farmState = 'needs_clearing';
      
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ status: 'ok' }));
    } catch (err) {
      if (err.message === 'timeout') {
        const warning = 'Cancel was sent but the printer did not confirm it. Inspect the printer before trying again.';
        controlWarnings.set(ip, warning);
        res.writeHead(504, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: warning }));
      } else {
        res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'socket_error' }));
      }
    } finally {
      controlOperations.delete(ip);
    }
    return;
  }
  
  if (req.method === 'POST' && url.pathname.startsWith('/api/upload')) {
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
});

// Dispatcher Loop: Matches queued jobs to free printers
const dispatchingPrinters = new Set();

let dispatcherInterval = null;

export function startDispatcher() {
  if (dispatcherInterval) return;
  dispatcherInterval = setInterval(async () => {
  reconcileActiveDispatches();
  for (const [id, state] of farmState.entries()) {
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

      job.status = 'sending';
      
      console.log(`[Dispatcher] Starting ${job.filename} on printer ${state.ip}...`);
      dispatchingPrinters.add(state.ip);
      beginDispatch(state, job, selection.source);
      
      try {
        const remoteFilename = await uploadGcode(state.ip, job.filePath);
        const dispatch = activeDispatches.get(state.ip);
        if (dispatch) dispatch.remoteFilename = remoteFilename;
        setDispatchPhase(state.ip, 'starting');
        await startPrint(state.ip, remoteFilename);
        setDispatchPhase(state.ip, 'confirming');
        const confirmed = await confirmPrinting(state.ip, remoteFilename);
        // On success or unconfirmed start (which is a hard fail), remove from source array
        const finalIndex = queueSource.findIndex(j => j.id === job.id);
        if (finalIndex !== -1) queueSource.splice(finalIndex, 1);

        if (confirmed) {
          setDispatchPhase(state.ip, 'preparing');
          console.log(`[Dispatcher] Successfully started ${remoteFilename} on ${state.ip}`);
          const completedJob = {
            ...job,
            completedAt: Date.now(),
            printerIp: state.ip,
            printerId: state.id,
            source: selection.source
          };
          delete completedJob.status;
          completedJobs.push(completedJob);
        } else {
          console.warn(`[Dispatcher] sent but UNCONFIRMED - requeued ${remoteFilename} for ${state.ip}`);
          throw new Error('Unconfirmed start');
        }
      } catch (err) {
        activeDispatches.delete(state.ip);
        if (err.message === 'Unconfirmed start') {
          console.error(`[Dispatcher] Unconfirmed start for ${state.ip} - moving directly to failedJobs.`);
          const failedJob = {
            ...job,
            failureReason: "unconfirmed_start",
            failureMessage: "Start command was sent but firmware did not confirm the active file. Check printer before requeueing.",
            lastPrinterIp: state.ip,
            failedAt: Date.now()
          };
          delete failedJob.status;
          failedJobs.push(failedJob);
        } else {
          console.error(`[Dispatcher] Failed to start on ${state.ip}:`, err.message);
          job.attempts = (job.attempts || 0) + 1;
          if (job.attempts >= 3) {
            console.error(`[Dispatcher] Job ${job.filename} reached 3 failures, moving to failedJobs.`);
            const finalIndex = queueSource.findIndex(j => j.id === job.id);
            if (finalIndex !== -1) queueSource.splice(finalIndex, 1);
            const failedJob = {
              ...job,
              failureMessage: err.message,
              lastPrinterIp: state.ip,
              failedAt: Date.now()
            };
            delete failedJob.status;
            failedJobs.push(failedJob);
          } else {
            // It stays in queue, just clear the sending status
            delete job.status;
          }
        }
      } finally {
        dispatchingPrinters.delete(state.ip);
      }
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
const HOST = process.env.HOST || '127.0.0.1';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Start polling the farm
  startFarmPolling(printers, 2000);
  startDispatcher();
  
  server.listen(PORT, HOST, () => {
    console.log(`PrinterFarm Dashboard running at http://${HOST}:${PORT}`);
  });
}

