import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmPrinting } from '../lib/creality.mjs';

class MockWebSocket {
  static message = null;

  constructor() {
    this.readyState = 1;
    this.listeners = new Map();
    setTimeout(() => {
      this.emit('open');
      if (MockWebSocket.message) this.emit('message', { data: JSON.stringify(MockWebSocket.message) });
    }, 0);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  send() {}
  close() {}
}

test('confirmPrinting() requires an exact active filename', async () => {
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = MockWebSocket;

  try {
    MockWebSocket.message = {
      deviceState: 'print',
      printFileName: '/usr/data/printer_data/gcodes/job.gcode'
    };
    assert.equal(await confirmPrinting('printer', 'job.gcode', 50), true);

    MockWebSocket.message = {
      deviceState: 1,
      printFileName: '/usr/data/printer_data/gcodes/job.gcode'
    };
    assert.equal(await confirmPrinting('printer', 'job.gcode', 50), true);

    MockWebSocket.message = {
      deviceState: 'print',
      printFileName: '/usr/data/printer_data/gcodes/old-job.gcode'
    };
    assert.equal(await confirmPrinting('printer', 'job.gcode', 20), false);

    MockWebSocket.message = {
      deviceState: 'idle',
      printFileName: '/usr/data/printer_data/gcodes/job.gcode'
    };
    assert.equal(await confirmPrinting('printer', 'job.gcode', 20), false);

    MockWebSocket.message = {
      deviceState: 3,
      printFileName: '/usr/data/printer_data/gcodes/job.gcode'
    };
    assert.equal(await confirmPrinting('printer', 'job.gcode', 20), false);

    MockWebSocket.message = {
      deviceState: 5,
      printFileName: '/usr/data/printer_data/gcodes/job.gcode'
    };
    assert.equal(await confirmPrinting('printer', 'job.gcode', 20), false);
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});
