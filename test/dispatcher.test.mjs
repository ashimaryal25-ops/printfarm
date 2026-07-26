import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobDispatcher } from '../lib/dispatcher.mjs';

const silentLogger = { log() {}, error() {} };

function setup(overrides = {}) {
  const activeDispatches = new Map();
  const failedJobs = [];
  const dispatchingPrinters = new Set();
  const calls = [];
  const dispatcher = createJobDispatcher({
    uploadGcode: async (ip, filePath) => {
      calls.push(['upload', ip, filePath]);
      return 'remote.gcode';
    },
    startPrint: async (ip, filename) => calls.push(['start', ip, filename]),
    confirmPrinting: async (ip, filename) => {
      calls.push(['confirm', ip, filename]);
      return true;
    },
    activeDispatches,
    failedJobs,
    dispatchingPrinters,
    logger: silentLogger,
    ...overrides
  });

  const state = { id: '2', ip: '192.168.1.20', farmState: 'free' };
  const job = { id: 'job-1', filename: 'part.gcode', filePath: 'scratch/part.gcode', attempts: 0 };
  const queue = [job];
  return { dispatcher, activeDispatches, failedJobs, dispatchingPrinters, calls, state, job, queue };
}

test('confirmed dispatch removes the queued job and retains active tracking', async () => {
  const context = setup();
  const result = await context.dispatcher.dispatch({
    state: context.state,
    job: context.job,
    queue: context.queue,
    source: 'global'
  });

  assert.equal(result.status, 'started');
  assert.deepEqual(context.queue, []);
  assert.equal(context.failedJobs.length, 0);
  assert.equal(context.activeDispatches.get(context.state.ip).phase, 'preparing');
  assert.equal(context.activeDispatches.get(context.state.ip).remoteFilename, 'remote.gcode');
  assert.deepEqual(context.calls.map(call => call[0]), ['upload', 'start', 'confirm']);
  assert.equal(context.dispatchingPrinters.size, 0);
});

test('unconfirmed start leaves the queue and becomes a non-retryable failed job', async () => {
  const context = setup({ confirmPrinting: async () => false });
  const result = await context.dispatcher.dispatch({
    state: context.state,
    job: context.job,
    queue: context.queue,
    source: 'manual'
  });

  assert.equal(result.reason, 'unconfirmed_start');
  assert.deepEqual(context.queue, []);
  assert.equal(context.activeDispatches.size, 0);
  assert.equal(context.failedJobs[0].failureReason, 'unconfirmed_start');
  assert.equal(context.failedJobs[0].status, undefined);
});

test('transient failure leaves the job queued and available for retry', async () => {
  const context = setup({ uploadGcode: async () => { throw new Error('offline'); } });
  const result = await context.dispatcher.dispatch({
    state: context.state,
    job: context.job,
    queue: context.queue,
    source: 'local'
  });

  assert.equal(result.status, 'retryable');
  assert.equal(context.job.attempts, 1);
  assert.equal(context.job.status, undefined);
  assert.deepEqual(context.queue, [context.job]);
  assert.equal(context.failedJobs.length, 0);
});

test('third failure removes the job and records the terminal error', async () => {
  const context = setup({ uploadGcode: async () => { throw new Error('offline'); } });
  context.job.attempts = 2;
  const result = await context.dispatcher.dispatch({
    state: context.state,
    job: context.job,
    queue: context.queue,
    source: 'local'
  });

  assert.equal(result.reason, 'attempt_limit');
  assert.deepEqual(context.queue, []);
  assert.equal(context.failedJobs[0].attempts, 3);
  assert.equal(context.failedJobs[0].failureMessage, 'offline');
});
