// Session-scoped workflow state. Persistence is intentionally deferred.
export const failedJobs = [];
export const localAutoPrint = new Map();
export const activeDispatches = new Map();
export const controlOperations = new Map();
export const controlWarnings = new Map();
export const dispatchingPrinters = new Set();
