import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { sanitizeFilename, isSafePath, resolveSafePath } from '../lib/server-helpers.mjs';

test('sanitizeFilename() - Validates and forces .gcode', () => {
  assert.equal(sanitizeFilename('test.gcode'), 'test.gcode');
  assert.equal(sanitizeFilename('TEST.GCODE'), 'TEST.GCODE');
  assert.equal(sanitizeFilename('path/to/my_file.gcode'), 'my_file.gcode');
  assert.equal(sanitizeFilename('no_extension'), 'no_extension.gcode');
  assert.equal(sanitizeFilename('sneaky.gcode.txt'), 'sneaky.gcode.txt.gcode');
  assert.equal(sanitizeFilename('bad<script>.gcode'), 'bad_script_.gcode');
  assert.equal(sanitizeFilename(''), 'unknown.gcode');
});

test('isSafePath() - Prevents directory traversal', () => {
  const base = path.join(process.cwd(), 'public');
  
  // Safe paths
  assert.equal(isSafePath(base, 'index.html'), true);
  assert.equal(isSafePath(base, '/app.js'), true);
  assert.equal(isSafePath(base, 'css/style.css'), true);
  assert.equal(isSafePath(base, './app.js'), true);
  assert.equal(isSafePath(base, ''), true); // Root is safe
  
  // Traversal attacks
  assert.equal(isSafePath(base, '../package.json'), false);
  assert.equal(isSafePath(base, '../../etc/passwd'), false);
  
  // Suffix traversal
  const fakeBase = path.join(process.cwd(), 'public2');
  assert.equal(isSafePath(base, path.relative(base, fakeBase)), false);
});

test('resolveSafePath() - Resolves browser URL paths inside public', () => {
  const base = path.join(process.cwd(), 'public');

  assert.equal(resolveSafePath(base, '/theme.css'), path.resolve(base, 'theme.css'));
  assert.equal(resolveSafePath(base, '/nested/app.js'), path.resolve(base, 'nested/app.js'));
  assert.equal(resolveSafePath(base, '/../package.json'), null);
});
