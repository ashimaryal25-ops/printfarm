import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const PORT = 9999;

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

    // Scenario A: Client sends the "Start Print" command
    if (msg.includes('"method":"set"')) {
      console.log(`[Mock Printer] Received start command... warming up heaters!`);
      fakeState.deviceState = "print";
      fakeState.targetNozzleTemp = 210;
      fakeState.targetBedTemp = 60;
      fakeState.printProgress = 0;
      
      // Extract the requested filename from the raw JSON string
      const match = msg.match(/printprt:.*\/([^/]+\.gcode)/);
      if (match) fakeState.printFileName = match[1];
      
      // Start a background timer to simulate heating and printing
      if (progressTimer) clearInterval(progressTimer);
      
      progressTimer = setInterval(() => {
        // 1. Simulate Heating (Simple Linear)
        let heated = true;
        
        // Bed Heating
        if (fakeState.targetBedTemp > 0) {
          if (fakeState.bedTemp < fakeState.targetBedTemp) {
            fakeState.bedTemp = Math.min(fakeState.targetBedTemp, fakeState.bedTemp + 5);
            heated = false;
          }
        } else if (fakeState.bedTemp > 25) {
          fakeState.bedTemp = Math.max(25, fakeState.bedTemp - 5);
        }
        
        // Nozzle Heating
        if (fakeState.targetNozzleTemp > 0) {
          if (fakeState.nozzleTemp < fakeState.targetNozzleTemp) {
            fakeState.nozzleTemp = Math.min(fakeState.targetNozzleTemp, fakeState.nozzleTemp + 15);
            heated = false;
          }
        } else if (fakeState.nozzleTemp > 25) {
          fakeState.nozzleTemp = Math.max(25, fakeState.nozzleTemp - 15);
        }

        // 2. Simulate Printing (only after heated)
        if (heated && fakeState.printProgress < 100) {
          fakeState.printProgress += 1;
        }
        
        // When finished, reset state
        if (fakeState.printProgress >= 100) {
          clearInterval(progressTimer);
          progressTimer = null;
          fakeState.deviceState = "free";
          fakeState.targetNozzleTemp = 0;
          fakeState.targetBedTemp = 0;
        }
      }, 1000);
      return;
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

server.listen(PORT, () => {
  console.log(`[Mock Printer] The Ultimate Simulator is running on 127.0.0.1:${PORT}`);
  console.log(`Ready for HTTP file uploads and WebSocket telemetry.`);
});
