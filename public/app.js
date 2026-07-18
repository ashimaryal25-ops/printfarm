const grid = document.getElementById('printer-grid');
const template = document.getElementById('printer-card-template');
const autoAssignCheck = document.getElementById('autoAssignCheck');
const rawDebugCheck = document.getElementById('rawDebugCheck');
const globalFileInput = document.getElementById('globalFileInput');

function setDiscoveryMessage(type, title, body, { html = false } = {}) {
  const scanStatus = document.getElementById('scanStatus');
  const colorMap = {
    success: 'var(--color-status-free)',
    warning: 'var(--color-secondary)',
    error: 'var(--color-status-error)'
  };
  scanStatus.style.color = colorMap[type] || 'var(--color-secondary)';
  if (html) {
    if (title) {
      scanStatus.innerHTML = `<strong>${title}</strong><br>${body}`;
    } else {
      scanStatus.innerHTML = body;
    }
  } else {
    scanStatus.innerHTML = '';
    if (title) {
      const strong = document.createElement('strong');
      strong.textContent = title;
      scanStatus.appendChild(strong);
      scanStatus.appendChild(document.createElement('br'));
    }
    scanStatus.appendChild(document.createTextNode(body));
  }
}

function showCardMessage(card, type, message) {
  let msgBox = card.querySelector('.card-message');
  if (!msgBox) {
    msgBox = document.createElement('div');
    msgBox.className = 'card-message';
    msgBox.style.fontSize = '10px';
    msgBox.style.padding = '4px 8px';
    msgBox.style.marginTop = '8px';
    msgBox.style.borderRadius = '4px';
    const actionsSection = card.querySelector('.printer-actions-section');
    if (actionsSection) actionsSection.appendChild(msgBox);
  }
  msgBox.textContent = message;
  msgBox.style.backgroundColor = type === 'error' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(34, 197, 94, 0.1)';
  msgBox.style.color = type === 'error' ? 'var(--color-status-error)' : 'var(--color-status-free)';
  msgBox.style.display = 'block';
  setTimeout(() => { if (msgBox) msgBox.style.display = 'none'; }, 4000);
}

async function executeControl(ip, action, btn) {
  if (action === 'cancel' && !confirm('Cancel this print? The printer will remain unavailable until the partial print is removed and the bed is marked cleared.')) {
    return;
  }
  
  const originalText = btn.textContent;
  btn.disabled = true;
  
  // Disable sibling buttons in the same row
  const row = btn.closest('.active-job-row');
  if (row) {
    row.querySelectorAll('button').forEach(b => b.disabled = true);
  }
  
  try {
    const res = await fetch(`/api/printers/${action}?ip=${encodeURIComponent(ip)}`, { method: 'POST' });
    if (!res.ok) {
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const errData = await res.json();
        throw new Error(errData.error || errData.status || 'Unknown error');
      } else {
        throw new Error(await res.text());
      }
    }
    fetchStatus(); // immediate refresh to reflect the control operation result
  } catch (err) {
    let errDiv = row.querySelector('.active-job-error');
    if (!errDiv) {
      errDiv = document.createElement('div');
      errDiv.className = 'active-job-error';
      row.appendChild(errDiv);
    }
    errDiv.textContent = `Error: ${err.message}`;
    errDiv.style.display = 'block';
    
    // Restore buttons
    if (row) {
      row.querySelectorAll('button').forEach(b => b.disabled = false);
    }
    btn.textContent = originalText;
  }
}

