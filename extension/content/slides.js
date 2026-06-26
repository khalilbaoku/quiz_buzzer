// slides.js — content script for Google Slides presentations.
//
// How to find the slide title selector if this breaks:
//   1. Open a Google Slides presentation in present/edit mode.
//   2. Open DevTools > Elements and inspect the active slide title text.
//   3. In edit mode, slide content lives inside .punch-viewer-content; title
//      text elements typically have the aria-label "title" or sit inside a
//      container with data-placeholder-type="TITLE". A reliable approach:
//      find the element with [aria-label="title"] within the presentation area,
//      or the first [data-placeholder-type="TITLE"] element. In present mode,
//      look for .punch-present-slide-view .punch-viewer-slide-object-holder.
//
// Google Slides updates the URL hash on every slide navigation (#slide=id.pN).

const TITLE_SELECTORS = [
  // Edit mode: title placeholder
  '[data-placeholder-type="TITLE"] .sketchy-text-content-text',
  '[data-placeholder-type="TITLE"] .punch-viewer-text-word',
  // Present mode
  '.punch-present-slide-view [aria-label="title"]',
  // Fallback
  '.punch-viewer-content [aria-label="title"]',
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

function notifySlideChange() {
  const title = readSlideTitle();
  if (title) {
    chrome.runtime.sendMessage({ action: "slideChanged", title });
  }
}

window.addEventListener("hashchange", () => {
  // Wait 400 ms for Google Slides to finish rendering the new slide.
  setTimeout(notifySlideChange, 400);
});

setTimeout(notifySlideChange, 800);
