# PrinterFarm Orchestration Dashboard

**Free, local, no-root orchestration for the world's most common 3D printers — stock Creality, no cloud, no firmware mods.**

A highly concurrent, zero-dependency Node.js polling engine and hardware simulator for monitoring and orchestrating a farm of Creality 3D printers (Ender 3 V3 KE, K1, K1 Max, K2) on a local network.

## The Problem
Creality 3D printers (like the Ender 3 V3 KE and K-series) do not provide an open REST API. To monitor a farm of these printers on a shared network without flashing custom firmware (like Klipper), you typically have to manually navigate to each printer's individual IP address.

This project reverse-engineers the native Creality web UI protocol to provide a centralized, highly concurrent monitoring engine.

## Architecture

### 1. Protocol Reverse-Engineering
The engine communicates with the physical hardware via raw WebSockets on port `9999`. By sending a standard `{"method": "get"}` JSON payload, the printer returns fragmented JSON telemetry containing live data (device state, temperatures, current file, and progress).

### 2. The Polling Engine
To prevent network I/O blocking while respecting the weak network stacks of embedded hardware, the engine strictly serializes WebSocket probes. (Creality `9999` sockets do not reliably handle concurrent network connections). 

The results are parsed and stored in a global memory `Map` (rather than an array) by a non-blocking `setInterval` daemon. This ensures `O(1)` lookups and a completely flat memory footprint over long periods of uptime.

### 3. Firmware Bug Mitigation
Physical hardware telemetry is often inaccurate. Creality firmware occasionally exhibits a bug where a manually canceled print continues to broadcast its `deviceState` as `"print"` indefinitely. 

The engine routes all incoming telemetry through a strict `judge()` firewall function. If the JSON claims the printer is busy, but both the nozzle and bed temperatures read `0`, the firewall overrides the firmware state and marks the printer as `"free"`.

## Local Simulation & Testing

To allow development without physical hardware, this repository includes a pure Node.js hardware simulator.

### Running the Simulator
The mock server uses the native `node:http` and `node:crypto` modules to manually perform an RFC-6455 WebSocket handshake, intercepting connections and returning perfect fake JSON telemetry.

```bash
# Start the mock Creality printer (Listens on ws://127.0.0.1:9999)
node bin/mock-printer.mjs
```

### Running the CLI
In a separate terminal, you can point the polling engine at the mock server (or a real printer's IP):

```bash
# Connect to the local simulator
node bin/farm-status.mjs 127.0.0.1
```

### Unit Tests
The `judge()` firewall logic is fully isolated and mathematically verified for 100% branch coverage using the native `node:test` runner.

```bash
node --test
```

## Security Note
This software is highly experimental and can physically actuate hardware and start thermal events. 
By default, the dashboard securely binds to `localhost` (`127.0.0.1:3000`). If you wish to access the dashboard from other devices on your network, you can override the host by running `HOST=0.0.0.0 npm start`. **Only do this on a trusted local area network (LAN).** Never expose port 3000 directly to the internet.
