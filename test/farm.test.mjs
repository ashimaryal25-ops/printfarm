import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseAutoDispatchJob, farmState, getPrinters, setPrinters, settings } from '../lib/farm.mjs';

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
