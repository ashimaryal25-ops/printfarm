import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge } from '../lib/probe.mjs';

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
  assert.equal(result.displayJob, "test.gcode 50%");
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
