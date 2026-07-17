import test from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { server as backendServer, stopDispatcher, reconcileDiscoveredPrinters, controlOperations, activeDispatches, failedJobs, controlWarnings, deriveActiveJobPhase, isPrinterPreparing } from '../bin/server.mjs';
import { farmState, manualOverrides } from '../lib/farm.mjs';

export function createMockWebSocketServer(port, handler) {
  return new Promise((resolve) => {
    const server = createServer();
    const activeSockets = new Set();
    server.on('upgrade', (req, socket) => {
      activeSockets.add(socket);
      socket.on('close', () => activeSockets.delete(socket));
      const key = req.headers['sec-websocket-key'];
      const hash = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + hash + '\r\n\r\n');
      
      const sendFrame = (payload) => {
        const length = Buffer.byteLength(payload);
        const frame = Buffer.alloc(2 + length);
        frame[0] = 0x81;
        frame[1] = length;
        frame.write(payload, 2);
        socket.write(frame);
      };

      socket.on('data', (buffer) => {
        if (buffer.length < 6) return;
        const payloadLength = buffer[1] & 0x7F;
        let offset = 2;
        if (payloadLength === 126) offset += 2;
        else if (payloadLength === 127) offset += 8;
        const maskKey = buffer.slice(offset, offset + 4);
        offset += 4;
        const unmasked = Buffer.alloc(buffer.length - offset);
        for (let i = 0; i < unmasked.length; i++) unmasked[i] = buffer[offset + i] ^ maskKey[i % 4];
        handler(unmasked.toString('utf8'), sendFrame, socket);
      });
    });
    server.listen(port, '127.0.0.1', () => {
      const originalClose = server.close.bind(server);
      server.close = (cb) => {
        for (const s of activeSockets) s.destroy();
        activeSockets.clear();
        if (server.closeAllConnections) server.closeAllConnections();
        return originalClose(cb);
      };
      resolve(server);
    });
  });
}

async function request(path, method = 'GET') {
  return new Promise((resolve) => {
    const req = import('node:http').then(({ request: reqFunc }) => {
      const r = reqFunc(`http://127.0.0.1:3005${path}`, { method, agent: false }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(body); } catch {}
          resolve({ status: res.statusCode, body: json || body });
        });
      });
      r.on('error', (e) => resolve({ status: 0, body: e.message }));
      r.end();
    });
  });
}

