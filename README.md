# PrinterFarm

PrinterFarm is a local, no-root dashboard for discovering, monitoring, and routing G-code jobs across stock networked Creality printers.

It talks directly to the printers over their existing LAN interfaces. No Raspberry Pi per printer, custom firmware, Moonraker, or cloud account is required.

## What it does

- Discovers compatible printers on a private home, router, or hotspot network.
- Shows printer state, temperatures, active file, and progress in one dashboard.
- Safe physical control: Pause, Resume, and Cancel jobs directly from the dashboard.
- Routes a global G-code queue to available printers with global **Auto-Print**.
- Supports printer-specific queues with independent **Auto-Print** toggles.
- Reserves local Auto-Print printers from the global queue.
- Uploads G-code over HTTP and starts prints through the stock port `9999` WebSocket protocol.
- Confirms a start only when the printer reports the exact filename in the printing state.
- Keeps complete, stopped, failed, and aborted jobs out of the free pool until the bed is marked clear.
- Retains internal session records for dispatch recovery and debugging.

## Quickstart

Requirements: Node.js 22 or newer and compatible printers on the same private network as this computer.

```bash
git clone https://github.com/ashimaryal25-ops/printerfarm.git
cd printerfarm
npm start
```

Open `http://127.0.0.1:3000`, then click **DISCOVER**.

PrinterFarm has no runtime package dependencies, so `npm install` is not required.

## Auto-Print behavior

Global and printer-local Auto-Print are intentionally separate:

1. A printer with local Auto-Print enabled only consumes jobs from its own queue.
2. Global Auto-Print skips every printer with local Auto-Print enabled, even if that local queue is empty.
3. A printer is eligible only when its confirmed state is `FREE` and no upload or start is already in flight.
4. After a terminal job, the printer remains `NEEDS CLEARING` until the bed is physically cleared and **Mark Bed Cleared** is clicked.

There is no automatic ejection in the current release.

## Network discovery

Discovery is restricted to RFC1918 private `/24` networks to avoid scanning public or campus address ranges.

- **Auto:** Uses a detected private adapter, preferring the Windows hotspot subnet `192.168.137.0/24`.
- **Home/Router:** Accepts a private subnet or a printer/router IP, such as `192.168.1` or `192.168.1.42`.
- **Hotspot:** Defaults to the Windows hotspot subnet `192.168.137.0/24`.

Campus and company Wi-Fi often blocks client-to-client traffic. Use a laptop hotspot, phone hotspot, or travel router when printers cannot be reached from the dashboard.

Successful discovery updates `printers.json`. You can also create it manually:

```json
[
  { "id": "1", "ip": "192.168.137.30" },
  { "id": "2", "ip": "192.168.137.191" }
]
```

## How it works

The stock printer web UI exposes the interfaces PrinterFarm uses:

- HTTP upload: `POST http://<printer-ip>/upload/<filename>`
- Telemetry and start commands: `ws://<printer-ip>:9999/`

Printer polling is serialized because these printers accept very few simultaneous port `9999` connections. Telemetry arrives in fragments, so each probe uses a short collection window before classifying the printer.

The numeric firmware states used by the tested printer UI are:

| Value | Meaning | Farm behavior |
|---|---|---|
| `0` | Stopped | Needs clearing when a file is present |
| `1` | Printing | Busy |
| `2` | Complete | Needs clearing |
| `3` | Failed | Needs clearing |
| `4` | Aborted | Needs clearing when a file is present |
| `5` | Paused | Busy/paused |

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Dashboard HTTP port |
| `HOST` | `127.0.0.1` | Dashboard bind address |
| `GCODE_DIR` | `/usr/data/printer_data/gcodes` | Remote printer G-code directory |
| `HTTP_PORT` | `80` | Printer upload port override |

Set `HOST=0.0.0.0` only on a trusted LAN. PrinterFarm currently has no authentication.

Uploads are limited to 100 MB per file and stored in the local `scratch/` directory. Queue state is session-only.

Planned post-v1 features are tracked in [`ROADMAP.md`](ROADMAP.md).

## Testing

```bash
npm test
```

The repository also includes a local protocol simulator:

```bash
node bin/mock-printer.mjs
```

## Compatibility

| Model | Status |
|---|---|
| Ender 3 V3 KE | Tested on physical hardware |
| K1, K1 Max, K2 Plus, CR-10 SE | Unverified; reports welcome |

Firmware updates can change the unofficial LAN protocol. Include the printer model, firmware version, and relevant server log lines in bug reports.

## Security

The server binds to localhost by default. Anyone who can reach an exposed PrinterFarm instance can upload files and control connected printers, so do not expose it to the public internet.

## License

MIT. PrinterFarm is an unofficial community project and is not affiliated with or endorsed by Creality.
