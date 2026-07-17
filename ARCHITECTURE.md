# PrinterFarm Architecture Overview

You've built a full-stack, air-gapped, zero-dependency Node.js web application that acts as an orchestration middleware between a user and physical 3D printer hardware. 

Here is exactly what you are dealing with, broken down by layer.

---

## 1. Frontend Layer (The Dashboard)
This is the client-side code running in the browser. It is 100% vanilla (No React, Vue, or Tailwind) making it incredibly fast and completely offline-capable.

* **`public/index.html`**: The structural skeleton of the dashboard. Contains the layout for the global queue, the network discovery panel, and a `<template>` tag used to stamp out individual printer cards dynamically.
* **`public/theme.css` & `public/style.css`**: The styling system. `theme.css` defines the color palette, sizing tokens, and local system fonts. `style.css` handles the layout, grid system, and animations.
* **`public/app.js`**: The brain of the frontend. It operates on a **polling loop**, fetching `/api/status` from the backend every 2 seconds. When it gets new data, it wipes and redraws the printer cards so the UI is always perfectly in sync with the backend. It also intercepts button clicks (like uploading a file or clicking "Discover") and sends them as API requests to the server.

---

## 2. Backend API & Routing Layer (The Server)
This is the Node.js process that boots up when you run `npm start`. It acts as the bridge between your browser and the farm.

* **`bin/server.mjs`**: The heart of the application (approx 500 lines). Since we didn't use Express.js, this file manually routes all HTTP traffic. 
  * **Static File Server:** Serves your HTML, CSS, and JS to the browser.
  * **Upload Handler:** Accepts massive `.gcode` file uploads (up to 100MB) via data streams and saves them directly to your hard drive in the `scratch/` folder.
  * **API Endpoints:** Handles routes like `/api/status` (giving data to the UI), `/api/start-job`, and `/api/discover`.
  * **The Dispatcher Loop:** A continuous background timer (`setInterval`) that watches for printers whose state is "FREE". When it finds one, it plucks a job from the Global Queue and hands it to the Hardware Communication layer to start printing.

---

## 3. State Management Layer (The Memory Store)
Because multiple parts of the server need to know what's happening simultaneously, state is managed in a central file.

* **`lib/farm.mjs`**: Think of this as the server's RAM. It holds:
  * `activePrinters`: The list of known IPs (loaded from `printers.json`).
  * `farmState`: A live map containing the exact nozzle/bed temps and status of every printer.
  * `jobQueue`: The global array of `.gcode` jobs waiting for *any* free printer.
  * `printerQueues`: Specific queues for jobs assigned to a *specific* printer.
  * `failedJobs` / `completedJobs`: Arrays tracking historical data.
  * **The Polling Engine (`startFarmPolling`)**: A continuous loop that iterates through every known IP address and calls the Probe layer to ask the printer how it's doing.

---

## 4. Hardware Communication Layer (The Driver)
This layer contains the highly specialized code that actually talks to the Creality stock firmware.

* **`lib/creality.mjs` (Action Commands)**: Handles telling the printer what to do.
  * `uploadGcode()`: Uses native `fetch` to send an HTTP POST request containing your `.gcode` file to port `80` on the printer.
  * `startPrint()`: Opens a raw WebSocket on port `9999` and sends the highly specific JSON command `{"method": "set", "params": {"opGcodeFile": "..."}}` to force the firmware to begin printing.
* **`lib/probe.mjs` (Telemetry & Telemetry Firewall)**: Handles asking the printer how it's doing.
  * Opens a WebSocket on port `9999` and requests `"reqPrintObjects"`.
  * **The `judge()` Firewall:** Because Creality firmware is notoriously buggy (e.g. reporting it is "printing" forever even if you cancel a print), `judge()` intercepts the raw telemetry and mathematically determines what the printer is *actually* doing based on temperatures and file progress, sanitizing the data before passing it to the State Management layer.

---

## 5. Network Discovery Layer
* **`lib/discovery.mjs`**: Calculates your computer's local subnet (e.g., `192.168.137.x`). It then concurrently (but safely) attempts to connect to port 9999 on all 254 possible IP addresses in a matter of seconds. If a device responds with valid Creality telemetry, it captures the IP, adds it to the farm, and writes it to `printers.json`.

---

## 6. Simulation & Testing Layer
* **`bin/mock-printer.mjs`**: A pure Node.js simulator. It opens a local WebSocket server on `127.0.0.1:9999` and spits out fake temperature and progress data. This allows you to write code and test the UI from your laptop at a coffee shop without needing 4 physical 3D printers sitting in front of you.

---

### Data Flow Summary (How a print happens)
1. You drag a `.gcode` file into the UI. `app.js` POSTs it to `/api/upload`.
2. `server.mjs` receives the file, saves it to `scratch/`, and adds it to `jobQueue` in `farm.mjs`.
3. The Polling Engine in `farm.mjs` is constantly using `probe.mjs` to fetch temperatures. It sees Printer 2 is `FREE`.
4. The Dispatcher Loop in `server.mjs` notices Printer 2 is `FREE` and grabs your `.gcode` from `jobQueue`.
5. The Dispatcher calls `creality.mjs` to upload the file to Printer 2's port 80 and send the start command over port 9999.
6. The next time `app.js` fetches `/api/status`, the printer is now `BUSY`, and the UI turns the badge blue!
