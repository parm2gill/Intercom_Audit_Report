// Background Script for Intercom Chat Auditor

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Dynamically injects content.js if not already active.
 */
async function injectContentScript(tabId) {
  try {
    await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { action: 'ping' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          reject(new Error('Content script inactive'));
        } else {
          resolve();
        }
      });
    });
  } catch (err) {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['scripts/content.js']
    });
  }
}

/**
 * Calculates programmatic metrics from messages.
 */
function calculateMetrics(messages, slaLimitSeconds) {
  // 1. Find first human agent response
  const firstAgentIndex = messages.findIndex(m => m.senderType === 'agent' && !m.isBot);
  
  if (firstAgentIndex === -1) {
    return {
      status: 'No Agent Response Yet',
      slaMet: false,
      responseTimeSeconds: null,
      avgResponseTimeSeconds: null,
      deadAirDetected: false,
      handlingTimeSeconds: null
    };
  }

  // 2. Find last proctor message before that first agent response
  let proctorLastIndex = -1;
  for (let i = firstAgentIndex - 1; i >= 0; i--) {
    if (messages[i].senderType === 'customer' && !messages[i].isBot) {
      proctorLastIndex = i;
      break;
    }
  }

  if (proctorLastIndex === -1) {
    return {
      status: 'No Proctor Message Found',
      slaMet: false,
      responseTimeSeconds: null,
      avgResponseTimeSeconds: null,
      deadAirDetected: false,
      handlingTimeSeconds: null
    };
  }

  const landingTime = new Date(messages[proctorLastIndex].timestamp).getTime();
  const ackTime = new Date(messages[firstAgentIndex].timestamp).getTime();
  const responseTimeSeconds = Math.max(0, Math.floor((ackTime - landingTime) / 1000));
  const slaMet = responseTimeSeconds <= slaLimitSeconds;

  // 3. Calculate subsequent response times (ART) & Dead Air gaps (> 180 seconds / 3 mins)
  let agentResponseGaps = [];
  let deadAirDetected = false;
  let lastCustomerTimestamp = null;

  messages.forEach(m => {
    if (m.isBot) return;
    
    if (m.senderType === 'customer') {
      lastCustomerTimestamp = new Date(m.timestamp).getTime();
    } else if (m.senderType === 'agent' && lastCustomerTimestamp !== null) {
      const agentTime = new Date(m.timestamp).getTime();
      const gapSeconds = Math.max(0, Math.floor((agentTime - lastCustomerTimestamp) / 1000));
      
      agentResponseGaps.push(gapSeconds);
      if (gapSeconds > 180) {
        deadAirDetected = true;
      }
      
      // Reset so we only measure first agent reply following a customer block
      lastCustomerTimestamp = null;
    }
  });

  const avgResponseTimeSeconds = agentResponseGaps.length > 0 
    ? Math.floor(agentResponseGaps.reduce((a, b) => a + b, 0) / agentResponseGaps.length)
    : responseTimeSeconds;

  // 4. Calculate total Handling Time (AHT)
  const firstMsgTime = new Date(messages[0].timestamp).getTime();
  const lastMsgTime = new Date(messages[messages.length - 1].timestamp).getTime();
  const handlingTimeSeconds = Math.max(0, Math.floor((lastMsgTime - firstMsgTime) / 1000));

  return {
    status: 'Success',
    slaMet: slaMet,
    responseTimeSeconds: responseTimeSeconds,
    avgResponseTimeSeconds: avgResponseTimeSeconds,
    deadAirDetected: deadAirDetected,
    handlingTimeSeconds: handlingTimeSeconds
  };
}

// Main listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'runAudit') {
    const tabId = request.tabId;

    (async () => {
      try {
        // 1. Inject and extract data
        await injectContentScript(tabId);
        
        const extraction = await new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(tabId, { action: 'extractChatAndAudit' }, (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (!response || !response.success) {
              reject(new Error(response ? response.error : 'Extraction failed.'));
            } else {
              resolve(response);
            }
          });
        });

        const { messages, sidebarText, bodyText } = extraction;

        // 2. Fetch options
        const settings = await new Promise((resolve) => {
          chrome.storage.local.get(['geminiApiKey', 'geminiModel', 'slaLimitSeconds'], (result) => {
            resolve(result);
          });
        });

        const apiKey = settings.geminiApiKey;
        const model = settings.geminiModel || 'gemini-3.5-flash';
        const slaLimitSeconds = settings.slaLimitSeconds || 60;

        if (!apiKey) {
          throw new Error('Gemini API key is not configured. Please open Settings.');
        }

        // 3. Calculate JS metrics
        const metrics = calculateMetrics(messages, slaLimitSeconds);

        // 4. Build prompt for Gemini to audit protocol compliance
        const systemPrompt = `You are an elite Quality-Control (QA) Auditor checking support chats between exam proctors/candidates and support agents.

Your job is to analyze the provided chronological message log, sidebar metadata, and page text to grade the support agent against the following standard protocol:

SOP COMPLIANCE PROTOCOLS:
1. PROFESSIONAL GREETING: Did the agent greet the proctor/candidate politely?
2. SKU/ID VERIFICATION: Did the agent acknowledge or verify the proctor's Session ID (UUID) and SKU? (Look at the sidebar or the first message from the proctor).
3. PROTOCOL TROUBLESHOOTING: Did the agent follow standard procedures (e.g. state they are checking the backend server status, referencing a standard cert-wiki protocol, or syncing the UI)?
4. SAFE CLOSURE: Did the agent get explicit consent/confirmation from the proctor that everything is okay before saying goodbye and closing the chat?

Analyze the conversation text meticulously. Ensure you evaluate ONLY what is written. Output the audit scorecard strictly in the FOLLOWING format. DO NOT use markdown bold formatting (like "**") for headers.

AUDIT REPORT SCORECARD:

Protocol Compliance: [PASS / FAIL / NEEDS REVIEW]
Protocol Rating: [e.g., 90% or 100%]

Checklist:
- Professional Greeting: [Yes/No] (Explanation)
- SKU/ID Verification: [Yes/No] (Explanation)
- Correct Troubleshooting: [Yes/No] (Explanation)
- Safe Closure: [Yes/No] (Explanation)

SOP Compliance Review:
[Provide a 2-3 sentence overview of how the agent followed or deviated from the standard operating procedures.]

Areas for Improvement:
- [Item 1 or "None"]
- [Item 2 or "None"]
`;

        const userContent = `Here is the conversation and metadata:

--- MESSAGES HISTORY (CHRONOLOGICAL) ---
${messages.map(m => `[${m.senderType.toUpperCase()}${m.isBot ? ' - BOT' : ''}] (${m.timestamp}): ${m.text}`).join('\n\n')}

--- SIDEBAR METADATA ---
${sidebarText}

--- GENERAL PAGE CONTENT ---
${bodyText}
`;

        // 5. Query Gemini API
        const response = await fetch(`${GEMINI_API_URL}/${model}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [{ text: systemPrompt + '\n\n' + userContent }]
              }
            ],
            generationConfig: {
              temperature: 0.1
            }
          })
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error?.message || `API error (Status: ${response.status})`);
        }

        const data = await response.json();
        const auditText = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!auditText) {
          throw new Error('Empty response from Gemini API.');
        }

        sendResponse({
          success: true,
          metrics: metrics,
          auditReport: auditText.trim()
        });

      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();

    return true; // Keep message channel open for async response
  }
});
