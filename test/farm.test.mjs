import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseAutoDispatchJob, farmState, getPrinters, manualOverrides, requireBedClearance, setPrinters, settings, startFarmPolling, stopFarmPolling } from '../lib/farm.mjs';

test('global Auto-Print defaults off', () => {
  assert.equal(settings.autoAssign, false);
});

test('setPrinters() updates active printers and prunes stale IDs', () => {
  farmState.clear();
  farmState.set('old-id', {
    id: 'old-id',
    ip: '192.168.137.10',
    farmState: 'free'
  });

  setPrinters([{ id: '1', ip: '192.168.137.10' }]);

  assert.deepEqual(getPrinters(), [{ id: '1', ip: '192.168.137.10' }]);
  assert.equal(farmState.has('old-id'), false);
});

test('requireBedClearance() locks newly discovered idle printers', () => {
  farmState.clear();
  manualOverrides.clear();
  farmState.set('1', {
    id: '1',
    ip: '192.168.137.28',
    farmState: 'free'
  });

  requireBedClearance([
    { id: '1', ip: '192.168.137.28', farmState: 'free' }
  ]);

  assert.equal(manualOverrides.get('192.168.137.28'), 'needs_clearing');
  assert.equal(farmState.get('1').farmState, 'needs_clearing');
});

test('requireBedClearance() does not hide an active print', () => {
  farmState.clear();
  manualOverrides.clear();
  manualOverrides.set('192.168.137.28', 'needs_clearing');

  requireBedClearance([
    { id: '1', ip: '192.168.137.28', farmState: 'busy' }
  ]);

  assert.equal(manualOverrides.has('192.168.137.28'), false);
});

test('polling replaces stale online telemetry when a printer becomes unreachable', async (t) => {
  farmState.clear();
  manualOverrides.clear();
  farmState.set('offline', {
    id: 'offline',
    ip: '127.0.0.2',
    status: 'online',
    farmState: 'free',
    telemetryComplete: true
  });

  t.after(() => stopFarmPolling());
  startFarmPolling([{ id: 'offline', ip: '127.0.0.2' }], 50);

  const deadline = Date.now() + 1000;
  while (farmState.get('offline')?.status !== 'unreachable' && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }

  assert.equal(farmState.get('offline')?.status, 'unreachable');
  assert.equal(farmState.get('offline')?.farmState, 'error');
});

test('chooseAutoDispatchJob() reserves local Auto-Print printers from the global queue', () => {
  const globalJob = { id: 'global', filename: 'global.gcode' };
  const result = chooseAutoDispatchJob({
    localQueue: [],
    globalQueue: [globalJob],
    localAutoEnabled: true,
    globalAutoEnabled: true
  });

  assert.equal(result, null);
});

test('chooseAutoDispatchJob() prioritizes a local job when local Auto-Print is enabled', () => {
  const localJob = { id: 'local', filename: 'local.gcode' };
  const globalJob = { id: 'global', filename: 'global.gcode' };
  const result = chooseAutoDispatchJob({
    localQueue: [localJob],
    globalQueue: [globalJob],
    localAutoEnabled: true,
    globalAutoEnabled: true
  });

  assert.equal(result.job, localJob);
  assert.equal(result.source, 'local');
});

test('chooseAutoDispatchJob() uses the global queue only for non-local Auto-Print printers', () => {
  const globalJob = { id: 'global', filename: 'global.gcode' };
  const result = chooseAutoDispatchJob({
    localQueue: [],
    globalQueue: [globalJob],
    localAutoEnabled: false,
    globalAutoEnabled: true
  });

  assert.equal(result.job, globalJob);
  assert.equal(result.source, 'global');
});
