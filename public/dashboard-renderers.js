const PHASE_LABELS = {
  uploading: 'Uploading',
  starting: 'Starting',
  confirming: 'Confirming start',
  preparing: 'Preparing',
  printing: 'Printing',
  paused: 'Paused',
  pausing: 'Pausing...',
  resuming: 'Resuming...',
  canceling: 'Canceling...'
};

export function renderActiveJobs(activeJobs = [], controlWarnings = {}, onControl) {
  const list = document.getElementById('activeJobsList');
  const count = document.getElementById('activeJobsCount');
  if (!list || !count) return;

  list.replaceChildren();
  count.textContent = `${activeJobs.length} active`;

  if (activeJobs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'active-job-empty';
    empty.textContent = 'No jobs are currently active.';
    list.appendChild(empty);
    return;
  }

  for (const job of activeJobs) {
    const row = document.createElement('div');
    row.className = 'active-job-row';

    const info = document.createElement('div');
    info.className = 'active-job-info';

    const printer = document.createElement('div');
    printer.className = 'active-job-printer';
    const printerName = document.createElement('strong');
    printerName.textContent = job.printerId ? `Printer ${job.printerId}` : 'Printer';
    const printerIp = document.createElement('span');
    printerIp.textContent = job.printerIp || '';
    printer.append(printerName, printerIp);

    const filename = document.createElement('div');
    filename.className = 'active-job-filename';
    filename.textContent = job.filename || 'Unknown file';
    filename.title = filename.textContent;

    const state = document.createElement('div');
    state.className = `active-job-state ${job.phase || 'printing'}`;
    const phase = PHASE_LABELS[job.phase] || 'Printing';
    const progress = Number.isFinite(Number(job.progress))
      ? Math.max(0, Math.min(100, Number(job.progress)))
      : null;
    if (progress !== null && (job.phase === 'printing' || job.phase === 'paused')) {
      const layer = Number(job.layer) || 0;
      const totalLayer = Number(job.totalLayer) || 0;
      const layerText = totalLayer > 0 ? ` · Layer ${layer}/${totalLayer}` : '';
      state.textContent = `${phase} ${progress}%${layerText}`;
    } else {
      state.textContent = phase;
    }

    info.append(printer, filename, state);
    row.appendChild(info);

    const controls = document.createElement('div');
    controls.className = 'active-job-controls';
    const isTransitioning = ['pausing', 'resuming', 'canceling', 'uploading', 'starting', 'confirming'].includes(job.phase);
    const showControls = !['uploading', 'starting', 'confirming'].includes(job.phase);

    if (showControls) {
      if (job.phase === 'paused' || job.phase === 'resuming') {
        controls.appendChild(controlButton('Resume', 'resume-btn', isTransitioning, button => onControl(job.printerIp, 'resume', button)));
      } else if (job.phase !== 'preparing') {
        controls.appendChild(controlButton('Pause', 'pause-btn', isTransitioning, button => onControl(job.printerIp, 'pause', button)));
      }
      controls.appendChild(controlButton('Cancel Print', 'cancel-btn', isTransitioning, button => onControl(job.printerIp, 'cancel', button)));
    }
    row.appendChild(controls);

    const warning = controlWarnings[job.printerIp];
    if (warning) {
      const warningElement = document.createElement('div');
      warningElement.className = 'active-job-error visible';
      warningElement.textContent = warning;
      row.appendChild(warningElement);
    }

    list.appendChild(row);
  }
}

function controlButton(label, className, disabled, onClick) {
  const button = document.createElement('button');
  button.className = `control-btn ${className}`;
  button.textContent = label;
  button.disabled = disabled;
  if (!disabled) button.addEventListener('click', () => onClick(button));
  return button;
}

export function renderGlobalQueue(jobs = []) {
  const count = document.getElementById('queueCount');
  const list = document.getElementById('queueList');
  if (!count || !list) return;

  count.textContent = jobs.length;
  list.replaceChildren();
  if (jobs.length === 0) {
    const item = document.createElement('li');
    item.className = 'empty-list-item';
    item.textContent = 'No queued jobs';
    list.appendChild(item);
    return;
  }

  jobs.forEach((job, index) => {
    const item = document.createElement('li');
    item.textContent = `${index + 1}. ${job.filename}${job.status === 'sending' ? ' - sending' : ''}`;
    item.title = job.filename;
    list.appendChild(item);
  });
}

export function renderFailedJobs(jobs = [], onRequeue) {
  const container = document.getElementById('failedJobsContainer');
  const count = document.getElementById('failedCount');
  const list = document.getElementById('failedList');
  if (!container || !count || !list) return;

  container.hidden = jobs.length === 0;
  if (jobs.length === 0) return;

  count.textContent = jobs.length;
  list.replaceChildren();
  jobs.forEach((job, index) => {
    const item = document.createElement('li');
    const text = document.createElement('div');
    text.className = 'failed-job-details';

    const attempts = Number(job.attempts);
    const failureLabel = job.failureReason === 'unconfirmed_start'
      ? 'Start unconfirmed'
      : (Number.isFinite(attempts) && attempts > 0 ? `Failed ${attempts}x` : 'Failed');
    const name = document.createElement('span');
    name.textContent = `${index + 1}. ${job.filename} (${failureLabel})`;
    name.title = job.failureMessage || job.filename;
    text.appendChild(name);

    if (job.failureMessage) {
      const message = document.createElement('span');
      message.className = 'failed-job-message';
      message.textContent = job.failureMessage;
      text.appendChild(message);
    }

    const controls = document.createElement('div');
    if (job.status === 'sending') {
      const sending = document.createElement('span');
      sending.className = 'sending-label';
      sending.textContent = 'SENDING...';
      controls.appendChild(sending);
    } else if (job.filePath) {
      const button = document.createElement('button');
      button.className = 'requeue-btn';
      button.textContent = 'REQUEUE';
      button.title = 'Send back to active queue';
      button.addEventListener('click', () => onRequeue(job.id, button));
      controls.appendChild(button);
    }

    item.append(text, controls);
    list.appendChild(item);
  });
}

export function renderFarmSummary(summary) {
  for (const [name, value] of Object.entries(summary)) {
    const element = document.getElementById(`sum-${name}`);
    if (element) element.textContent = value;
  }
}
