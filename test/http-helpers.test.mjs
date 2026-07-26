import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesRoute } from '../lib/http-helpers.mjs';

test('matchesRoute requires an exact method and pathname', () => {
  const request = { method: 'GET' };
  const exact = new URL('http://localhost/api/status?refresh=true');
  const prefixOnly = new URL('http://localhost/api/status-extra');

  assert.equal(matchesRoute(request, exact, 'GET', '/api/status'), true);
  assert.equal(matchesRoute(request, exact, 'POST', '/api/status'), false);
  assert.equal(matchesRoute(request, prefixOnly, 'GET', '/api/status'), false);
});
