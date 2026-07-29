# Roadmap

## Persistent job history

Add a collapsed history view after the live workflow is stable in broader use. A job must only be recorded as completed after terminal-success telemetry; confirming that a print started is not completion. The history should distinguish completed, canceled, aborted, and failed outcomes, cap retention, and offer **Add to Queue** only while the original local G-code still exists.

## Persistent queues

Restore queues and operator settings safely after a server restart without replaying a job whose physical start status is unknown.

## Compatibility profiles

Collect model and firmware reports, then move protocol paths and state aliases into explicit profiles instead of assuming every Creality LAN implementation matches the Ender 3 V3 KE.

## Authentication

Add an optional trusted-LAN authentication mode before recommending deployment on shared or institution-managed networks.
