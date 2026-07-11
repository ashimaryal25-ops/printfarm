import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { startFarmPolling, farmState, jobQueue, manualOverrides, settings, printerQueues } from '../lib/farm.mjs';
import { uploadGcode, startPrint } from '../lib/creality.mjs';
import { sanitizeFilename, resolveSafePath } from '../lib/server-helpers.mjs';

const PUBLIC_DIR = path.join(process.cwd(), 'public');
const SCRATCH_DIR = path.join(process.cwd(), 'scratch');
if (!fs.existsSync(SCRATCH_DIR)) fs.mkdirSync(SCRATCH_DIR);

// Load printers
const PRINTERS_JSON = "printers.json";
let printers = [{ id: "1", ip: "127.0.0.1" }]; // Default for local simulator
if (fs.existsSync(PRINTERS_JSON)) {
  try {
    printers = JSON.parse(fs.readFileSync(PRINTERS_JSON, "utf8"));
  } catch(e) {
    console.error("Failed to parse printers.json", e);
  }
} else {
  // If running locally with mock-printer, it uses port 9999 for both WS and HTTP
  process.env.HTTP_PORT = 9999;
}

// Start polling the farm
startFarmPolling(printers, 2000);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  if (req.method === 'GET' && url.pathname.startsWith('/api/status')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      farmState: Object.fromEntries(farmState),
      jobQueue,
      manualOverrides: Object.fromEntries(manualOverrides),
      settings,
      printerQueues: Object.fromEntries(printerQueues)
    }));
    return;
  }
  
  if (req.method === 'POST' && url.pathname.startsWith('/api/clear-bed')) {
    const ip = url.searchParams.get('ip');
    if (ip) manualOverrides.delete(ip);
    res.writeHead(200);
    res.end('Cleared');
    return;
  }
  
  if (req.method === 'POST' && url.pathname.startsWith('/api/settings/auto-assign')) {
    const value = url.searchParams.get('value') === 'true';
    settings.autoAssign = value;
    res.writeHead(200);
    res.end('Settings updated');
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
    
    const state = [...farmState.values()].find(p => p.ip === ip);
    if (!state || state.farmState !== 'free' || dispatchingPrinters.has(ip)) {
      res.writeHead(400);
      res.end('Printer not available');
      return;
    }
    
    const [job] = localQ.splice(jobIndex, 1);
    console.log(`[API] Manually starting ${job.filename} on printer ${ip}...`);
    dispatchingPrinters.add(ip);
    
    (async () => {
      try {
        const remoteFilename = await uploadGcode(ip, job.filePath);
        await startPrint(ip, remoteFilename);
        console.log(`[Dispatcher] Successfully started ${remoteFilename} on ${ip}`);
        fs.unlinkSync(job.filePath);
      } catch (err) {
        console.error(`[Dispatcher] Failed manual start to ${ip}:`, err.message);
        localQ.unshift(job); // put back in local queue
      } finally {
        dispatchingPrinters.delete(ip);
      }
    })();
    
    res.writeHead(200);
    res.end('Started');
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
        id: Date.now().toString(),
        filename,
        filePath: savePath
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

setInterval(async () => {
  for (const [id, state] of farmState.entries()) {
    if (state.farmState === 'free' && !dispatchingPrinters.has(state.ip)) {
      
      const localQ = printerQueues.get(state.ip) || [];
      let job = null;
      let queueSource = null;
      
      // Auto-Assign pulls from Global Queue ONLY
      if (settings.autoAssign && jobQueue.length > 0) {
        job = jobQueue.shift();
        queueSource = jobQueue;
      }
      
      if (!job) continue; // No jobs available for auto-assign
      
      console.log(`[Dispatcher] Starting ${job.filename} on printer ${state.ip}...`);
      dispatchingPrinters.add(state.ip);
      
      try {
        const remoteFilename = await uploadGcode(state.ip, job.filePath);
        await startPrint(state.ip, remoteFilename);
        console.log(`[Dispatcher] Successfully started ${remoteFilename} on ${state.ip}`);
        fs.unlinkSync(job.filePath); // Cleanup
      } catch (err) {
        console.error(`[Dispatcher] Failed to start on ${state.ip}:`, err.message);
        // Put job back at the front of whichever queue it came from
        queueSource.unshift(job);
      } finally {
        dispatchingPrinters.delete(state.ip);
      }
    }
  }
}, 3000);

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
server.listen(PORT, HOST, () => {
  console.log(`PrinterFarm Dashboard running at http://${HOST}:${PORT}`);
});
