# Roadmap

## Automatic part ejection

Add opt-in, printer-specific ejection profiles only after physical validation of cooling thresholds, toolhead clearance, motion limits, and failure recovery. Ejection must never be added blindly to arbitrary user G-code.

## Persistent job history

Add a collapsed history view after the live workflow is stable in broader use. It should normalize started, canceled, and failed records, cap retention, and offer **Add to Queue** only while the original local G-code still exists.

## Persistent queues

Restore queues and operator settings safely after a server restart without replaying a job whose physical start status is unknown.

## Compatibility profiles

Collect model and firmware reports, then move protocol paths and state aliases into explicit profiles instead of assuming every Creality LAN implementation matches the Ender 3 V3 KE.

## Authentication

Add an optional trusted-LAN authentication mode before recommending deployment on shared or institution-managed networks.
