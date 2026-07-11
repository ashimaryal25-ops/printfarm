import path from 'node:path';

export function sanitizeFilename(name) {
  if (!name || typeof name !== 'string') return 'unknown.gcode';
  const base = path.basename(name).trim();
  const withExtension = base.toLowerCase().endsWith('.gcode') ? base : `${base}.gcode`;
  const cleaned = withExtension.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 160);
  return cleaned && cleaned !== '.gcode' ? cleaned : 'unknown.gcode';
}

export function isSafePath(baseDir, requestedPath) {
  const relativePath = String(requestedPath || '').replace(/^[/\\]+/, '');
  const resolved = path.resolve(baseDir, relativePath);
  const resolvedBase = path.resolve(baseDir);
  return resolved === resolvedBase || resolved.startsWith(resolvedBase + path.sep);
}

export function resolveSafePath(baseDir, requestedPath) {
  const relativePath = String(requestedPath || '').replace(/^[/\\]+/, '');
  if (!isSafePath(baseDir, relativePath)) return null;
  return path.resolve(baseDir, relativePath);
}
