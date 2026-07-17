import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeWebSocketFrames } from '../bin/mock-printer.mjs';

function maskedTextFrame(text, mask = Buffer.from([1, 2, 3, 4])) {
  const payload = Buffer.from(text);
  assert.ok(payload.length < 126, 'test helper supports short frames');
  const frame = Buffer.alloc(2 + 4 + payload.length);
  frame[0] = 0x81;
  frame[1] = 0x80 | payload.length;
  mask.copy(frame, 2);
  for (let i = 0; i < payload.length; i++) {
    frame[6 + i] = payload[i] ^ mask[i % 4];
  }
  return frame;
}

test('decodeWebSocketFrames reassembles a frame split across TCP chunks', () => {
  const frame = maskedTextFrame('{"method":"get"}');
  const first = decodeWebSocketFrames(Buffer.alloc(0), frame.subarray(0, 5));
  assert.equal(first.frames.length, 0);

  const second = decodeWebSocketFrames(first.pending, frame.subarray(5));
  assert.equal(second.frames.length, 1);
  assert.equal(second.frames[0].payload.toString(), '{"method":"get"}');
  assert.equal(second.pending.length, 0);
});

test('decodeWebSocketFrames parses every frame in a coalesced TCP chunk', () => {
  const chunk = Buffer.concat([
    maskedTextFrame('{"method":"get"}'),
    maskedTextFrame('{"method":"set"}')
  ]);
  const decoded = decodeWebSocketFrames(Buffer.alloc(0), chunk);

  assert.deepEqual(
    decoded.frames.map(frame => frame.payload.toString()),
    ['{"method":"get"}', '{"method":"set"}']
  );
  assert.equal(decoded.pending.length, 0);
});
