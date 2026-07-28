# Contributing

The most useful contribution right now is **a report from a printer that is not the Ender 3 V3 KE** — working or not. PrinterFarm speaks an undocumented LAN protocol that was read out of the printer's own web interface, so every additional model is evidence.

## First: try it

PrinterFarm matches on protocol, not model name. Discovery probes every address on the subnet and keeps whatever answers the Creality WebSocket on port 9999, so an unlisted printer may simply work. Run **Discover** and see.

If it works, open an issue saying so with your model and firmware version. That is enough to promote a row in the compatibility table.

## Capturing what your printer actually says

Two ways to see the raw protocol, in order of convenience:

1. **The dashboard's raw view.** Tick **Raw Debug** in the sidebar. Each card is replaced by the exact telemetry object PrinterFarm parsed from that printer. Copy it into your issue.
2. **The printer's own web UI.** Open `http://<printer-ip>` in Chrome, press F12, and watch the Network tab — filter to WS and click the `9999` connection to read the live message frames. This is how the protocol was worked out in the first place, and it is the authoritative source for a model we have never seen.

Include the model, the firmware version, and the raw frames. A single pasted telemetry payload is often enough to add support.

## Where the protocol assumptions live

Four files carry everything vendor-specific. Nothing else in the codebase knows what a Creality is.

| File | What it controls |
|---|---|
| `lib/creality.mjs` | Transport: upload endpoint, start/pause/resume/cancel payloads, the G-code directory, socket ports |
| `lib/probe.mjs` | Telemetry field names, and `judge()` which classifies a printer as free/busy/paused/needs-clearing |
| `lib/printer-state.mjs` | Firmware state codes (`0` stopped, `1` printing, `2` complete, `3` failed, `4` aborted, `5` paused) and their string equivalents |
| `bin/mock-printer.mjs` | The simulator that stands in for hardware in tests |

### Adapting without changing code

Two differences are already configurable:

```bash
GCODE_DIR=/some/other/path npm start   # where uploads land on the printer
HTTP_PORT=8080 npm start               # upload port, if not 80
```

If your printer only needed these, say so in an issue — it tells us which values deserve auto-detection.

### The common cases

**A telemetry field has a different name.** By far the most frequent difference, and a one-line fix. `lib/probe.mjs` accumulates fields defensively:

```js
if (msg.printProgress !== undefined) state.printProgress = msg.printProgress;
if (msg.dProgress    !== undefined) state.printProgress = msg.dProgress;
```

Add your variant beside the existing ones. Do not remove the old name; several firmware versions are in the wild simultaneously.

**A state code differs.** Add it to the predicate in `lib/printer-state.mjs` rather than sprinkling comparisons through the codebase.

**A control command differs.** Adjust the payload in `lib/creality.mjs`. Keep the confirmation step: PrinterFarm treats "the printer accepted the command" as a claim to be verified against subsequent telemetry, never as a fact. That rule is what keeps the farm safe to run unattended, and a contribution that drops it will not be merged.

**A fundamentally different transport** (the K2 family's port 4408, the CR-M4's CXSWBox) needs its own adapter module rather than edits to `creality.mjs`. Open an issue before starting; that is a design conversation, not a patch.

## Testing your change

No hardware is required to verify a change does not break existing behavior:

```bash
npm run verify
```

That runs the syntax checks, the unit suite, and an integration test that drives the simulator through upload, Auto-Print, pause, resume, and cancel.

If you taught PrinterFarm a new field or state, add a case to `test/probe.test.mjs` or `test/farm.test.mjs` with the payload your printer actually sent. Real captured payloads make the best tests.

For changes that touch dispatch or the control commands, please also confirm on physical hardware and say so in the pull request — including what you could **not** verify. Undertested claims about hardware behavior are the one thing this project cannot absorb safely.

## Pull requests

- One concern per PR.
- Describe the printer and firmware version the change was observed on.
- State plainly what you tested and what you did not.
- Zero runtime dependencies is a deliberate constraint; PRs adding npm packages to the runtime path will be declined.

## Safety

PrinterFarm drives heated, moving machinery over a network with no authentication. Assume every change can start a print on someone's unattended printer, and treat the bed-clearing lock and the start-confirmation checks as load-bearing.
