document.addEventListener('DOMContentLoaded', () => {
  const settingsLink = document.getElementById('settingsLink');
  const warningSettingsLink = document.getElementById('warningSettingsLink');
  const noKeyWarning = document.getElementById('noKeyWarning');
  const auditBtn = document.getElementById('auditBtn');
  const statusDiv = document.getElementById('status');
  const metricsPanel = document.getElementById('metricsPanel');
  const resultText = document.getElementById('resultText');
  const copyBtn = document.getElementById('copyBtn');

  // Badges and values
  const slaBadge = document.getElementById('slaBadge');
  const frtVal = document.getElementById('frtVal');
  const artVal = document.getElementById('artVal');
  const deadAirBadge = document.getElementById('deadAirBadge');
  const ahtVal = document.getElementById('ahtVal');

  const storage = typeof chrome !== 'undefined' && chrome.storage ? chrome.storage.local : browser.storage.local;
  const runtime = typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime : browser.runtime;
  const tabs = typeof chrome !== 'undefined' && chrome.tabs ? chrome.tabs : browser.tabs;

  // Open options page
  const openSettings = (e) => {
    e.preventDefault();
    if (runtime.openOptionsPage) {
      runtime.openOptionsPage();
    } else {
      window.open(runtime.getURL('options/options.html'));
    }
  };

  settingsLink.addEventListener('click', openSettings);
  warningSettingsLink.addEventListener('click', openSettings);

  // Check key configuration
  storage.get(['geminiApiKey'], (result) => {
    if (!result.geminiApiKey) {
      noKeyWarning.style.display = 'block';
      auditBtn.disabled = true;
    }
  });

  // Helper formatting minutes & seconds
  function formatTime(seconds) {
    if (seconds === null || seconds === undefined) return 'N/A';
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }

  // Audit Trigger
  auditBtn.addEventListener('click', async () => {
    statusDiv.textContent = 'Scanning page timeline...';
    statusDiv.style.color = '#495057';
    auditBtn.disabled = true;
    resultText.value = '';
    copyBtn.disabled = true;
    metricsPanel.style.display = 'none';

    try {
      const [tab] = await tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        throw new Error('No active tab found.');
      }

      if (!tab.url || !tab.url.includes('intercom.com')) {
        throw new Error('Auditor only works on active intercom.com conversation pages.');
      }

      statusDiv.textContent = 'Auto-scrolling and analyzing timestamps...';

      runtime.sendMessage({ action: 'runAudit', tabId: tab.id }, (response) => {
        if (runtime.lastError) {
          showError(runtime.lastError.message);
          return;
        }

        if (!response) {
          showError('No response received from the background script.');
          return;
        }

        if (response.success) {
          statusDiv.textContent = 'Audit scorecard generated!';
          statusDiv.style.color = '#2b8a3e';

          // Render metrics
          const metrics = response.metrics;
          metricsPanel.style.display = 'block';

          if (metrics.status === 'Success') {
            // SLA
            if (metrics.slaMet) {
              slaBadge.textContent = 'Met';
              slaBadge.className = 'badge pass';
            } else {
              slaBadge.textContent = 'Failed';
              slaBadge.className = 'badge fail';
            }

            frtVal.textContent = formatTime(metrics.responseTimeSeconds);
            artVal.textContent = formatTime(metrics.avgResponseTimeSeconds);

            // Dead Air
            if (metrics.deadAirDetected) {
              deadAirBadge.textContent = 'Gap Detected';
              deadAirBadge.className = 'badge fail';
            } else {
              deadAirBadge.textContent = 'None';
              deadAirBadge.className = 'badge pass';
            }

            ahtVal.textContent = formatTime(metrics.handlingTimeSeconds);
          } else {
            // Incomplete metrics
            slaBadge.textContent = 'N/A';
            slaBadge.className = 'badge info';
            frtVal.textContent = metrics.status;
            artVal.textContent = '--';
            deadAirBadge.textContent = 'N/A';
            deadAirBadge.className = 'badge info';
            ahtVal.textContent = '--';
          }

          resultText.value = response.auditReport;
          copyBtn.disabled = false;
        } else {
          showError(response.error || 'An unexpected error occurred.');
        }
        auditBtn.disabled = false;
      });

    } catch (err) {
      showError(err.message);
      auditBtn.disabled = false;
    }
  });

  // Copy Report
  copyBtn.addEventListener('click', () => {
    resultText.select();
    document.execCommand('copy');
    const originalText = copyBtn.textContent;
    copyBtn.textContent = 'Copied Scorecard!';
    setTimeout(() => {
      copyBtn.textContent = originalText;
    }, 2000);
  });

  function showError(msg) {
    statusDiv.textContent = `Error: ${msg}`;
    statusDiv.style.color = '#c92a2a';
  }
});
