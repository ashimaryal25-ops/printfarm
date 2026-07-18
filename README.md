# PrinterFarm

PrinterFarm is a local dashboard for discovering, monitoring, and routing G-code jobs across stock networked Creality printers.

It uses the printers' existing LAN interfaces. No root access, custom firmware, per-printer Raspberry Pi, Moonraker, or cloud account is required.

## Features

- Discover compatible printers on a private router or hotspot network.
- Monitor state, temperatures, active file, layer, and progress from one dashboard.
- Upload G-code to a global queue or a printer-specific queue.
- Route work with independent global and per-printer Auto-Print controls.
- Pause, resume, and cancel active jobs through the stock printer protocol.
- Keep completed, stopped, failed, and aborted printers locked until the bed is marked clear.
- Follow printers across DHCP address changes when identity and active filename can be matched safely.
- Develop without hardware using the included printer simulator.

## Quickstart

Requirements: Node.js 22 or newer and compatible printers on the same private network as the computer running PrinterFarm.

```bash
git clone https://github.com/ashimaryal25-ops/printfarm.git
cd printfarm
npm start
```

Open `http://127.0.0.1:3000` and select **Discover**. PrinterFarm has no runtime package dependencies, so `npm install` is not required.

### No printer? Try the simulator

The repository includes a full protocol simulator, so you can run the entire dashboard — uploads, Auto-Print, pause/resume/cancel, bed clearing — without owning a printer:

```bash
# terminal A: a fake Creality printer on localhost
node bin/mock-printer.mjs

# terminal B: point the farm at it and start
echo '[{ "id": "1", "ip": "127.0.0.1" }]' > printers.json
npm start
```

Upload any `.gcode` file to the global queue, add it to Printer 1, and press START — the simulator heats up, reports progress, and finishes like real hardware.

To access the dashboard from a phone on the same trusted network, bind it to the LAN:

```powershell
$env:HOST="0.0.0.0"
npm start
```

Then open `http://<computer-ip>:3000` on the phone. Windows Firewall may ask for permission; allow private networks only. Never expose PrinterFarm directly to the public internet.

## Network discovery

Discovery scans one RFC1918 private `/24` network at a time.

- **Auto** selects a detected private adapter and prefers the Windows hotspot subnet `192.168.137.0/24`.
- **Home/Router** accepts a private subnet or a printer/router IP such as `192.168.1` or `192.168.1.42`.
- **Hotspot** defaults to `192.168.137.0/24`.

Campus and company Wi-Fi commonly blocks client-to-client traffic. A laptop hotspot, phone hotspot, or travel router avoids that isolation. Successful discovery writes the active addresses to the local `printers.json`, which is intentionally ignored by Git.

For manual configuration, copy `printers.example.json` to `printers.json` and replace the addresses.

## Auto-Print safety

Global and printer-local Auto-Print are separate:

1. A printer with local Auto-Print enabled consumes jobs only from its local queue.
2. Global Auto-Print skips printers reserved for local Auto-Print.
3. Dispatch requires a confirmed `FREE` state with no upload, control command, or start already in flight.
4. A terminal or canceled job produces `NEEDS CLEARING`; another job cannot start until the operator clears the bed and confirms it in the dashboard.

Automatic part ejection is not included in v1.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Dashboard bind address |
| `PORT` | `3000` | Dashboard HTTP port |
| `HTTP_PORT` | `80` | Printer upload port |
| `GCODE_DIR` | `/usr/data/printer_data/gcodes` | Remote G-code directory |

Uploads are limited to 100 MB and stored in `scratch/`. Queues and job records are session-only.

## Testing

```bash
npm test
npm run test:integration
```

The unit suite covers protocol parsing, discovery bounds, state classification, queue routing, and control safety. The integration test starts the local simulator and verifies upload, Auto-Print, pause, resume, cancel, and teardown without physical hardware.

Run the simulator manually with:

```bash
node bin/mock-printer.mjs
```

## Compatibility

| Model | Status |
|---|---|
| Ender 3 V3 KE | Tested on physical hardware |
| K1, K1 Max, K2 Plus, CR-10 SE | Unverified; reports welcome |

Firmware updates may change the unofficial LAN protocol. Include the printer model, firmware version, and relevant server logs in bug reports.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the system design and [ROADMAP.md](ROADMAP.md) for deferred features.

## Security

The dashboard has no authentication. Anyone who can reach an exposed instance can upload files and control connected printers. Keep it on a trusted private network and retain physical supervision appropriate for heated, moving equipment.

## License

MIT. PrinterFarm is an unofficial community project and is not affiliated with or endorsed by Creality.
