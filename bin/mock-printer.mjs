import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const DEFAULT_PORT = 9999;

// The global mutable state of our mock printer
let fakeState = {
  deviceState: "free",
  printFileName: "",
  printProgress: 0,
  nozzleTemp: 25,
  bedTemp: 25,
  targetNozzleTemp: 0,
  targetBedTemp: 0
};

let progressTimer = null;
const sockets = new Set();

// We use the raw Node.js HTTP server to handle both file uploads and WebSockets
const server = createServer((req, res) => {
  
  // 1. Handle HTTP POST uploads (multipart/form-data simulation)
  if (req.method === 'POST' && req.url.startsWith('/upload/')) {
    // We just consume the stream so the client doesn't hang, then reply 200 OK.
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 0, msg: "success" }));
      console.log(`[Mock Printer] Received HTTP file upload: ${req.url}`);
    });
    return;
  }

  res.writeHead(400, { 'Content-Type': 'text/plain' });
  res.end('WebSocket or Upload connections only');
});

// 2. Handle WebSocket upgrades
server.on('upgrade', (req, socket) => {
  sockets.add(socket);
  socket.once('close', () => sockets.delete(socket));
  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.end();

  // Standard WebSocket handshake magic string (RFC 6455)
  const hash = createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${hash}\r\n\r\n`
  );

  socket.on('error', (err) => {
    // Ignore client disconnects
  });

  socket.on('data', (buffer) => {
    if (buffer.length < 6) return;
    
    // Client frames MUST be masked. We have to manually unmask the binary payload.
    const isMasked = (buffer[1] & 0x80) === 0x80;
    if (!isMasked) return; 

    let payloadLength = buffer[1] & 0x7F;
    let offset = 2;
    if (payloadLength === 126) offset += 2;
    else if (payloadLength === 127) offset += 8;

    const maskKey = buffer.slice(offset, offset + 4);
    offset += 4;
    
    const unmasked = Buffer.alloc(buffer.length - offset);
    for (let i = 0; i < unmasked.length; i++) {
      unmasked[i] = buffer[offset + i] ^ maskKey[i % 4];
    }
    
    const msg = unmasked.toString('utf8');

    // Scenario A: Client sends the "Start Print", "Pause", "Resume", or "Stop" command
    if (msg.includes('"method":"set"')) {
      let m;
      try { m = JSON.parse(msg); } catch (e) {}

      if (m && m.params && m.params.pause === 1) {
        console.log(`[Mock Printer] Received pause command`);
        fakeState.deviceState = "5";
        return;
      }
      
      if (m && m.params && m.params.pause === 0) {
        console.log(`[Mock Printer] Received resume command`);
        fakeState.deviceState = "1";
        return;
      }
      
      if (m && m.params && m.params.stop === 1) {
        console.log(`[Mock Printer] Received stop command`);
        fakeState.deviceState = "4"; // aborted
        if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
        return;
      }

      if (m && m.params && m.params.opGcodeFile) {
        console.log(`[Mock Printer] Received start command... warming up heaters!`);
        fakeState.deviceState = "1";
        fakeState.targetNozzleTemp = 210;
        fakeState.targetBedTemp = 60;
        fakeState.printProgress = 0;
        
        const match = m.params.opGcodeFile.match(/printprt:.*\/([^/]+\.gcode)/);
        if (match) fakeState.printFileName = match[1];
        
        if (progressTimer) clearInterval(progressTimer);
        
        progressTimer = setInterval(() => {
          if (fakeState.deviceState === "5") return; // Paused, don't heat or print
          if (fakeState.deviceState === "4" || fakeState.deviceState === "2" || fakeState.deviceState === "3" || fakeState.deviceState === "0") {
             clearInterval(progressTimer); progressTimer = null; return;
          }

          let heated = true;
          
          if (fakeState.targetBedTemp > 0) {
            if (fakeState.bedTemp < fakeState.targetBedTemp) {
              fakeState.bedTemp = Math.min(fakeState.targetBedTemp, fakeState.bedTemp + 5);
              heated = false;
            }
          } else if (fakeState.bedTemp > 25) {
            fakeState.bedTemp = Math.max(25, fakeState.bedTemp - 5);
          }
          
          if (fakeState.targetNozzleTemp > 0) {
            if (fakeState.nozzleTemp < fakeState.targetNozzleTemp) {
              fakeState.nozzleTemp = Math.min(fakeState.targetNozzleTemp, fakeState.nozzleTemp + 15);
              heated = false;
            }
          } else if (fakeState.nozzleTemp > 25) {
            fakeState.nozzleTemp = Math.max(25, fakeState.nozzleTemp - 15);
          }

          if (heated && fakeState.printProgress < 100) {
            fakeState.printProgress += 1;
          }
          
          if (fakeState.printProgress >= 100) {
            clearInterval(progressTimer);
            progressTimer = null;
            fakeState.deviceState = "2"; // Complete
            fakeState.targetNozzleTemp = 0;
            fakeState.targetBedTemp = 0;
          }
        }, 1000);
        return;
      }
    }

    // Scenario B: Client asks for live telemetry
    if (msg.includes('"method":"get"')) {
      const payload = JSON.stringify(fakeState);
      const length = Buffer.byteLength(payload);
      
      // Construct an unmasked WebSocket text frame (servers don't mask)
      let frame;
      if (length < 126) {
        frame = Buffer.alloc(2 + length);
        frame[0] = 0x81; // FIN = 1, Opcode = 1 (Text)
        frame[1] = length;
        frame.write(payload, 2);
      } else {
        frame = Buffer.alloc(4 + length);
        frame[0] = 0x81;
        frame[1] = 126;
        frame.writeUInt16BE(length, 2);
        frame.write(payload, 4);
      }
      socket.write(frame);
    }
  });
});

export function startMockPrinter({ port = DEFAULT_PORT, host = '127.0.0.1' } = {}) {
  if (server.listening) return Promise.resolve(server);

  return new Promise((resolve, reject) => {
    const onError = error => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(server);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

export function stopMockPrinter() {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
  if (!server.listening) return Promise.resolve();

  for (const socket of sockets) socket.destroy();
  sockets.clear();
  server.closeAllConnections?.();
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.MOCK_PRINTER_PORT || DEFAULT_PORT);
  await startMockPrinter({ port });
  console.log(`[Mock Printer] Simulator running on 127.0.0.1:${port}`);
  console.log('Ready for HTTP file uploads and WebSocket telemetry.');
}
