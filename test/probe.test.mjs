import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derivePrintProgress, judge } from '../lib/probe.mjs';

test('derivePrintProgress() falls back to advancing layer telemetry', () => {
  assert.equal(derivePrintProgress(0, 9, 18), 50);
  assert.equal(derivePrintProgress(undefined, 1, 3), 33);
  assert.equal(derivePrintProgress(0, 0, 18), 0);
  assert.equal(derivePrintProgress(27, 9, 18), 27);
});

test('judge() - Returns error if network connection fails', () => {
  // Pass a simulated printer object that failed to connect
  const input = {
    id: "1",
    ip: "10.0.0.1",
    status: "unreachable",
    job: "timeout"
  };

  const result = judge(input);
  
  assert.equal(result.farmState, "error");
  assert.equal(result.displayJob, "timeout");
});

test('judge() - Incomplete online telemetry is never classified as free', () => {
  const result = judge({ id: '1', ip: '127.0.0.1', status: 'online', job: {} });
  assert.equal(result.farmState, 'error');
  assert.equal(result.telemetryComplete, false);
});

test('judge() - Marks a printer as busy during an active print', () => {
  // Pass a simulated printer object with hot heaters
  const input = {
    id: "1",
    ip: "10.0.0.1",
    status: "online",
    job: {
      deviceState: "print",
      printFileName: "test.gcode",
      printProgress: 50,
      targetNozzleTemp: 210,
      targetBedTemp: 60
    }
  };

  const result = judge(input);

  assert.equal(result.farmState, "busy");
  assert.equal(result.displayJob, "test.gcode");
  assert.equal(result.printProgress, 50);
});

test('judge() derives progress from layers when printer percentage is stuck at zero', () => {
  const result = judge({
    id: '4',
    ip: '192.168.137.134',
    status: 'online',
    job: {
      deviceState: 'print',
      printFileName: 'kf_eric.gcode',
      printProgress: 0,
      layer: 9,
      totalLayer: 18
    }
  });

  assert.equal(result.farmState, 'busy');
  assert.equal(result.printProgress, 50);
  assert.equal(result.displayJob, 'kf_eric.gcode');
});

test('judge() - Keeps a reported print busy while target temperatures are zero', () => {
  // Fresh starts can report zero targets briefly. They must remain reserved.
  const input = {
    id: "1",
    ip: "10.0.0.1",
    status: "online",
    job: {
      deviceState: "print",
      printFileName: "starting.gcode",
      printProgress: 12,
      targetNozzleTemp: 0,
      targetBedTemp: 0
    }
  };

  const result = judge(input);

  assert.equal(result.farmState, "busy");
});

test('judge() - Recognizes Creality numeric running and paused states', () => {
  const running = judge({
    id: '1',
    ip: '10.0.0.1',
    status: 'online',
    job: { deviceState: 1, printFileName: 'numeric.gcode', printProgress: 2 }
  });
  const paused = judge({
    id: '1',
    ip: '10.0.0.1',
    status: 'online',
    job: { deviceState: 1, printState: 5, printFileName: 'numeric.gcode', printProgress: 2, layer: 7, totalLayer: 100 }
  });

  assert.equal(running.farmState, 'busy');
  assert.equal(paused.farmState, 'paused');
  assert.equal(paused.layer, 7);
  assert.equal(paused.totalLayer, 100);
});

test('judge() - Keeps deviceState 1 active while print state is preparing', () => {
  const preparing = judge({
    id: '1',
    ip: '10.0.0.1',
    status: 'online',
    job: { deviceState: 1, printState: 0, printFileName: 'starting.gcode', printProgress: 0 }
  });

  assert.equal(preparing.farmState, 'busy');
});

test('judge() - Requires bed clearing after complete, failed, or aborted jobs', () => {
  for (const deviceState of [0, 2, 3, 4]) {
    const result = judge({
      id: '1',
      ip: '10.0.0.1',
      status: 'online',
      job: { deviceState, printFileName: 'finished.gcode', printProgress: 0 }
    });
    assert.equal(result.farmState, 'needs_clearing');
  }

  const emptyBed = judge({
    id: '1',
    ip: '10.0.0.1',
    status: 'online',
    job: { deviceState: 4, printFileName: '', printProgress: 0 }
  });
  assert.equal(emptyBed.farmState, 'free');
});
