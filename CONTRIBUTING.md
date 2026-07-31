# Contributing

The most useful contribution right now is **a report from a printer that is not the Ender 3 V3 KE** — working or not. PrintFarm speaks an undocumented LAN protocol that was read out of the printer's own web interface, so every additional model is evidence.

## First: try it

PrintFarm matches on protocol, not model name. Discovery probes every address on the subnet and keeps whatever answers the Creality WebSocket on port 9999, so an unlisted printer may simply work. Run **Discover** and see.

If it works, open an issue saying so with your model and firmware version. That is enough to promote a row in the compatibility table.

## Capturing what your printer actually says

Which method you need depends on whether PrintFarm can talk to the printer at all.

**If Discover found your printer**, use the dashboard's raw view. Turn on the **Raw telemetry** switch in the sidebar, under the Discover button, and every printer card is replaced by the WebSocket frames that printer sent, exactly as they arrived and before this adapter interprets them. That matters: field names PrintFarm does not recognize yet still show up there, which is the whole point. Paste them into your issue. For the common case — a field under a different name — that alone is usually enough.

**If Discover found nothing**, the raw view has nothing to show you, because PrintFarm never connected in the first place. Go to the printer's own web interface instead: open `http://<printer-ip>` in Chrome and press F12. Leave the Network tab recording and start a print from that page.

Don't filter the Network tab. On the Ender 3 V3 KE the traffic you want is a WebSocket on port 9999, but that is exactly the assumption being tested — if your printer never opens one, *that is the finding*, and the port it uses instead is the single most useful thing you can report.

If the printer has no web interface at all, capturing Creality Print with Wireshark while it uploads and starts a print is the fallback.

Either way, include the model, the firmware version, and whatever you captured.

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

**A control command differs.** Adjust the payload in `lib/creality.mjs`. Keep the confirmation step: PrintFarm treats "the printer accepted the command" as a claim to be verified against subsequent telemetry, never as a fact. That rule is what keeps the farm safe to run unattended, and a contribution that drops it will not be merged.

**A fundamentally different transport** (the K2 family's port 4408, the CR-M4's CXSWBox) needs its own adapter module rather than edits to `creality.mjs`. Open an issue before starting; that is a design conversation, not a patch.

## Testing your change

No hardware is required to verify a change does not break existing behavior:

```bash
npm run verify
```

That runs the syntax checks, the unit suite, and an integration test that drives the simulator through upload, Auto-Print, pause, resume, and cancel.

If you taught PrintFarm a new field or state, add a case to `test/probe.test.mjs` or `test/farm.test.mjs` with the payload your printer actually sent. Real captured payloads make the best tests.

For changes that touch dispatch or the control commands, please also confirm on physical hardware and say so in the pull request — including what you could **not** verify. Undertested claims about hardware behavior are the one thing this project cannot absorb safely.

## Pull requests

- One concern per PR.
- Describe the printer and firmware version the change was observed on.
- State plainly what you tested and what you did not.
- Zero runtime dependencies is a deliberate constraint; PRs adding npm packages to the runtime path will be declined.

## Safety

PrintFarm drives heated, moving machinery over a network with no authentication. Assume every change can start a print on someone's unattended printer, and treat the bed-clearing lock and the start-confirmation checks as load-bearing.
