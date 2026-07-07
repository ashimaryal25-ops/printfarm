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

test('judge() - Bug Fix: Marks a canceled print as free if heaters are off', () => {
  // Pass the Creality firmware bug scenario (deviceState says print, but heaters are cold)
  const input = {
    id: "1",
    ip: "10.0.0.1",
    status: "online",
    job: {
      deviceState: "print",
      printFileName: "canceled.gcode",
      printProgress: 12,
      targetNozzleTemp: 0,
      targetBedTemp: 0
    }
  };

  const result = judge(input);

  // The assertion: We expect the judge firewall to override it to "free"
  assert.equal(result.farmState, "free");
});
