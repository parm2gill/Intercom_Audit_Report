document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const modelSelect = document.getElementById('model');
  const slaLimitInput = document.getElementById('slaLimit');
  const saveBtn = document.getElementById('saveBtn');
  const statusDiv = document.getElementById('status');

  const storage = typeof chrome !== 'undefined' && chrome.storage ? chrome.storage.local : browser.storage.local;

  // Load saved configurations
  storage.get(['geminiApiKey', 'geminiModel', 'slaLimitSeconds'], (result) => {
    if (result.geminiApiKey) {
      apiKeyInput.value = result.geminiApiKey;
    }
    if (result.geminiModel) {
      modelSelect.value = result.geminiModel;
    }
    if (result.slaLimitSeconds) {
      slaLimitInput.value = result.slaLimitSeconds;
    }
  });

  // Save settings
  saveBtn.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    const model = modelSelect.value;
    const slaLimit = parseInt(slaLimitInput.value, 10);

    if (!apiKey) {
      showStatus('Please configure your Gemini API Key.', 'error');
      return;
    }

    if (isNaN(slaLimit) || slaLimit < 10) {
      showStatus('SLA threshold must be at least 10 seconds.', 'error');
      return;
    }

    storage.set({
      geminiApiKey: apiKey,
      geminiModel: model,
      slaLimitSeconds: slaLimit
    }, () => {
      showStatus('Auditor settings successfully updated!', 'success');
    });
  });

  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = 'block';
    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, 3000);
  }
});
