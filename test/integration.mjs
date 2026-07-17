import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

process.env.HTTP_PORT = '9999';

const {
  activeDispatches,
  completedJobs,
  controlOperations,
  controlWarnings,
  failedJobs,
  localAutoPrint,
  server,
  startDispatcher,
  stopDispatcher
} = await import('../bin/server.mjs');
const { startMockPrinter, stopMockPrinter } = await import('../bin/mock-printer.mjs');
const {
  farmState,
  jobQueue,
  manualOverrides,
  printerQueues,
  setPrinters,
  settings,
  startFarmPolling,
  stopFarmPolling
} = await import('../lib/farm.mjs');

const scratchBefore = new Set(fs.readdirSync('scratch'));

function listen() {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

function closeServer() {
  if (!server.listening) return Promise.resolve();
  server.closeAllConnections?.();
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

async function waitFor(check, message, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${message}`);
}

let baseUrl;
async function request(route, options) {
  const response = await fetch(`${baseUrl}${route}`, options);
  const text = await response.text();
  let body = text;
  try { body = JSON.parse(text); } catch {}
  return { response, body };
}

async function status() {
  const result = await request('/api/status');
  assert.equal(result.response.status, 200);
  return result.body;
}

try {
  await startMockPrinter();
  const port = await listen();
  baseUrl = `http://127.0.0.1:${port}`;

  const printers = [{ id: '1', ip: '127.0.0.1' }];
  setPrinters(printers);
  startFarmPolling(printers, 100);
  startDispatcher();

  await waitFor(
    async () => (await status()).farmState?.['1']?.farmState === 'free',
    'the mock printer to become free'
  );

  let result = await request('/api/settings/auto-assign?value=true', { method: 'POST' });
  assert.equal(result.response.status, 200);

  result = await request('/api/upload?filename=integration.gcode', {
    method: 'POST',
    body: 'G28\nM84\n'
  });
  assert.equal(result.response.status, 200);

  await waitFor(async () => {
    const data = await status();
    return data.activeJobs?.some(job =>
      job.printerIp === '127.0.0.1' && job.phase === 'printing'
    );
  }, 'Auto-Print to start printing', 30_000);

  result = await request('/api/printers/pause?ip=127.0.0.1', { method: 'POST' });
  assert.equal(result.response.status, 200);
  await waitFor(
    async () => (await status()).farmState?.['1']?.farmState === 'paused',
    'the printer to pause'
  );

  result = await request('/api/printers/resume?ip=127.0.0.1', { method: 'POST' });
  assert.equal(result.response.status, 200);
  await waitFor(
    async () => (await status()).farmState?.['1']?.farmState === 'busy',
    'the printer to resume'
  );

  result = await request('/api/printers/cancel?ip=127.0.0.1', { method: 'POST' });
  assert.equal(result.response.status, 200);
  await waitFor(
    async () => (await status()).farmState?.['1']?.farmState === 'needs_clearing',
    'the canceled printer to require bed clearing'
  );

  console.log('Integration flow passed: upload, Auto-Print, pause, resume, cancel.');
} finally {
  settings.autoAssign = false;
  stopDispatcher();
  stopFarmPolling();
  await closeServer();
  await stopMockPrinter();

  setPrinters([]);
  farmState.clear();
  jobQueue.length = 0;
  printerQueues.clear();
  manualOverrides.clear();
  activeDispatches.clear();
  controlOperations.clear();
  controlWarnings.clear();
  localAutoPrint.clear();
  completedJobs.length = 0;
  failedJobs.length = 0;

  for (const file of fs.readdirSync('scratch')) {
    if (!scratchBefore.has(file)) {
      fs.rmSync(path.join('scratch', file), { force: true });
    }
  }
}