test('Control operations confirm correctly via backend endpoints', async (t) => {
  // Start backend server on test port
  await new Promise(r => backendServer.listen(3005, '127.0.0.1', r));

  const IP = '127.0.0.1';
  // Mock the farm state to pretend we have a printer printing
  farmState.set('1', { id: '1', ip: IP, deviceState: '1', printFileName: 'test.gcode', farmState: 'busy', printProgress: 1 });
  activeDispatches.set(IP, { jobId: 'test-id', filename: 'test.gcode', filePath: 'scratch/test.gcode', source: 'manual', attempts: 0 });

  let wss;
  t.after(() => {
    if (wss) {
      if (wss.closeAllConnections) wss.closeAllConnections();
      wss.close();
    }
    if (backendServer.closeAllConnections) backendServer.closeAllConnections();
    backendServer.close();
    controlOperations.clear();
    activeDispatches.clear();
    farmState.clear();
    manualOverrides.clear();
    failedJobs.length = 0;
    controlWarnings.clear();
    stopDispatcher();
  });
  
  t.after(async () => {
    const fs = await import('node:fs');
    if (fs.existsSync('scratch/test.gcode')) fs.unlinkSync('scratch/test.gcode');
  });

  await t.test('POST /api/printers/pause confirms with fragmented telemetry', async () => {
    wss = await createMockWebSocketServer(9999, (msg, send) => {
      if (msg.includes('"pause":1')) {
        setTimeout(() => send(JSON.stringify({ deviceState: "1", state: 5 })), 50);
        setTimeout(() => send(JSON.stringify({ printFileName: "test.gcode" })), 100);
      }
    });

    const res = await request(`/api/printers/pause?ip=${IP}`, 'POST');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { status: 'ok' });
    assert.strictEqual(controlOperations.has(IP), false);
    
    wss.close();
  });

  await t.test('POST /api/printers/resume confirms with fragmented telemetry', async () => {
    farmState.set('1', { id: '1', ip: IP, deviceState: '1', printState: '5', printFileName: 'test.gcode', farmState: 'paused' });
    wss = await createMockWebSocketServer(9999, (msg, send) => {
      if (msg.includes('"pause":0')) {
        setTimeout(() => send(JSON.stringify({ deviceState: "1", state: 1 })), 50);
        setTimeout(() => send(JSON.stringify({ printFileName: "test.gcode" })), 100);
      }
    });

    const res = await request(`/api/printers/resume?ip=${IP}`, 'POST');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { status: 'ok' });
    assert.strictEqual(controlOperations.has(IP), false);
    
    wss.close();
  });

  await t.test('POST /api/printers/cancel confirms with aborted state and forces Needs Clearing', async () => {
    farmState.set('1', { id: '1', ip: IP, deviceState: '1', printFileName: 'test.gcode', farmState: 'busy' });
    
    // Create dummy file for cancel logic to preserve
    const fs = await import('node:fs');
    fs.writeFileSync('scratch/test.gcode', 'dummy');

    wss = await createMockWebSocketServer(9999, (msg, send) => {
      if (msg.includes('"stop":1')) {
        setTimeout(() => send(JSON.stringify({ deviceState: "4" })), 50);
      }
    });

    const res = await request(`/api/printers/cancel?ip=${IP}`, 'POST');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { status: 'ok' });
    
    // Needs clearing lock
    assert.strictEqual(manualOverrides.get(IP), 'needs_clearing');
    assert.strictEqual(activeDispatches.has(IP), false);
    
    // Requeued to failed jobs
    assert.strictEqual(failedJobs.length, 0);
    
    wss.close();
  });

  await t.test('Duplicate request returns 409', async () => {
    farmState.set('1', { id: '1', ip: IP, deviceState: '1', printFileName: 'test.gcode', farmState: 'busy', printProgress: 1 });
    controlOperations.set(IP, 'pausing');
    
    const res = await request(`/api/printers/pause?ip=${IP}`, 'POST');
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, 'Operation already in flight');
    
    controlOperations.delete(IP);
  });
  
  await t.test('Invalid state for pause returns 400', async () => {
    farmState.set('1', { id: '1', ip: IP, deviceState: '5', printFileName: 'test.gcode', farmState: 'paused' });
    
    const res = await request(`/api/printers/pause?ip=${IP}`, 'POST');
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body, 'Printer is not printing');
  });

  await t.test('Discovery migrates an active job to its changed IP by remote filename', () => {
    const oldIp = '192.168.137.54';
    const newIp = '192.168.137.45';
    activeDispatches.set(oldIp, {
      jobId: 'migrating-job',
      filename: 'Packout.gcode',
      filePath: 'scratch/1784086773581_Packout.gcode',
      printerIp: oldIp,
      printerId: '2',
      phase: 'printing'
    });

    reconcileDiscoveredPrinters([{
      id: '1',
      ip: newIp,
      hostname: 'Ender3V3KE-9D2F',
      farmState: 'paused',
      printFileName: '1784086773581_Packout.gcode',
      printProgress: 0,
      layer: 2,
      totalLayer: 250
    }]);

    assert.equal(activeDispatches.has(oldIp), false);
    assert.equal(activeDispatches.get(newIp)?.phase, 'paused');
    assert.equal(activeDispatches.get(newIp)?.printerId, '1');
    assert.equal(activeDispatches.get(newIp)?.layer, 2);
    activeDispatches.delete(newIp);
  });

  await t.test('Timeout coverage', async () => {
    process.env.TEST_TIMEOUT = '150';
    farmState.set('1', { id: '1', ip: IP, deviceState: '1', printFileName: 'test.gcode', farmState: 'busy', printProgress: 1 });
    
    const timeoutWss = await createMockWebSocketServer(9999, (msg, send) => {
      // Just swallow the message, send no confirmation
    });

    const res = await request(`/api/printers/pause?ip=${IP}`, 'POST');
    assert.strictEqual(res.status, 504);
    assert.match(res.body.error, /Pause was sent but the printer did not confirm it/);
    assert.strictEqual(controlWarnings.has(IP), true);
    
    if (timeoutWss.closeAllConnections) timeoutWss.closeAllConnections();
    timeoutWss.close();
    delete process.env.TEST_TIMEOUT;
  });
  await t.test('Phase derivation for Active Jobs', () => {
    // 1. Dispatch just confirmed (fallback phase = 'preparing')
    assert.strictEqual(deriveActiveJobPhase(null, 'preparing'), 'preparing');
    
    // 2. Busy + progress 0 + job time 0 -> preparing
    assert.strictEqual(deriveActiveJobPhase({ farmState: 'busy', printProgress: 0, printJobTime: 0 }), 'preparing');
    
    // 3. Busy + positive job time -> printing (real 0% print)
    assert.strictEqual(deriveActiveJobPhase({ farmState: 'busy', printProgress: 0, printJobTime: 1 }), 'printing');
    
    // 4. Busy + positive progress -> printing
    assert.strictEqual(deriveActiveJobPhase({ farmState: 'busy', printProgress: 1, printJobTime: 0 }), 'printing');
    
    // 5. Paused firmware state -> paused
    assert.strictEqual(deriveActiveJobPhase({ farmState: 'paused' }), 'paused');
    
    // 6. Fragmented telemetry (undefined progress/time) defaults to preparing
    assert.strictEqual(deriveActiveJobPhase({ farmState: 'busy' }), 'preparing');
    
    // 7. Control operation in flight overrides derived phase
    assert.strictEqual(deriveActiveJobPhase({ farmState: 'busy', printProgress: 50 }, 'printing', 'pausing'), 'pausing');
  });

  await t.test('Legacy canceled records are removed from failedJobs on status request', async () => {
    // Inject legacy records
    failedJobs.push({ id: 'legacy-1', failureReason: 'canceled', filename: 'Legacy.gcode', filePath: 'scratch/Legacy.gcode' });
    failedJobs.push({ id: 'legacy-2', failureReason: 'user_canceled', filename: 'Legacy2.gcode', filePath: 'scratch/Legacy2.gcode' });
    failedJobs.push({ id: 'legacy-3', failureMessage: 'User canceled the print.', filename: 'Legacy3.gcode', filePath: 'scratch/Legacy3.gcode' });
    
    // Inject genuine failure
    failedJobs.push({ id: 'genuine', failureReason: 'timeout', filename: 'RealFail.gcode', filePath: 'scratch/RealFail.gcode' });
    
    const fs = await import('node:fs');
    fs.writeFileSync('scratch/Legacy.gcode', 'dummy');

    const res = await request('/api/status', 'GET');
    assert.strictEqual(res.status, 200);
    
    assert.strictEqual(failedJobs.length, 1);
    assert.strictEqual(failedJobs[0].id, 'genuine');
    
    // Ensure file was not deleted
    assert.strictEqual(fs.existsSync('scratch/Legacy.gcode'), true);
    
    fs.unlinkSync('scratch/Legacy.gcode');
    failedJobs.length = 0;
  });
});
