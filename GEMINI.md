# Intercom Chat Auditor - Project Guidance

This document outlines the architecture, standards, and conventions for the standalone Intercom Chat Auditor Extension.

## 🏗️ Architecture & Stack
- **Standard**: Manifest V3 (compatible with Firefox and Google Chrome).
- **Engine Type**: Hybrid (JavaScript + Generative AI).
- **Execution Pipeline**:
  1. `content.js` scans the Intercom DOM, scrolls the conversation pane, parses messages, and collects absolute UTC timestamps.
  2. `background.js` takes this structured message timeline and calculates analytical metrics: SLA times, response averages, dead-air gaps, and total handling time.
  3. `background.js` then queries the Gemini API with the full transcript and the official Standard Operating Procedure (SOP) checklist.
  4. `popup.js` displays the calculated badges (PASS/FAIL) and renders the detailed AI report card.

## 📝 Conventions & Style
- **Namespace Compatibility**: Use standard `chrome.*` APIs for runtime events and scripting. Maintain the dual-declaration structure in `manifest.json`.
- **Statelessness**: Background service workers must remain stateless. Local configurations must be fetched on-demand using `chrome.storage.local`.
- **Error Handling**: Gracefully handle incomplete chats (e.g., if there are no agent replies yet, or if the proctor has not sent an initial message). Avoid breaking the popup; display informative badges (e.g., "N/A" or "No Agent Response Yet").

## 🎯 Target Plaintext Scorecard Schema
The Gemini model is instructed to output the compliance evaluation using this strict format:
```text
AUDIT REPORT SCORECARD:

Protocol Compliance: [PASS / FAIL / NEEDS REVIEW]
Protocol Rating: [e.g., 90% or 100%]

Checklist:
- Professional Greeting: [Yes/No] (Explanation)
- SKU/ID Verification: [Yes/No] (Explanation)
- Correct Troubleshooting: [Yes/No] (Explanation)
- Safe Closure: [Yes/No] (Explanation)

SOP Compliance Review:
[2-3 sentence summary review]

Areas for Improvement:
- [Item 1 or "None"]
- [Item 2 or "None"]
```
