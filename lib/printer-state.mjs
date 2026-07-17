// Extracted from the stock Creality web UI:
// 0 stopped, 1 printing, 2 complete, 3 failed, 4 aborted, 5 paused.
const NUMERIC_TERMINAL_STATES = new Set([0, 2, 3, 4]);

export function isPrinterPausedState(deviceState, payload = {}) {
  const normalized = String(deviceState ?? '').toLowerCase();
  const printState = payload.printState ?? payload.state;
  return Number(printState) === 5
    || Number(deviceState) === 5
    || normalized === 'pause'
    || normalized === 'paused'
    || Number(payload.pause) === 1
    || Number(payload.paused) === 1;
}

export function isPrinterPrintingState(deviceState, payload = {}) {
  const normalized = String(deviceState ?? '').toLowerCase();
  const printState = payload.printState ?? payload.state;
  return Number(printState) === 1
    || (Number(deviceState) === 1 && Number(printState) !== 5)
    || normalized === 'print'
    || normalized === 'printing';
}

export function isPrinterActiveState(deviceState, payload = {}) {
  return isPrinterPrintingState(deviceState, payload) || isPrinterPausedState(deviceState, payload);
}

export function isPrinterTerminalState(deviceState, payload = {}) {
  const printState = payload.printState ?? payload.state ?? deviceState;
  const normalized = String(printState ?? '').toLowerCase();
  if (Number(deviceState) === 1) return false;
  return NUMERIC_TERMINAL_STATES.has(Number(printState))
    || ['stopped', 'complete', 'completed', 'failed', 'abort', 'aborted'].includes(normalized);
}
