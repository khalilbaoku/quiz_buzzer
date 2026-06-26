# Quiz Buzzer Controller — Chrome Extension

Automatically opens and locks buzzers in your [Quiz Buzzer](https://github.com) app based on what slide is currently showing in Canva, Google Slides, or PowerPoint Online. No manual clicking during the quiz.

---

## How it works

```
Canva slide navigated to
        │
        ▼
canva.js (content script)
Watches the DOM with a MutationObserver.
When mutations settle, reads the visible slide title.
Picks the largest matching element to avoid reading
from the left-panel thumbnails instead of the main canvas.
        │
        ▼
background.js (service worker)
Receives { action: "slideChanged", title: "..." }.
Checks: does the title START with your trigger word?
  YES → wait the configured delay, then POST host:open-buzzer
  NO  → POST host:lock-buzzer immediately
        │
        ▼
PartyKit server (HTTP endpoint)
Validates the host PIN, runs the open/lock logic,
broadcasts the new state to all connected player devices.
```

The extension talks to the PartyKit server over a plain HTTP POST — no WebSocket needed. Authentication uses the same 6-digit host PIN that the host browser uses, stored in `chrome.storage.local`.

---

## Installation

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle, top right)
3. Click **Load unpacked** and select the `extension/` folder
4. The Quiz Buzzer icon appears in the Chrome toolbar

---

## Setup

Click the extension icon and fill in all five fields, then click **Save**.

| Field | What to enter | Example |
|---|---|---|
| PartyKit host | Your deployed PartyKit domain — no `https://` | `buzzer.khalil.partykit.dev` |
| Room code | The 4-character room code shown on the host page | `LQG5` |
| Host PIN | The 6-digit PIN from the host page URL hash (`#153644`) | `153644` |
| Trigger word | Text that must appear at the **start** of a slide title to open buzzers | `BUZZ:` |
| Delay (s) | Seconds to wait after landing on a buzz slide before opening | `3` |

> **Local development:** use `localhost:1999` as the PartyKit host. The extension automatically uses `http://` for localhost and `https://` for everything else.

### Finding your PIN

The PIN is embedded in the host page URL after the `#`:

```
https://your-app.vercel.app/host/LQG5#153644
                                        ^^^^^^ this is the PIN
```

The PIN persists across page refreshes and server restarts as long as the same room code is used.

---

## Preparing your slides

Every slide that should open the buzzers must have a title that **starts with** your trigger word.

If your trigger word is `BUZZ:`, name your question slides like this:

```
BUZZ: What does VPN stand for?
BUZZ: Which country hosted the 1966 World Cup?
BUZZ: Name the capital of New Zealand.
```

Slides that do not start with the trigger word will **lock** the buzzers when navigated to — use these for intro slides, score updates, answer reveals, etc.

---

## Manual override

The popup has **Open Buzzers** and **Lock Buzzers** buttons for overriding at any time. These cancel any pending auto-open timer and send the command immediately.

---

## Status display

The popup shows two live status indicators:

- **Buzzers badge** — `Open` (green), `Locked` (red), or an error message
- **Last slide** — the most recent slide title the content script detected

---

## Testing locally

Start the dev server:

```bash
npm run party:dev
```

Verify the HTTP endpoint is working before testing the extension:

```bash
curl -X POST http://localhost:1999/parties/main/ROOMCODE \
  -H "Content-Type: application/json" \
  -d '{"type":"host:open-buzzer","pin":"YOUR_PIN"}'
# Expected: {"ok":true,"phase":"open"}
```

After any change to an extension file:
1. Go to `chrome://extensions` → click the **reload icon** on Quiz Buzzer Controller
2. **Refresh the Canva/Slides/PowerPoint tab** — content scripts do not re-inject into already-open tabs automatically

---

## Troubleshooting

### Buzzers don't open when navigating to a slide

Work through these checks in order:

**1. Verify the server responds**
```bash
curl -X POST https://YOUR_HOST/parties/main/ROOMCODE \
  -H "Content-Type: application/json" \
  -d '{"type":"host:open-buzzer","pin":"YOUR_PIN"}'
```
If this returns `401`, the PIN is wrong. If it times out, the server is down.

**2. Check the popup config**
Open the extension popup and confirm all five fields are filled. Click Save again to be sure.

**3. Check the service worker console**
`chrome://extensions` → find Quiz Buzzer Controller → click **Service worker**

You should see a line like:
```
[QuizBuzzer] slideChanged: "BUZZ: your question" | trigger: "BUZZ:" | isBuzz: true
```

- `isBuzz: false` → the slide title does not start with your trigger word. Check capitalisation and spacing — the comparison is case-insensitive but the trigger word must match the start of the title exactly (no leading spaces).
- No output at all → the content script is not sending messages. Refresh the presentation tab and check step 4.

**4. Check the Canva tab console**
Open DevTools on the Canva tab (F12) and filter by `QuizBuzzer`.

- If you see `[QuizBuzzer] canva.js loaded` but no `readSlideTitle` lines → the MutationObserver is not firing. This is unusual; try refreshing the tab.
- If you see nothing at all → the content script is not injecting. Check `chrome://extensions` for errors on the extension, and confirm the Canva URL matches `https://www.canva.com/*`.

**5. Check for fetch errors**
In the service worker console, look for `[QuizBuzzer] Server returned 4xx` or `fetch failed` lines. These point to network or auth issues.

---

### The Canva selector breaks after a Canva update

Canva uses obfuscated CSS class names (e.g. `span.a_GcMg`) that change with deployments. When the selector stops working, the `readSlideTitle →` log will show an empty string.

**To find the new selector:**

1. Open your Canva presentation and navigate to a slide with known text
2. Open DevTools > Console on the Canva tab
3. Paste and run this snippet:

```js
const walker = document.createTreeWalker(
  document.body,
  NodeFilter.SHOW_TEXT,
  {
    acceptNode(node) {
      const tag = node.parentElement?.tagName.toLowerCase();
      if (["script", "style", "noscript"].includes(tag)) return NodeFilter.FILTER_REJECT;
      return node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  }
);
let nd;
while ((nd = walker.nextNode())) {
  const p = nd.parentElement;
  if (nd.textContent.includes("YOUR SLIDE TEXT HERE")) {
    console.log("FOUND:", p.tagName, p.className, "→", nd.textContent.trim());
  }
}
```

Replace `YOUR SLIDE TEXT HERE` with a word from your slide title.

4. Copy the class name from the `FOUND:` output (e.g. `a_GcMg`)
5. Open `extension/content/canva.js` and update the first entry in `TITLE_SELECTORS`:

```js
const TITLE_SELECTORS = [
  "span.NEW_CLASS_NAME",   // ← replace this
  ...
];
```

6. Reload the extension and refresh the Canva tab

---

## File reference

```
extension/
├── manifest.json       Chrome Extension Manifest V3 config
├── background.js       Service worker — handles messages, sends HTTP to PartyKit
├── popup/
│   ├── popup.html      Extension popup UI
│   └── popup.js        Reads/writes chrome.storage.local, wires up buttons
└── content/
    ├── canva.js        Watches Canva DOM, detects slide changes
    ├── slides.js       Watches Google Slides DOM (hash-based navigation)
    └── powerpoint.js   Watches PowerPoint Online DOM (MutationObserver)
```
