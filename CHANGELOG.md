# Changelog

## Unreleased

## 1.1.1 - 2026-07-30

### Fixed

- The raw telemetry view now shows the messages a printer actually sent. It previously showed the parsed result, which keeps only the fields this adapter already recognizes — so a printer using different field names appeared to send nothing useful, which is the one case the view exists for.
- The raw telemetry view keeps updating for a printer whose telemetry cannot be read. Its safety state is deliberately frozen, and the raw messages were being frozen along with it, so starting a print on the printer itself never showed anything new. Watching those messages change is how support for a new model gets written.
- The help markers next to Raw telemetry and Auto-Print open on click, so they work on a phone, and no longer rely on a browser tooltip that never appeared there. They also stay on screen near a window edge.
- Release archives no longer carry the demo recordings, which made the download 11 MB for a 289 KB program.

### Changed

- The first-run panel and the dashboard header no longer explain themselves in field names and shell commands.
- The syntax check covers every source file. `printer-state.mjs` and `server-helpers.mjs` were both missing, and contributors are pointed at the first of those.
- CI runs on Node 24 as well as 22. Node 24 is the current LTS, so it is what the install instructions actually get people.
- The package name matches the repository.

## 1.1.0 - 2026-07-28

### Added

- Per-printer upload now accepts multiple files. Previously only the global queue did; the per-printer handler read the first file and silently dropped the rest.
- Raw telemetry view. The card markup, styles, and render logic already existed, but the sidebar switch that reaches them was missing.
- `CONTRIBUTING.md`, documenting the four files that carry protocol assumptions so owners of unlisted printers can adapt it themselves.
- Demo and discovery recordings in the README.

### Fixed

- Dashboard now binds every loopback address. Windows resolves `localhost` to `::1` before `127.0.0.1`, so an IPv4-only bind made the dashboard load only intermittently. A port already in use now reports a readable message instead of a stack trace.
- Discovery panel no longer opens showing controls that do not apply. The subnet box and hotspot shortcut were hidden only by a mode-change event that never fires on load. The hotspot shortcut also hides after a successful scan, and the searched subnet is escaped before rendering.
- Compatibility table now separates verified, experimental, and unsupported models. K2 and K2 Plus were listed as supported but use a different transfer interface and cannot work through this adapter.
- Print progress no longer reports stale values when a printer leaves its reported percentage at zero.
- Split or coalesced WebSocket frames during concurrent polling and controls.
- Incomplete telemetry windows no longer make a printer appear free or trigger a false bed-clearing transition.

### Changed

- Manual and automatic job dispatch now share one tested lifecycle.
- Workflow state, printer identity, HTTP helpers, and dashboard rendering split into focused modules.
- Removed the unused started-as-completed job collection; accurate print history remains planned.

## 1.0.0 - 2026-07-17

- Added bounded private-network discovery and persistent local printer addresses.
- Added serialized multi-printer telemetry with fragmented-message merging.
- Added global and printer-specific queues with independent Auto-Print controls.
- Added guarded upload, start confirmation, pause, resume, and cancel workflows.
- Added active-job tracking, DHCP address migration, and bed-clearing safety locks.
- Added a responsive dashboard for desktop and phone use.
- Added a local printer simulator, unit coverage, end-to-end lifecycle testing, and Windows/Linux CI.
