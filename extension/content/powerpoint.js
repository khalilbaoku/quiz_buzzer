// powerpoint.js — content script for PowerPoint Online (office.com).
//
// How to find the slide title selector if this breaks:
//   1. Open a PowerPoint presentation on office.com.
//   2. Open DevTools > Elements while viewing a slide.
//   3. The active slide's content is rendered inside a container such as
//      .SlideContainer or #PresenterView. Title shapes typically have
//      aria-label="Title" or class names containing "title". A reliable
//      candidate is [class*="slide-title"] or the first
//      [data-shape-type="title"] element. Adjust TITLE_SELECTORS below.
//
// PowerPoint Online does NOT change the URL hash on slide navigation, so we
// use a MutationObserver instead. We only send a message when the title
// actually changes to avoid flooding the background with repeated mutations
// during animations or redraws on the same slide.

const TITLE_SELECTORS = [
  // Editing area title shape
  '[data-shape-type="title"] .editor-content',
  '[aria-label="Title"] .editor-content',
  // Reading/present view
  '[class*="slide-title"]',
  // Generic fallback: first paragraph in the first text element
  '.SlideContainer .textBody p',
];

function readSlideTitle() {
  for (const sel of TITLE_SELECTORS) {
    const el = document.querySelector(sel);
    if (el && el.textContent.trim()) {
      return el.textContent.trim();
    }
  }
  return "";
}

let lastTitle = "";
let debounceTimer = null;

function handleMutation() {
  if (debounceTimer) return;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const title = readSlideTitle();
    if (title && title !== lastTitle) {
      lastTitle = title;
      chrome.runtime.sendMessage({ action: "slideChanged", title });
    }
  }, 400);
}

// Watch the entire document body for changes; PowerPoint Online heavily
// re-renders its slide area during navigation.
const observer = new MutationObserver(handleMutation);
observer.observe(document.body, { childList: true, subtree: true });

// Fire once on load
setTimeout(() => {
  const title = readSlideTitle();
  if (title) {
    lastTitle = title;
    chrome.runtime.sendMessage({ action: "slideChanged", title });
  }
}, 1000);
