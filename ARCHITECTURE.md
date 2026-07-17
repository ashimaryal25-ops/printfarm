# Architecture

PrinterFarm is a zero-runtime-dependency Node.js application with four boundaries.

## Dashboard

`public/` contains the vanilla HTML, CSS, and browser JavaScript. The browser polls `/api/status`, renders the current farm snapshot, and sends explicit commands to the backend. It never connects to printer control sockets directly.

## Server and dispatcher

`bin/server.mjs` serves the dashboard and owns API-level workflow state: uploads, global and local queues, active dispatches, command locks, and operator overrides. Its dispatcher only selects a printer when all safety gates agree that it is free.

Global and printer-local Auto-Print share one selection function. A printer reserved for local Auto-Print is excluded from the global pool, even when its local queue is empty.

## Printer protocol

`lib/creality.mjs` implements actions against the stock interfaces:

- G-code upload over HTTP.
- Start, pause, resume, and cancel commands over WebSocket port `9999`.
- Post-command confirmation from printer telemetry.

`lib/probe.mjs` collects fragmented telemetry before classification. `lib/printer-state.mjs` keeps raw firmware-state rules separate from derived farm states.

Printers are polled serially. Physical testing showed that concurrent port `9999` probes can make reachable printers appear offline.

## Discovery and identity

`lib/discovery.mjs` scans a bounded RFC1918 `/24` subnet with limited concurrency. Public ranges are rejected before scanning. Discovery updates the active farm only when at least one compatible printer responds.

An active dispatch may migrate to a new DHCP address only when the rediscovered printer and exact remote filename produce one unambiguous match. Otherwise the stale dispatch is removed instead of attaching controls to the wrong machine.

## Safety invariants

- Auto-Print is off after startup until the operator enables it.
- A printer cannot receive two simultaneous dispatches or control commands.
- A start is successful only after telemetry reports the exact uploaded filename.
- Pause and resume require the corresponding raw firmware state.
- Cancel and terminal firmware states require physical bed clearing.
- An unconfirmed command does not silently mark a printer free or retry a physical action.
- The dashboard binds to localhost by default and has no public-network authentication.

## Verification

Unit tests cover parsing, state derivation, queue selection, discovery bounds, dispatch locking, DHCP migration, and control failures. `test/integration.mjs` runs the real server against `bin/mock-printer.mjs` and verifies upload, Auto-Print, pause, resume, cancel, and deterministic teardown.
