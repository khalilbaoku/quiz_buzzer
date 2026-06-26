// background.js — service worker for Quiz Buzzer Controller extension.
// Handles slideChanged events from content scripts and manual open/lock
// commands from the popup. Sends HTTP POST requests to the PartyKit server.

let pendingOpenTimer = null;

async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ["partyKitHost", "roomCode", "hostPin", "triggerWord", "delaySeconds"],
      resolve
    );
  });
}

async function sendCommand(commandType) {
  const { partyKitHost, roomCode, hostPin } = await getConfig();

  if (!partyKitHost || !roomCode || !hostPin) {
    chrome.storage.local.set({ buzzerStatus: "error: missing config" });
    return;
  }

  const isLocal = partyKitHost.startsWith("localhost") || partyKitHost.startsWith("127.0.0.1");
  const protocol = isLocal ? "http" : "https";
  const url = `${protocol}://${partyKitHost}/parties/main/${roomCode}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: commandType, pin: hostPin }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[QuizBuzzer] Server returned ${res.status}: ${text}`);
      chrome.storage.local.set({ buzzerStatus: `error: ${res.status}` });
      return;
    }

    const isOpen = commandType === "host:open-buzzer";
    chrome.storage.local.set({ buzzerStatus: isOpen ? "open" : "locked" });
  } catch (err) {
    console.error("[QuizBuzzer] fetch failed:", err);
    chrome.storage.local.set({ buzzerStatus: "error: network" });
  }
}

function cancelPendingTimer() {
  if (pendingOpenTimer !== null) {
    clearTimeout(pendingOpenTimer);
    pendingOpenTimer = null;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "openBuzzers") {
    cancelPendingTimer();
    sendCommand("host:open-buzzer");
    sendResponse({ ok: true });
  } else if (message.action === "lockBuzzers") {
    cancelPendingTimer();
    sendCommand("host:lock-buzzer");
    sendResponse({ ok: true });
  } else if (message.action === "slideChanged") {
    handleSlideChanged(message.title);
    sendResponse({ ok: true });
  }
  // Return true to keep the message channel open for async responses if needed
  return true;
});

async function handleSlideChanged(title) {
  const { triggerWord = "BUZZ:", delaySeconds = 3 } = await getConfig();

  cancelPendingTimer();

  const trimmedTitle = (title || "").trim();
  const isBuzzSlide = trimmedTitle.toLowerCase().startsWith(triggerWord.trim().toLowerCase());
  console.log(`[QuizBuzzer] slideChanged: "${trimmedTitle}" | trigger: "${triggerWord}" | isBuzz: ${isBuzzSlide}`);

  // Always update the last-seen title for the popup to display
  chrome.storage.local.set({ lastSlideTitle: trimmedTitle });

  if (isBuzzSlide) {
    const delayMs = Math.max(0, Number(delaySeconds) * 1000);
    pendingOpenTimer = setTimeout(() => {
      pendingOpenTimer = null;
      sendCommand("host:open-buzzer");
    }, delayMs);
  } else {
    sendCommand("host:lock-buzzer");
  }
}
