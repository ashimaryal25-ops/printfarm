import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import fs from 'node:fs';
import assert from 'node:assert';

async function request(path, method = 'GET') {
  const res = await fetch(`http://127.0.0.1:3000${path}`, { method });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, body: json || text };
}

async function run() {
  const BACKUP = 'printers.json.bak';
  if (fs.existsSync('printers.json')) fs.renameSync('printers.json', BACKUP);
  fs.writeFileSync('printers.json', JSON.stringify([{ id: "1", ip: "127.0.0.1" }]));

  let mock, server;
  
  try {
    console.log("Starting mock printer...");
    mock = spawn('node', ['bin/mock-printer.mjs']);
    
    console.log("Starting server...");
    server = spawn('node', ['bin/server.mjs'], { env: { ...process.env, PORT: '3000' } });
    
    await setTimeout(4000); // give them time to start and probe
    
    // Enable auto-assign so dispatcher picks up the job
    await fetch('http://127.0.0.1:3000/api/settings/auto-assign?value=true', { method: 'POST' });
    
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('GCODE')]), 'test.gcode');
    const uploadRes = await fetch('http://127.0.0.1:3000/api/upload?filename=test.gcode', { method: 'POST', body: form });
    assert.strictEqual(uploadRes.status, 200, 'Upload should succeed');
    
    await setTimeout(4000); // wait for start confirmation
    let statusRes = await request('/api/status');
    assert.strictEqual(statusRes.body.farmState['1']?.farmState, 'busy', 'State should be busy after start');
    
    console.log("Pausing...");
    const pauseRes = await request('/api/printers/pause?ip=127.0.0.1', 'POST');
    assert.strictEqual(pauseRes.status, 200, 'Pause should succeed');
    await setTimeout(2000);
    statusRes = await request('/api/status');
    assert.strictEqual(statusRes.body.farmState['1']?.farmState, 'paused', 'State should be paused');
    
    console.log("Resuming...");
    const resumeRes = await request('/api/printers/resume?ip=127.0.0.1', 'POST');
    assert.strictEqual(resumeRes.status, 200, 'Resume should succeed');
    await setTimeout(2000);
    statusRes = await request('/api/status');
    assert.strictEqual(statusRes.body.farmState['1']?.farmState, 'busy', 'State should be busy again');
    
    console.log("Canceling...");
    const cancelRes = await request('/api/printers/cancel?ip=127.0.0.1', 'POST');
    assert.strictEqual(cancelRes.status, 200, 'Cancel should succeed');
    await setTimeout(2000);
    statusRes = await request('/api/status');
    assert.strictEqual(statusRes.body.farmState['1']?.farmState, 'needs_clearing', 'State should be needs_clearing');
    
    console.log("Integration test complete.");
  } finally {
    if (mock) mock.kill();
    if (server) server.kill();
    if (fs.existsSync(BACKUP)) {
      fs.renameSync(BACKUP, 'printers.json');
    } else if (fs.existsSync('printers.json')) {
      fs.unlinkSync('printers.json');
    }
    const scratchFiles = fs.readdirSync('scratch');
    for (const file of scratchFiles) {
      if (file.endsWith('_test.gcode')) fs.unlinkSync(`scratch/${file}`);
    }
  }
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
