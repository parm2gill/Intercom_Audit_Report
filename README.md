# Intercom Chat Auditor Extension (Firefox & Google Chrome)

A standalone WebExtensions (Manifest V3) browser extension designed for Quality Assurance (QA) and Performance Tracking of support chats on `enterprise.app.intercom.com`.

The Auditor uses a **hybrid approach**:
1.  **Deterministic Analytics (JS Engine):** Programmatically scrolls the chat pane, parses absolute message timestamps, and computes exact SLA response times, average agent response delay, dead-air gaps (>3m), and total conversation handling times.
2.  **SOP Compliance Evaluation (Google Gemini):** Sends the chronological chat transcript and sidebar details securely to Gemini to rate the agent's adherence to Standard Operating Procedures (Greetings, SKU verification, troubleshooting, and safe closure).

---

## 📋 Features & Scorecard Metrics

-   **First Response SLA (FRT):** Tracks the precise duration from when the proctor completed their issue submission (the "Landing") to the agent's first human reply. Configurable limit (default: 60s).
-   **Average Response Time (ART):** The average duration of all subsequent agent replies during customer interactions.
-   **Dead Air Detection:** Flags any period during which the proctor was kept waiting without response for more than 3 minutes (180s).
-   **Total Handling Time (AHT):** Full duration from chat start to final closure.
-   **AI Compliance Checklist:**
    -   *Professional Greeting:* Polite greeting present.
    -   *SKU/ID Verification:* Verification of Session ID and SKU.
    -   *Correct Troubleshooting:* Mentions backend checks, server status, or cert-wiki sync steps.
    -   *Safe Closure:* Obtains proctor confirmation before ending the chat.
-   **Constructive Feedback:** Gemini provides precise, constructive areas of improvement.

---

## 🛠️ How to Install (For Development / Testing)

### For Google Chrome
1.  Open Chrome and navigate to `chrome://extensions/`.
2.  Enable **Developer mode** (toggle in the top-right corner).
3.  Click the **Load unpacked** button.
4.  Select the **`intercom-auditor`** folder.

### For Firefox
1.  Open Firefox and navigate to `about:debugging`.
2.  Click on **This Firefox** in the left menu.
3.  Click **Load Temporary Add-on...**.
4.  Select the **`manifest.json`** file inside the `intercom-auditor` folder.

---

## 🔑 How to Setup
1.  Open the extension popup in your browser toolbar.
2.  Click **⚙️ Settings** to open the options page.
3.  Paste your **Google Gemini API Key** (from [Google AI Studio](https://aistudio.google.com/)).
4.  Choose your model (Recommended: `gemini-3.5-flash`) and set your target SLA threshold.
5.  Click **Save Settings**.
