export function matchesRoute(req, url, method, pathname) {
  return req.method === method && url.pathname === pathname;
}

export function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function sendText(res, status, body = '') {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}
