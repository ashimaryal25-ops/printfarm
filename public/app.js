const grid = document.getElementById('printer-grid');
const template = document.getElementById('printer-card-template');
const autoAssignCheck = document.getElementById('autoAssignCheck');
const rawDebugCheck = document.getElementById('rawDebugCheck');

// Store card elements to update them efficiently
const printerCards = {};

async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    lastState = data;
    currentSettings = data.settings || currentSettings;
    
    // Sync toggle if changed externally
    if (autoAssignCheck && autoAssignCheck.checked !== currentSettings.autoAssign) {
      autoAssignCheck.checked = currentSettings.autoAssign;
    }

    // Update Queue
    queueCount.textContent = data.jobQueue.length;
    queueList.innerHTML = '';
    data.jobQueue.forEach((job, idx) => {
      const li = document.createElement('li');
      li.textContent = `${idx + 1}. ${job.filename}`;
      queueList.appendChild(li);
    });

    // (Removed unsafe HTML string generation)

    // Remove grid.innerHTML = '';
    // Process each printer, creating or updating cards
    for (const [id, state] of Object.entries(data.farmState)) {
      let card = printerCards[id];
      
      // If card doesn't exist, instantiate it from template and hook events
      if (!card) {
        const template = document.getElementById('printer-card-template');
        const clone = template.content.cloneNode(true);
        card = clone.querySelector('.printer-card');
        printerCards[id] = card;
        
        const assignBtn = card.querySelector('.assign-btn');
        const jobSelect = card.querySelector('.job-select');
        const clearBtn = card.querySelector('.clear-bed-btn');

        // Manual Assign Hook (Add to Printer Queue)
        assignBtn.addEventListener('click', async () => {
          const jobId = jobSelect.value;
          if (!jobId) return;
          assignBtn.disabled = true;
          assignBtn.textContent = 'ADDING...';
          try {
            await fetch(`/api/printers/queue-job?ip=${state.ip}&jobId=${jobId}`, { method: 'POST' });
            fetchStatus();
          } catch(err) {
            console.error(err);
          } finally {
            assignBtn.disabled = false;
            assignBtn.textContent = 'ADD TO PRINTER';
          }
        });

        // Clear Bed Hook
        clearBtn.addEventListener('click', async () => {
          await fetch(`/api/clear-bed?ip=${state.ip}`, { method: 'POST' });
          fetchStatus(); // immediate refresh
        });

        // Local Upload Hook
        const localUploadInput = card.querySelector('.local-file-input');
        if (localUploadInput) {
          localUploadInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
              const res = await fetch(`/api/upload?filename=${encodeURIComponent(file.name)}&ip=${state.ip}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: file
              });
              if (!res.ok) throw new Error('Upload failed');
            } catch (err) {
              alert(`Local upload error: ${err.message}`);
            } finally {
              localUploadInput.value = ''; // clear input
              fetchStatus(); // trigger immediate refresh
            }
          });
        }

        grid.appendChild(card);
      }

      // Now update the DOM elements with new state
      card.querySelector('.printer-name').textContent = `Printer ${id}`;
      card.querySelector('.nozzle-temp').textContent = `${Math.round(state.nozzleTemp)} / ${state.targetNozzleTemp}°C`;
      card.querySelector('.bed-temp').textContent = `${Math.round(state.bedTemp)} / ${state.targetBedTemp}°C`;
      
      const badge = card.querySelector('.status-badge');
      const progressSection = card.querySelector('.progress-section');
      const progressFill = card.querySelector('.progress-fill');
      const progressText = card.querySelector('.progress-text');
      const clearBtn = card.querySelector('.clear-bed-btn');
      
      const manualAssignSection = card.querySelector('.manual-assign-section');
      const localQueueSection = card.querySelector('.local-queue-section');
      const jobSelect = card.querySelector('.job-select');
      const rawDebugView = card.querySelector('.raw-debug-view');
      
      const isRawDebug = rawDebugCheck && rawDebugCheck.checked && rawDebugView;
      
      if (isRawDebug) {
        progressSection.style.display = 'none';
        clearBtn.style.display = 'none';
        manualAssignSection.style.display = 'none';
        localQueueSection.style.display = 'none';
        card.querySelector('.stats-grid').style.display = 'none';
        
        rawDebugView.style.display = 'block';
        rawDebugView.textContent = JSON.stringify(state, null, 2);
        
        // Reset classes
        badge.className = 'status-badge';
        badge.textContent = 'RAW';
        
        continue; // Skip the rest of the graphical rendering for this card
      } else {
        if (rawDebugView) rawDebugView.style.display = 'none';
        localQueueSection.style.display = 'block';
        card.querySelector('.stats-grid').style.display = 'grid';
      }

      // Update options but KEEP current selection if possible
      const currentSelection = jobSelect.value;
      jobSelect.innerHTML = ''; // safe to clear innerHTML to empty
      
      const defaultOption = document.createElement('option');
      defaultOption.value = '';
      defaultOption.textContent = 'Select a job...';
      jobSelect.appendChild(defaultOption);

      data.jobQueue.forEach(job => {
        const option = document.createElement('option');
        option.value = job.id;
        option.textContent = job.filename;
        jobSelect.appendChild(option);
      });

      if (currentSelection && jobSelect.querySelector(`option[value="${currentSelection}"]`)) {
        jobSelect.value = currentSelection;
      }

      const rawState = state.farmState;
      
      // Reset classes
      badge.className = 'status-badge'; 
      
      if (rawState === 'busy' || rawState === 'paused') {
        badge.textContent = rawState === 'busy' ? 'PRINTING' : 'PAUSED';
        badge.classList.add(rawState === 'busy' ? 'printing' : 'heating');
        progressSection.style.display = 'block';
        clearBtn.style.display = 'none';
        manualAssignSection.style.display = 'none';
        progressFill.style.width = `${state.printProgress}%`;
        progressText.textContent = `${state.printProgress}% - ${state.displayJob}`;
      } else if (rawState === 'error') {
        badge.textContent = 'ERROR';
        badge.classList.add('error');
        progressSection.style.display = 'none';
        clearBtn.style.display = 'none';
        manualAssignSection.style.display = 'none';
      } else if (rawState === 'needs_clearing') {
        badge.textContent = 'NEEDS CLEARING';
        badge.classList.add('heating'); // Orange warning glow
        progressSection.style.display = 'none';
        clearBtn.style.display = 'block';
        manualAssignSection.style.display = 'none';
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
      
      localQ.forEach((job) => {
        const li = document.createElement('li');
        li.className = 'local-job-item';
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'local-job-name';
        nameSpan.textContent = job.filename;
        nameSpan.title = job.filename;
        
        const controlsDiv = document.createElement('div');
        controlsDiv.style.display = 'flex';
        controlsDiv.style.gap = '8px';
        
        const startBtn = document.createElement('button');
        startBtn.className = 'start-local-btn';
        startBtn.textContent = 'START';
        
        // Only allow starting if printer is truly FREE
        if (rawState !== 'free') {
          startBtn.disabled = true;
        }
        
        startBtn.addEventListener('click', async () => {
          startBtn.disabled = true;
          startBtn.textContent = '...';
          try {
            await fetch(`/api/printers/start-job?ip=${state.ip}&jobId=${job.id}`, { method: 'POST' });
            fetchStatus();
          } catch(err) {
            console.error(err);
            startBtn.disabled = false;
            startBtn.textContent = 'START';
          }
        });
        
        const removeBtn = document.createElement('button');
        removeBtn.className = 'start-local-btn';
        removeBtn.style.backgroundColor = 'var(--color-danger)';
        removeBtn.textContent = '✖';
        removeBtn.title = 'Remove Job';
        removeBtn.addEventListener('click', async () => {
          removeBtn.disabled = true;
          try {
            await fetch(`/api/printers/queue-job?ip=${state.ip}&jobId=${job.id}`, { method: 'DELETE' });
            fetchStatus();
          } catch(err) {
            console.error(err);
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
  } catch (err) {
    console.error('Failed to fetch status', err);
  }
}

// Global Upload Handler
globalFileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  try {
    const res = await fetch(`/api/upload?filename=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file
    });
    if (!res.ok) throw new Error('Queue failed');
  } catch (err) {
    alert(`Queue error: ${err.message}`);
  } finally {
    globalFileInput.value = ''; // clear input
    fetchStatus(); // trigger immediate refresh
  }
});

if (autoAssignCheck) {
  autoAssignCheck.addEventListener('change', async (e) => {
    try {
      await fetch(`/api/settings/auto-assign?value=${e.target.checked}`, { method: 'POST' });
      currentSettings.autoAssign = e.target.checked;
    } catch (err) {
      console.error(err);
    }
  });
}

// Poll every 2 seconds
setInterval(fetchStatus, 2000);
fetchStatus();
