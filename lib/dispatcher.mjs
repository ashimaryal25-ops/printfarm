const UNCONFIRMED_START = 'unconfirmed_start';

function removeJob(queue, jobId) {
  const index = queue.findIndex(candidate => candidate.id === jobId);
  if (index !== -1) queue.splice(index, 1);
}

function failedJob(job, details) {
  const record = { ...job, ...details, failedAt: Date.now() };
  delete record.status;
  return record;
}

/**
 * Creates the shared job dispatch lifecycle used by manual and automatic starts.
 * Dependencies are explicit so the lifecycle can be tested without printer hardware.
 */
export function createJobDispatcher({
  uploadGcode,
  startPrint,
  confirmPrinting,
  activeDispatches,
  failedJobs,
  dispatchingPrinters,
  maxAttempts = 3,
  logger = console
}) {
  function setPhase(ip, phase) {
    const dispatch = activeDispatches.get(ip);
    if (dispatch) dispatch.phase = phase;
  }

  async function dispatch({ state, job, queue, source }) {
    const ip = state.ip;
    dispatchingPrinters.add(ip);
    job.status = 'sending';
    activeDispatches.set(ip, {
      jobId: job.id,
      filename: job.filename,
      filePath: job.filePath,
      attempts: job.attempts,
      printerIp: ip,
      printerId: state.id,
      phase: 'uploading',
      source,
      startedAt: Date.now(),
      seenBusy: false
    });

    logger.log(`[Dispatcher] Starting ${job.filename} on printer ${ip}...`);

    try {
      const remoteFilename = await uploadGcode(ip, job.filePath);
      const active = activeDispatches.get(ip);
      if (active) active.remoteFilename = remoteFilename;

      setPhase(ip, 'starting');
      await startPrint(ip, remoteFilename);
      setPhase(ip, 'confirming');

      const confirmed = await confirmPrinting(ip, remoteFilename);
      removeJob(queue, job.id);

      if (!confirmed) {
        activeDispatches.delete(ip);
        failedJobs.push(failedJob(job, {
          failureReason: UNCONFIRMED_START,
          failureMessage: 'Start command was sent but firmware did not confirm the active file. Check printer before requeueing.',
          lastPrinterIp: ip
        }));
        logger.error(`[Dispatcher] Start was not confirmed on ${ip}; moved ${job.filename} to failed jobs.`);
        return { status: 'failed', reason: UNCONFIRMED_START };
      }

      setPhase(ip, 'preparing');
      logger.log(`[Dispatcher] Successfully started ${remoteFilename} on ${ip}`);
      return { status: 'started', remoteFilename };
    } catch (error) {
      activeDispatches.delete(ip);
      job.attempts = (job.attempts || 0) + 1;
      logger.error(`[Dispatcher] Failed to start ${job.filename} on ${ip}:`, error.message);

      if (job.attempts >= maxAttempts) {
        removeJob(queue, job.id);
        failedJobs.push(failedJob(job, {
          failureMessage: error.message,
          lastPrinterIp: ip
        }));
        return { status: 'failed', reason: 'attempt_limit', error };
      }

      delete job.status;
      return { status: 'retryable', error };
    } finally {
      dispatchingPrinters.delete(ip);
    }
  }

  return { dispatch };
}
