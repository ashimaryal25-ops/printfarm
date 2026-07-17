# PrinterFarm Roadmap

## Post-v1: Job History

Add a collapsed, session-only Job History section after the core discovery, queue, Auto-Print, DHCP identity, and printer-control workflows are stable in real use.

The feature should:

- Keep Active Jobs as the only prominent live-job surface.
- Normalize started, canceled, and failed records into one newest-first history list.
- Show filename, printer, timestamp, outcome, and a short diagnostic message.
- Offer **Add to Queue** only when the retained local G-code file still exists.
- Add the file to the global queue without directly starting a printer; normal Auto-Print rules apply afterward.
- Remain collapsed by default, cap retained entries, prevent duplicate records, and avoid unbounded memory growth.

The v1 backend may retain internal dispatch records for recovery and debugging, but the successful-start history is intentionally not exposed in the dashboard.
