import path from 'node:path';

function sameFilename(left, right) {
  const leftName = path.basename(String(left || '')).toLowerCase();
  const rightName = path.basename(String(right || '')).toLowerCase();
  return Boolean(leftName && rightName && leftName === rightName);
}

export function dispatchMatchesState(dispatch, state) {
  return [dispatch.remoteFilename, dispatch.filePath, dispatch.filename]
    .some(filename => sameFilename(state?.printFileName, filename));
}

function moveMapKey(map, oldIp, newIp) {
  if (!map.has(oldIp)) return;
  const value = map.get(oldIp);
  map.delete(oldIp);
  map.set(newIp, value);
}

export function reconcilePrinterAddresses(discoveredPrinters, stores) {
  const {
    activeDispatches,
    controlOperations,
    controlWarnings,
    localAutoPrint,
    manualOverrides,
    printerQueues
  } = stores;
  const discoveredIps = new Set(discoveredPrinters.map(printer => printer.ip));

  for (const [oldIp, dispatch] of [...activeDispatches]) {
    if (discoveredIps.has(oldIp)) continue;

    const matches = discoveredPrinters.filter(printer =>
      (printer.farmState === 'busy' || printer.farmState === 'paused')
      && dispatchMatchesState(dispatch, printer)
    );

    activeDispatches.delete(oldIp);
    if (matches.length !== 1) {
      controlOperations.delete(oldIp);
      controlWarnings.delete(oldIp);
      continue;
    }

    const replacement = matches[0];
    Object.assign(dispatch, {
      printerIp: replacement.ip,
      printerId: replacement.id,
      hostname: replacement.hostname,
      remoteFilename: replacement.printFileName,
      phase: replacement.farmState === 'paused' ? 'paused' : 'printing',
      progress: replacement.printProgress || 0,
      layer: replacement.layer || 0,
      totalLayer: replacement.totalLayer || 0,
      seenBusy: true
    });
    activeDispatches.set(replacement.ip, dispatch);

    moveMapKey(printerQueues, oldIp, replacement.ip);
    moveMapKey(localAutoPrint, oldIp, replacement.ip);
    moveMapKey(manualOverrides, oldIp, replacement.ip);
    moveMapKey(controlWarnings, oldIp, replacement.ip);
  }
}

export function assignStablePrinterIds(foundPrinters, priorPrinters) {
  const priorByHostname = new Map(
    priorPrinters.filter(printer => printer.hostname).map(printer => [printer.hostname, printer.id])
  );
  const usedIds = new Set();

  return foundPrinters.map(printer => {
    let id = priorByHostname.get(printer.hostname);
    if (!id || usedIds.has(id)) {
      let candidate = 1;
      while (usedIds.has(String(candidate))) candidate += 1;
      id = String(candidate);
    }
    usedIds.add(id);
    return { ...printer, id };
  });
}