function renderActiveJobs(activeJobs = [], controlWarnings = {}) {
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

  const phaseLabels = {
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

  activeJobs.forEach(job => {
    const row = document.createElement('div');
    row.className = 'active-job-row';

    const infoDiv = document.createElement('div');
    infoDiv.className = 'active-job-info';

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
    const phase = phaseLabels[job.phase] || 'Printing';
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

    infoDiv.append(printer, filename, state);
    row.appendChild(infoDiv);
    
    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'active-job-controls';
    
    const isTransitioning = ['pausing', 'resuming', 'canceling', 'uploading', 'starting', 'confirming'].includes(job.phase);
    const showControls = !['uploading', 'starting', 'confirming'].includes(job.phase);
    
    if (showControls) {
      if (job.phase === 'paused' || job.phase === 'resuming') {
        const resumeBtn = document.createElement('button');
        resumeBtn.className = 'control-btn resume-btn';
        resumeBtn.textContent = 'Resume';
        resumeBtn.disabled = isTransitioning;
        if (!isTransitioning) resumeBtn.addEventListener('click', () => executeControl(job.printerIp, 'resume', resumeBtn));
        controlsDiv.appendChild(resumeBtn);
      } else if (job.phase !== 'preparing') {
        const pauseBtn = document.createElement('button');
        pauseBtn.className = 'control-btn pause-btn';
        pauseBtn.textContent = 'Pause';
        pauseBtn.disabled = isTransitioning;
        if (!isTransitioning) pauseBtn.addEventListener('click', () => executeControl(job.printerIp, 'pause', pauseBtn));
        controlsDiv.appendChild(pauseBtn);
      }
      
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'control-btn cancel-btn';
      cancelBtn.textContent = 'Cancel Print';
      cancelBtn.disabled = isTransitioning;
      if (!isTransitioning) cancelBtn.addEventListener('click', () => executeControl(job.printerIp, 'cancel', cancelBtn));
      controlsDiv.appendChild(cancelBtn);
    }
    
    row.appendChild(controlsDiv);
    
    // Check for warnings
    const warning = controlWarnings[job.printerIp];
    if (warning) {
      let warnDiv = document.createElement('div');
      warnDiv.className = 'active-job-error';
      warnDiv.textContent = warning;
      warnDiv.style.display = 'block';
      row.appendChild(warnDiv);
    }
    
    list.appendChild(row);
  });
}


let lastState = null;
let currentSettings = { autoAssign: false };

// Store card elements to update them efficiently
const printerCards = {};

async function requeueJob(jobId, btn, text) {
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  try {
    const res = await fetch(`/api/jobs/requeue?jobId=${encodeURIComponent(jobId)}`, { method: 'POST' });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    fetchStatus();
  } catch (err) {
    alert(`Requeue error: ${err.message}`);
    if (btn) { btn.disabled = false; btn.textContent = text; }
  }
}

async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    lastState = data;
    currentSettings = data.settings || currentSettings;
    renderActiveJobs(data.activeJobs || [], data.controlWarnings || {});
    
    // Sync toggle if changed externally
    if (autoAssignCheck && autoAssignCheck.checked !== currentSettings.autoAssign) {
      autoAssignCheck.checked = currentSettings.autoAssign;
    }

    // Update Queue
    const queueCount = document.getElementById('queueCount');
    const queueList = document.getElementById('queueList');
    if (queueCount && queueList) {
      queueCount.textContent = data.jobQueue.length;
      queueList.innerHTML = '';
      if (data.jobQueue.length === 0) {
        const li = document.createElement('li');
        const span = document.createElement('span');
        span.textContent = 'No queued jobs';
        span.style.color = 'var(--color-secondary)';
        span.style.fontStyle = 'italic';
        li.appendChild(span);
        queueList.appendChild(li);
      } else {
        data.jobQueue.forEach((job, idx) => {
          const li = document.createElement('li');
          li.textContent = `${idx + 1}. ${job.filename}${job.status === 'sending' ? ' - sending' : ''}`;
          li.title = job.filename;
          queueList.appendChild(li);
        });
      }
    }

    // Update Failed Jobs
    const failedJobsContainer = document.getElementById('failedJobsContainer');
    const failedCount = document.getElementById('failedCount');
    const failedList = document.getElementById('failedList');
    if (failedJobsContainer && failedCount && failedList && data.failedJobs) {
      if (data.failedJobs.length > 0) {
        failedJobsContainer.style.display = 'block';
        failedCount.textContent = data.failedJobs.length;
        failedList.innerHTML = '';
        data.failedJobs.forEach((job, idx) => {
          const li = document.createElement('li');
          const textContainer = document.createElement('div');
          textContainer.style.display = 'flex';
          textContainer.style.flexDirection = 'column';
          textContainer.style.gap = '2px';
          
          const nameSpan = document.createElement('span');
          const attempts = Number(job.attempts);
          const failureLabel = job.failureReason === 'unconfirmed_start'
            ? 'Start unconfirmed'
            : (Number.isFinite(attempts) && attempts > 0 ? `Failed ${attempts}x` : 'Failed');
          nameSpan.textContent = `${idx + 1}. ${job.filename} (${failureLabel})`;
          nameSpan.title = job.failureMessage || job.filename;
          textContainer.appendChild(nameSpan);
          
          if (job.failureMessage) {
            const msgSpan = document.createElement('span');
            msgSpan.textContent = job.failureMessage;
            msgSpan.style.fontSize = '9px';
            msgSpan.style.opacity = '0.7';
            textContainer.appendChild(msgSpan);
          }
          
          const controlsDiv = document.createElement('div');
          if (job.status === 'sending') {
            const span = document.createElement('span');
            span.style.fontSize = '10px';
            span.style.color = 'var(--color-accent)';
            span.textContent = 'SENDING...';
            controlsDiv.appendChild(span);
          } else {
            if (job.filePath) {
              const requeueBtn = document.createElement('button');
              requeueBtn.className = 'requeue-btn';
              requeueBtn.textContent = 'REQUEUE';
              requeueBtn.title = 'Send back to active Queue';
              requeueBtn.addEventListener('click', () => requeueJob(job.id, requeueBtn, 'REQUEUE'));
              controlsDiv.appendChild(requeueBtn);
            }
          }
          
          li.appendChild(textContainer);
          li.appendChild(controlsDiv);
          failedList.appendChild(li);
        });
      } else {
        failedJobsContainer.style.display = 'none';
      }
    }

    let sumTotal = 0, sumFree = 0, sumBusy = 0, sumClear = 0, sumError = 0, sumOffline = 0;

    // Process each printer, creating or updating cards
    const activeCardIds = new Set(Object.keys(data.farmState));
    for (const [id, state] of Object.entries(data.farmState)) {
      sumTotal++;
      if (state.farmState === 'free') sumFree++;
      else if (state.farmState === 'busy' || state.farmState === 'paused') sumBusy++;
      else if (state.farmState === 'needs_clearing') sumClear++;
      else if (state.farmState === 'error') {
        if (state.status === 'unreachable' || state.job === 'timeout') sumOffline++;
        else sumError++;
      }
      let card = printerCards[id];
      
      // If card doesn't exist, instantiate it from template and hook events
      if (!card) {
        const template = document.getElementById('printer-card-template');
        const clone = template.content.cloneNode(true);
        card = clone.querySelector('.printer-card');
        printerCards[id] = card;
        
        const assignBtn = card.querySelector('.manual-add-btn');
        const jobSelect = card.querySelector('.job-select');
        const clearBtn = card.querySelector('.clear-bed-btn');
        const localAutoCheck = card.querySelector('.local-auto-check');

        // Manual Assign Hook (Add to Printer Queue)
        assignBtn.addEventListener('click', async () => {
          const ip = card.dataset.ip;
          const jobId = jobSelect.value;
          if (!jobId) {
            alert('Please select a job from the queue.');
            return;
          }
          assignBtn.disabled = true;
          assignBtn.textContent = 'ADDING...';
          try {
            const res = await fetch(`/api/printers/queue-job?ip=${encodeURIComponent(ip)}&jobId=${encodeURIComponent(jobId)}`, { method: 'POST' });
            if (!res.ok) throw new Error(await res.text());
            
            assignBtn.textContent = 'ADDED';
            setTimeout(() => {
              if (assignBtn.textContent === 'ADDED') {
                assignBtn.textContent = 'ADD';
                assignBtn.disabled = false;
              }
            }, 1000);
            
            fetchStatus();
          } catch(err) {
            showCardMessage(card, 'error', `Add error: ${err.message}`);
            assignBtn.disabled = false;
            assignBtn.textContent = 'ADD';
          }
        });

        clearBtn.addEventListener('click', async () => {
          const ip = card.dataset.ip;
          try {
            const res = await fetch(`/api/clear-bed?ip=${encodeURIComponent(ip)}`, { method: 'POST' });
            if (!res.ok) throw new Error(await res.text());
            fetchStatus(); // immediate refresh
          } catch (err) {
            showCardMessage(card, 'error', `Clear bed error: ${err.message}`);
          }
        });

        if (localAutoCheck) {
          localAutoCheck.addEventListener('change', async (e) => {
            const ip = card.dataset.ip;
            const nextValue = e.target.checked;
            e.target.disabled = true;
            try {
              const res = await fetch(`/api/printers/local-auto-print?ip=${encodeURIComponent(ip)}&value=${nextValue}`, { method: 'POST' });
              if (!res.ok) throw new Error(await res.text());
              showCardMessage(card, 'success', nextValue ? 'Local Auto-Print enabled' : 'Local Auto-Print disabled');
            } catch (err) {
              e.target.checked = !nextValue;
              showCardMessage(card, 'error', `Auto-Print error: ${err.message}`);
            } finally {
              e.target.disabled = false;
            }
          });
        }

        // Local Upload Hook
        const localUploadInput = card.querySelector('.local-file-input');
        if (localUploadInput) {
          localUploadInput.addEventListener('change', async (e) => {
            const ip = card.dataset.ip;
            const file = e.target.files[0];
            if (!file) return;
            try {
              const res = await fetch(`/api/upload?filename=${encodeURIComponent(file.name)}&ip=${encodeURIComponent(ip)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: file
              });
              if (!res.ok) throw new Error(await res.text());
              showCardMessage(card, 'success', 'Uploaded successfully');
            } catch (err) {
              showCardMessage(card, 'error', `Local upload error: ${err.message}`);
            } finally {
              localUploadInput.value = ''; // clear input
              fetchStatus(); // trigger immediate refresh
            }
          });
        }

        grid.appendChild(card);
      }
      
      // Update data attributes
      card.dataset.ip = state.ip;

      // Now update the DOM elements with new state
      card.querySelector('.printer-name').textContent = `Printer ${id}`;
      const actionInputTitle = card.querySelector('.fake-input-text');
      if (actionInputTitle) actionInputTitle.textContent = `Upload to Printer ${id}`;
      
      const ipEl = card.querySelector('.printer-ip');
      if (ipEl) ipEl.textContent = state.ip || '0.0.0.0';

      const formatTemp = (current, target, forceEmpty) => {
        if (forceEmpty) return '-- / --\u00B0C';
        if (current === undefined || current === null || isNaN(current)) return '-- / --\u00B0C';
        return `${Math.round(current)} / ${Math.round(target || 0)}\u00B0C`;
      };
      
      const isOffline = (state.farmState === 'error' && (state.status === 'unreachable' || state.job === 'timeout'));
      
      card.querySelector('.nozzle-temp').textContent = formatTemp(state.nozzleTemp, state.targetNozzleTemp, isOffline);
      card.querySelector('.bed-temp').textContent = formatTemp(state.bedTemp, state.targetBedTemp, isOffline);
      
      const badge = card.querySelector('.status-badge');
      const progressSection = card.querySelector('.progress-section');
      const progressFill = card.querySelector('.progress-fill');
      const progressText = card.querySelector('.progress-text');
      const clearBtn = card.querySelector('.clear-bed-btn');
      
      const manualAssignSection = card.querySelector('.manual-assign-section');
      const localQueueSection = card.querySelector('.local-queue-section');
      const localAutoCheck = card.querySelector('.local-auto-check');
      const localUploadSection = card.querySelector('.local-upload-section');
      const offlineMsg = card.querySelector('.offline-message');
      const statsEl = card.querySelector('.stats');
      const jobSelect = card.querySelector('.job-select');
      const rawDebugView = card.querySelector('.raw-debug-view');
      
      const isRawDebug = rawDebugCheck && rawDebugCheck.checked && rawDebugView;
      
      if (isRawDebug) {
        progressSection.style.display = 'none';
        clearBtn.style.display = 'none';
        manualAssignSection.style.display = 'none';
        localQueueSection.style.display = 'none';
        if (localUploadSection) localUploadSection.style.display = 'none';
        if (offlineMsg) offlineMsg.style.display = 'none';
        if (statsEl) statsEl.style.display = 'none';
        
        rawDebugView.style.display = 'block';
        rawDebugView.textContent = JSON.stringify(state, null, 2);
        
        // Reset classes
        badge.className = 'status-badge';
        badge.textContent = 'RAW';
        
        continue; // Skip the rest of the graphical rendering for this card
      } else {
        if (rawDebugView) rawDebugView.style.display = 'none';
        if (isOffline) {
          localQueueSection.style.display = 'none';
          if (localUploadSection) localUploadSection.style.display = 'none';
          if (offlineMsg) offlineMsg.style.display = 'block';
          if (statsEl) statsEl.style.display = 'none';
        } else {
          localQueueSection.style.display = 'block';
          if (localUploadSection) localUploadSection.style.display = 'flex';
          if (offlineMsg) offlineMsg.style.display = 'none';
          if (statsEl) statsEl.style.display = 'flex';
        }
      }

      // Update options ONLY if the queue has changed to prevent closing the dropdown
      const assignableJobs = data.jobQueue.filter(job => job.status !== 'sending');
      const currentOptions = Array.from(jobSelect.options).filter(opt => opt.value !== '');
      let queueChanged = currentOptions.length !== assignableJobs.length;
      if (!queueChanged) {
        for (let i = 0; i < assignableJobs.length; i++) {
          if (currentOptions[i].value !== assignableJobs[i].id) {
            queueChanged = true;
            break;
          }
        }
      }

      if (queueChanged) {
        const currentSelection = jobSelect.value;
        jobSelect.innerHTML = ''; 
        
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'Select a file from queue...';
        jobSelect.appendChild(defaultOption);

        assignableJobs.forEach(job => {
          const option = document.createElement('option');
          option.value = job.id;
          option.textContent = job.filename;
          option.title = job.filename;
          jobSelect.appendChild(option);
        });

        if (currentSelection && jobSelect.querySelector(`option[value="${currentSelection}"]`)) {
          jobSelect.value = currentSelection;
        }
      }

      const rawState = state.farmState;
      if (localAutoCheck) {
        localAutoCheck.checked = !!(data.localAutoPrint && data.localAutoPrint[state.ip]);
        localAutoCheck.disabled = isOffline;
      }
      
      // Reset classes
      badge.className = 'status-badge';
      badge.removeAttribute('style');
      
      if (rawState === 'starting') {
        badge.textContent = 'STARTING';
        badge.classList.add('starting');
        progressSection.style.display = 'block';
        progressFill.style.width = '100%';
        progressText.textContent = `Starting ${state.displayJob || 'job'}...`;
        progressText.title = state.displayJob || 'Starting job';
        clearBtn.style.display = 'none';
        manualAssignSection.style.display = 'flex';
      } else if (rawState === 'busy' || rawState === 'paused') {
        badge.textContent = rawState === 'busy' ? 'PRINTING' : 'PAUSED';
        badge.classList.add(rawState === 'busy' ? 'printing' : 'heating');
        progressSection.style.display = 'block';
        clearBtn.style.display = 'none';
        manualAssignSection.style.display = 'flex';
        const progress = Math.max(0, Math.min(100, state.printProgress || 0));
        progressFill.style.width = `${progress}%`;
        progressText.textContent = `${progress}% - ${state.displayJob || 'Unknown'}`;
        progressText.title = state.displayJob || 'Unknown';
      } else if (rawState === 'error') {
        if (isOffline) {
          badge.textContent = 'OFFLINE';
          badge.classList.add('offline');
          progressSection.style.display = 'none';
          clearBtn.style.display = 'none';
          manualAssignSection.style.display = 'none';
        } else {
          badge.textContent = 'ERROR';
          badge.classList.add('error');
          progressSection.style.display = 'none';
          clearBtn.style.display = 'none';
          manualAssignSection.style.display = 'flex';
        }
      } else if (rawState === 'needs_clearing') {
        badge.textContent = 'NEEDS CLEARING';
        badge.classList.add('heating'); // Orange warning glow
        progressSection.style.display = 'none';
        clearBtn.style.display = 'block';
        manualAssignSection.style.display = 'flex';
      } else {
        // Free
        badge.textContent = 'FREE';
        badge.classList.add('free');
        progressSection.style.display = 'none';
        clearBtn.style.display = 'none';
        manualAssignSection.style.display = 'flex';
      }

      // Render Local Queue
      const localQueueList = card.querySelector('.local-queue-list');
      const localQ = data.printerQueues[state.ip] || [];
      localQueueList.innerHTML = ''; // Re-render the local list each tick
      
      if (localQ.length === 0) {
        const li = document.createElement('li');
        li.className = 'local-job-item';
        const span = document.createElement('span');
        span.style.color = 'var(--color-secondary)';
        span.style.fontStyle = 'italic';
        span.style.fontSize = '10px';
        span.textContent = 'No printer-local jobs';
        li.appendChild(span);
        localQueueList.appendChild(li);
      } else {
        localQ.forEach((job) => {
          const li = document.createElement('li');
          li.className = 'local-job-item';
          
          const nameSpan = document.createElement('span');
          nameSpan.className = 'local-job-name';
          nameSpan.textContent = job.filename;
          nameSpan.title = job.filename;
          
          const controlsDiv = document.createElement('div');
          controlsDiv.className = 'local-job-actions';
          
          const startBtn = document.createElement('button');
          startBtn.className = 'start-local-btn';
          startBtn.textContent = 'START';
          
          // Only allow starting if printer is truly FREE
          if (rawState !== 'free') {
            startBtn.disabled = true;
            startBtn.title = 'Printer must be FREE to start a local job.';
          }
          
          if (job.status === 'sending') {
            startBtn.disabled = true;
            startBtn.textContent = 'SENDING...';
          }
          
          startBtn.addEventListener('click', async () => {
            const ip = card.dataset.ip;
            startBtn.disabled = true;
            startBtn.textContent = 'STARTING...';
            try {
              const res = await fetch(`/api/printers/start-job?ip=${encodeURIComponent(ip)}&jobId=${encodeURIComponent(job.id)}`, { method: 'POST' });
              if (!res.ok) throw new Error(await res.text());
              startBtn.textContent = 'START SENT';
              setTimeout(() => fetchStatus(), 1000);
            } catch(err) {
              showCardMessage(card, 'error', `Start error: ${err.message}`);
              startBtn.disabled = false;
              startBtn.textContent = 'START';
            }
          });
          
          const removeBtn = document.createElement('button');
          removeBtn.className = 'start-local-btn remove-job-btn';
          removeBtn.textContent = '×';
          removeBtn.title = 'Remove Job';
          
          if (job.status === 'sending') {
            removeBtn.disabled = true;
          }
          
          removeBtn.addEventListener('click', async () => {
            const ip = card.dataset.ip;
            removeBtn.disabled = true;
            try {
              const res = await fetch(`/api/printers/queue-job?ip=${encodeURIComponent(ip)}&jobId=${encodeURIComponent(job.id)}`, { method: 'DELETE' });
              if (!res.ok) throw new Error(await res.text());
              fetchStatus();
            } catch(err) {
              showCardMessage(card, 'error', `Remove error: ${err.message}`);
              removeBtn.disabled = false;
            }
          });
          
          controlsDiv.appendChild(startBtn);
          controlsDiv.appendChild(removeBtn);
          
          li.appendChild(nameSpan);
          li.appendChild(controlsDiv);
          localQueueList.appendChild(li);
        });
      }
    }

    for (const [id, card] of Object.entries(printerCards)) {
      if (!activeCardIds.has(id)) {
        card.remove();
        delete printerCards[id];
      }
    }

    // First-run empty state: no printers configured or discovered yet
    const emptyState = document.getElementById('farm-empty-state');
    if (emptyState) {
      emptyState.style.display = Object.keys(data.farmState).length === 0 ? 'block' : 'none';
    }

    // Update Summary Row DOM
    const sumTotalEl = document.getElementById('sum-total');
    if (sumTotalEl) sumTotalEl.textContent = sumTotal;
    
    const sumFreeEl = document.getElementById('sum-free');
    if (sumFreeEl) sumFreeEl.textContent = sumFree;
    
    const sumBusyEl = document.getElementById('sum-busy');
    if (sumBusyEl) sumBusyEl.textContent = sumBusy;
    
    const sumClearEl = document.getElementById('sum-clear');
    if (sumClearEl) sumClearEl.textContent = sumClear;
    
    const sumOfflineEl = document.getElementById('sum-offline');
    if (sumOfflineEl) sumOfflineEl.textContent = sumOffline;
    
    const sumErrorEl = document.getElementById('sum-error');
    if (sumErrorEl) sumErrorEl.textContent = sumError;
  } catch (err) {
    console.error('Failed to fetch status', err);
  }
}

// Global Upload Handler
if (globalFileInput) {
  globalFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
      const res = await fetch(`/api/upload?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (err) {
      alert(`Queue error: ${err.message}`);
    } finally {
      globalFileInput.value = ''; // clear input
      fetchStatus(); // trigger immediate refresh
    }
  });
}

if (autoAssignCheck) {
  autoAssignCheck.addEventListener('change', async (e) => {
    const nextValue = e.target.checked;
    try {
      const res = await fetch(`/api/settings/auto-assign?value=${nextValue}`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      currentSettings.autoAssign = nextValue;
    } catch (err) {
      e.target.checked = !nextValue;
      console.error(err);
    }
  });
}

const discoveryModes = document.querySelectorAll('input[name="discoveryMode"]');
const subnetInput = document.getElementById('subnetInput');
const discoveryDesc = document.getElementById('discoveryDescription');
const scanBtn = document.getElementById('scanBtn');
const scanStatus = document.getElementById('scanStatus');

if (discoveryModes && subnetInput && discoveryDesc && scanBtn && scanStatus) {
  let detectedSubnetMsg = 'No private LAN detected. Use hotspot/travel router or enter a printer/router IP.';

  fetch('/api/discovery/subnets')
    .then(res => res.json())
    .then(subnets => {
      if (subnets && subnets.length > 0) {
        const hotspot = subnets.find(s => s.subnet === '192.168.137');
        const preferred = subnets.find(s => s.preferred);
        const best = hotspot || preferred;
        if (best) {
          if (best.subnet === '192.168.137') {
            detectedSubnetMsg = `Ready to scan Windows hotspot 192.168.137.0/24.`;
          } else {
            detectedSubnetMsg = `Ready to scan ${best.subnet}.0/24.`;
          }
        }
      }
      const modeNode = document.querySelector('input[name="discoveryMode"]:checked');
      if (modeNode && modeNode.value === 'auto') {
        discoveryDesc.textContent = detectedSubnetMsg;
      }
    })
    .catch(err => console.error('Failed to load subnets', err));

  const tryHotspotBtn = document.getElementById('tryHotspotBtn');
  if (tryHotspotBtn) {
    tryHotspotBtn.addEventListener('click', () => {
      const hotspotRadio = document.querySelector('input[name="discoveryMode"][value="hotspot"]');
      if (hotspotRadio) {
        hotspotRadio.checked = true;
        hotspotRadio.dispatchEvent(new Event('change'));
      }
      subnetInput.value = '192.168.137';
      scanBtn.click();
    });
  }

  discoveryModes.forEach(radio => {
    radio.addEventListener('change', (e) => {
      const mode = e.target.value;
      if (mode === 'auto') {
        subnetInput.style.display = 'none';
        discoveryDesc.textContent = detectedSubnetMsg;
        subnetInput.placeholder = '';
      } else if (mode === 'home') {
        subnetInput.style.display = 'block';
        discoveryDesc.textContent = 'Laptop and printers are on the same private router Wi-Fi.';
        subnetInput.placeholder = '192.168.1 or printer IP';
      } else if (mode === 'hotspot') {
        subnetInput.style.display = 'block';
        discoveryDesc.textContent = 'Printers are connected to a laptop/phone/travel-router hotspot. (Windows usually uses 192.168.137)';
        subnetInput.placeholder = '192.168.137';
        if (!subnetInput.value.trim()) {
          subnetInput.value = '192.168.137';
        }
      }
      scanStatus.textContent = '';
      if (tryHotspotBtn) tryHotspotBtn.style.display = 'none';
    });
  });

  scanBtn.addEventListener('click', async () => {
    const modeNode = document.querySelector('input[name="discoveryMode"]:checked');
    const mode = modeNode ? modeNode.value : 'auto';
    let url = '/api/discover';
    
    if (mode !== 'auto') {
      const val = subnetInput.value.trim();
      if (!val) {
        scanStatus.textContent = mode === 'home' 
          ? 'Enter a private network like 192.168.1, or paste a printer/router IP like 192.168.1.42.'
          : 'Enter your hotspot subnet (usually 192.168.137).';
        scanStatus.style.color = 'var(--color-status-error)';
        return;
      }
      url += `?subnet=${encodeURIComponent(val)}`;
    }
    
    scanBtn.disabled = true;
    scanBtn.textContent = '...';
    scanStatus.textContent = `Scanning...`;
    scanStatus.style.color = 'var(--color-status-heating)';
    
    try {
      const res = await fetch(url);
      const data = await res.json();
      
      if (!res.ok) {
        if (data.error && data.error.includes('Not a private network')) {
           setDiscoveryMessage('error', 'Public/campus network blocked', 'PrinterFarm only scans private LANs like 192.168.x.x, 10.x.x.x, or 172.16-31.x.x.');
           return;
        }
        throw new Error(data.error || 'Scan failed');
      }
      
      if (data.found.length === 0) {
        const searched = data.subnet || (mode !== 'auto' ? val : 'the network');
        setDiscoveryMessage('warning', 'No printers found', 
          `PrinterFarm scanned ${searched} but did not find any reachable Creality printers.<br>
          <ul style="margin-left:16px; margin-top:4px;">
            <li>Make sure printers are connected to the same hotspot/router.</li>
            <li>Try opening the printer IP in your browser.</li>
            <li>Campus/company Wi-Fi may block device-to-device traffic.</li>
            <li>If using Windows hotspot, try 192.168.137.</li>
          </ul>`, { html: true });
      } else {
        setDiscoveryMessage('success', '', `Found ${data.found.length} printers on ${data.subnet}. Updated farm.`);
        
        // Wipe local UI state so it rebuilds from the new farm list cleanly
        grid.innerHTML = '';
        for (const key in printerCards) delete printerCards[key];
        
        fetchStatus();
      }
    } catch (err) {
      if (mode === 'auto' && (err.message.includes('could not detect local subnet') || err.message.includes('Not a private network'))) {
        setDiscoveryMessage('warning', 'No private printer network detected', 'Use Hotspot mode or Home/Router mode and paste a printer/router IP.');
        if (tryHotspotBtn) tryHotspotBtn.style.display = 'inline-block';
      } else {
        setDiscoveryMessage('error', 'Error', err.message);
      }
    } finally {
      scanBtn.disabled = false;
      scanBtn.textContent = 'DISCOVER';
    }
  });
}

// Poll every 2 seconds
setInterval(fetchStatus, 2000);
fetchStatus();
