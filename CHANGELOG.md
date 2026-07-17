# Changelog

## Unreleased

- Fixed split or coalesced mock WebSocket frames during concurrent polling and controls.
- Prevented incomplete telemetry windows from making a printer appear free or triggering a false bed-clearing transition.

## 1.0.0 - 2026-07-17

- Added bounded private-network discovery and persistent local printer addresses.
- Added serialized multi-printer telemetry with fragmented-message merging.
- Added global and printer-specific queues with independent Auto-Print controls.
- Added guarded upload, start confirmation, pause, resume, and cancel workflows.
- Added active-job tracking, DHCP address migration, and bed-clearing safety locks.
- Added a responsive dashboard for desktop and phone use.
- Added a local printer simulator, unit coverage, end-to-end lifecycle testing, and Windows/Linux CI.
