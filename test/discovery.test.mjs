import test from 'node:test';
import assert from 'node:assert';
import { isValidSubnet, scanSubnet, normalizeSubnetInput } from '../lib/discovery.mjs';

test('isValidSubnet() - accepts valid RFC1918 subnets', () => {
  assert.strictEqual(isValidSubnet('192.168.137'), true);
  assert.strictEqual(isValidSubnet('192.168.1'), true);
  assert.strictEqual(isValidSubnet('10.0.0'), true);
  assert.strictEqual(isValidSubnet('172.16.5'), true);
  assert.strictEqual(isValidSubnet('172.31.255'), true);
});

test('isValidSubnet() - rejects invalid and public subnets', () => {
  // Public
  assert.strictEqual(isValidSubnet('8.8.8'), false);
  assert.strictEqual(isValidSubnet('1.1.1'), false);
  
  // RFC1918 out of bounds
  assert.strictEqual(isValidSubnet('172.15.1'), false);
  assert.strictEqual(isValidSubnet('172.32.1'), false);
  assert.strictEqual(isValidSubnet('192.169.1'), false);
  
  // Malformed
  assert.strictEqual(isValidSubnet('192.168'), false);
  assert.strictEqual(isValidSubnet('192.168.1.1'), false);
  assert.strictEqual(isValidSubnet('abc.def.ghi'), false);
  assert.strictEqual(isValidSubnet('192.168.-1'), false);
  assert.strictEqual(isValidSubnet('192.168.256'), false);
});

test('scanSubnet() - rejects public subnets before scanning', async () => {
  await assert.rejects(
    () => scanSubnet('8.8.8', { start: 1, end: 1, timeoutMs: 10, concurrency: 1 }),
    /Invalid or unsupported subnet/
  );
});

test('scanSubnet() - supports bounded empty scans', async () => {
  const result = await scanSubnet('192.168.254', {
    start: 254,
    end: 254,
    timeoutMs: 10,
    concurrency: 1,
    probeFn: async (printer) => ({ ...printer, status: 'unreachable', job: 'timeout' })
  });

  assert.strictEqual(result.subnet, '192.168.254');
  assert.deepStrictEqual(result.found, []);
  assert.strictEqual(result.scanned, 1);
  assert.ok(result.durationMs >= 0);
});

test('scanSubnet() - returns judged online printers from probe results', async () => {
  const result = await scanSubnet('192.168.137', {
    start: 10,
    end: 11,
    timeoutMs: 10,
    concurrency: 2,
    probeFn: async (printer) => {
      if (printer.ip.endsWith('.10')) {
        return {
          ...printer,
          status: 'online',
          job: {
            deviceState: 'print',
            printFileName: 'demo.gcode',
            printProgress: 42,
            targetNozzleTemp: 210,
            targetBedTemp: 60
          }
        };
      }
      return { ...printer, status: 'unreachable', job: 'timeout' };
    }
  });

  assert.strictEqual(result.scanned, 2);
  assert.equal(result.found.length, 1);
  assert.equal(result.found[0].ip, '192.168.137.10');
  assert.equal(result.found[0].farmState, 'busy');
});

test('normalizeSubnetInput() - normalizes full IPs and subnets', () => {
  assert.strictEqual(normalizeSubnetInput('192.168.1'), '192.168.1');
  assert.strictEqual(normalizeSubnetInput('192.168.1.1'), '192.168.1');
  assert.strictEqual(normalizeSubnetInput('192.168.1.42'), '192.168.1');
  assert.strictEqual(normalizeSubnetInput('192.168.137.10'), '192.168.137');
  assert.strictEqual(normalizeSubnetInput('172.20.10.2'), '172.20.10');
});

test('normalizeSubnetInput() - rejects public or invalid IPs', () => {
  assert.throws(() => normalizeSubnetInput('138.234.1.1'), /Not a private network/);
  assert.throws(() => normalizeSubnetInput('8.8.8'), /Not a private network/);
  assert.throws(() => normalizeSubnetInput(''), /Not a private network/);
  
  // Malformed full IPs
  assert.throws(() => normalizeSubnetInput('192.168.1.foo'), /Not a private network/);
  assert.throws(() => normalizeSubnetInput('192.168.1.999'), /Not a private network/);
  assert.throws(() => normalizeSubnetInput('192.168.1.-1'), /Not a private network/);
  assert.throws(() => normalizeSubnetInput('192.168..1'), /Not a private network/);
});
