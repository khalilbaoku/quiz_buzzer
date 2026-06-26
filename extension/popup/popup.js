// popup.js — reads/writes chrome.storage.local and wires up the popup UI.

const FIELDS = ["partyKitHost", "roomCode", "hostPin", "triggerWord", "delaySeconds"];

function getEls() {
  return {
    partyKitHost: document.getElementById("partyKitHost"),
    roomCode: document.getElementById("roomCode"),
    hostPin: document.getElementById("hostPin"),
    triggerWord: document.getElementById("triggerWord"),
    delaySeconds: document.getElementById("delaySeconds"),
    saveBtn: document.getElementById("saveBtn"),
    saveFeedback: document.getElementById("save-feedback"),
    openBtn: document.getElementById("openBtn"),
    lockBtn: document.getElementById("lockBtn"),
    buzzerStatusBadge: document.getElementById("buzzerStatusBadge"),
    lastSlideTitleEl: document.getElementById("lastSlideTitleEl"),
  };
}

function renderStatus(els, buzzerStatus, lastSlideTitle) {
  const badge = els.buzzerStatusBadge;
  const raw = (buzzerStatus || "unknown").toLowerCase();

  badge.className = "badge";
  if (raw === "open") {
    badge.classList.add("badge-open");
    badge.textContent = "Open";
  } else if (raw === "locked") {
    badge.classList.add("badge-locked");
    badge.textContent = "Locked";
  } else if (raw.startsWith("error")) {
    badge.classList.add("badge-error");
    badge.textContent = raw;
  } else {
    badge.classList.add("badge-unknown");
    badge.textContent = raw;
  }

  els.lastSlideTitleEl.textContent = lastSlideTitle || "—";
  els.lastSlideTitleEl.title = lastSlideTitle || "";
}

function init() {
  const els = getEls();

  // Populate fields and status from storage
  const keysToRead = [...FIELDS, "buzzerStatus", "lastSlideTitle"];
  chrome.storage.local.get(keysToRead, (data) => {
    els.partyKitHost.value = data.partyKitHost || "";
    els.roomCode.value = (data.roomCode || "").toUpperCase();
    els.hostPin.value = data.hostPin || "";
    els.triggerWord.value = data.triggerWord || "BUZZ:";
    els.delaySeconds.value = data.delaySeconds !== undefined ? data.delaySeconds : 3;

    renderStatus(els, data.buzzerStatus, data.lastSlideTitle);
  });

  // Keep status area live while popup is open
  chrome.storage.onChanged.addListener((changes) => {
    const buzzerStatus =
      "buzzerStatus" in changes ? changes.buzzerStatus.newValue : undefined;
    const lastSlideTitle =
      "lastSlideTitle" in changes ? changes.lastSlideTitle.newValue : undefined;

    if (buzzerStatus !== undefined || lastSlideTitle !== undefined) {
      chrome.storage.local.get(["buzzerStatus", "lastSlideTitle"], (data) => {
        renderStatus(els, data.buzzerStatus, data.lastSlideTitle);
      });
    }
  });

  // Auto-uppercase room code while typing
  els.roomCode.addEventListener("input", () => {
    const pos = els.roomCode.selectionStart;
    els.roomCode.value = els.roomCode.value.toUpperCase();
    els.roomCode.setSelectionRange(pos, pos);
  });

  // Save button
  els.saveBtn.addEventListener("click", () => {
    const data = {
      partyKitHost: els.partyKitHost.value.trim().replace(/^https?:\/\//, ""),
      roomCode: els.roomCode.value.trim().toUpperCase(),
      hostPin: els.hostPin.value.trim(),
      triggerWord: els.triggerWord.value.trim() || "BUZZ:",
      delaySeconds: Math.max(0, Number(els.delaySeconds.value) || 3),
    };
    chrome.storage.local.set(data, () => {
      els.saveFeedback.textContent = "Saved!";
      setTimeout(() => { els.saveFeedback.textContent = ""; }, 1500);
    });
  });

  // Manual open/lock — sent to background.js to cancel any pending timer first
  els.openBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "openBuzzers" });
  });

  els.lockBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "lockBuzzers" });
  });
}

document.addEventListener("DOMContentLoaded", init);
