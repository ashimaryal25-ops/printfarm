import os from 'node:os';
import { probe, judge } from './probe.mjs';

/**
 * Validates a /24 IPv4 subnet prefix (e.g. "192.168.137").
 * Restricts to RFC1918 private IP ranges to prevent scanning public networks.
 */
export function isValidSubnet(subnet) {
  if (!subnet || typeof subnet !== 'string') return false;
  const parts = subnet.split('.');
  if (parts.length !== 3) return false;
  if (!parts.every(p => /^\d+$/.test(p) && Number(p) >= 0 && Number(p) <= 255)) return false;
  
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  
  return false;
}

/**
 * Normalizes an input string to a /24 IPv4 subnet prefix (e.g. "192.168.137").
 * Handles full IPs like "192.168.137.10" -> "192.168.137".
 * Rejects public IPs.
 */
export function normalizeSubnetInput(input) {
  if (!input || typeof input !== 'string') {
    throw new Error('Not a private network. Please enter a private network like 192.168.1, or paste a printer/router IP like 192.168.1.42.');
  }
  
  const trimmed = input.trim();
  const parts = trimmed.split('.');
  
  if (parts.length !== 3 && parts.length !== 4) {
    throw new Error('Not a private network. Please enter a private network like 192.168.1, or paste a printer/router IP like 192.168.1.42.');
  }
  
  if (!parts.every(p => /^\d+$/.test(p) && Number(p) >= 0 && Number(p) <= 255)) {
    throw new Error('Not a private network. Please enter a private network like 192.168.1, or paste a printer/router IP like 192.168.1.42.');
  }
  
  if (parts.length === 4) {
    parts.pop();
  }
  
  const subnet = parts.join('.');
  
  if (!isValidSubnet(subnet)) {
    throw new Error('Not a private network. Please enter a private network like 192.168.1, or paste a printer/router IP like 192.168.1.42.');
  }
  
  return subnet;
}

/**
 * Returns candidate local IPv4 /24 subnets.
 */
export function localSubnets() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const [name, niList] of Object.entries(ifaces)) {
    for (const ni of niList) {
      if (ni.family === 'IPv4' && !ni.internal) {
        const parts = ni.address.split('.');
        const subnet = `${parts[0]}.${parts[1]}.${parts[2]}`;
        const cidr = `${subnet}.0/24`;
        candidates.push({
          iface: name,
          address: ni.address,
          subnet,
          cidr,
          preferred: isValidSubnet(subnet)
        });
      }
    }
  }
  return candidates;
}

/**
 * Returns the best candidate subnet string.
 */
export function localSubnet() {
  const subnets = localSubnets();
  if (subnets.length === 0) return null;
  
  // Prefer Windows mobile hotspot default
  const hotspot = subnets.find(s => s.subnet === '192.168.137');
  if (hotspot) return hotspot.subnet;
  
  const preferred = subnets.find(s => s.preferred);
  if (preferred) return preferred.subnet;
  
  return null;
}

/**
 * Scans a given /24 subnet for stock Creality printers via WS:9999.
 * 
 * @param {string} subnet 
 * @param {object} options 
 * @returns {Promise<{ subnet, found, scanned, durationMs }>}
 */
export async function scanSubnet(subnet, options = {}) {
  if (!isValidSubnet(subnet)) {
    throw new Error(`Invalid or unsupported subnet: ${subnet}. Must be RFC1918 /24 (e.g. 192.168.1).`);
  }

  const timeoutMs = options.timeoutMs || 1500;
  const concurrency = options.concurrency || 40;
  const start = options.start || 1;
  const end = options.end || 254;
  const probeFn = options.probeFn || probe;

  const targets = [];
  for (let i = start; i <= end; i++) {
    targets.push({ id: `scan_${i}`, ip: `${subnet}.${i}` });
  }

  const found = [];
  const startTime = Date.now();

  for (let i = 0; i < targets.length; i += concurrency) {
    const chunk = targets.slice(i, i + concurrency);
    const results = await Promise.all(chunk.map(t => probeFn(t, timeoutMs)));
    
    for (const r of results) {
      if (r.status === 'online') {
        found.push(judge(r));
      }
    }
  }

  const durationMs = Date.now() - startTime;
  return {
    subnet,
    found,
    scanned: end - start + 1,
    durationMs
  };
}
