// canva.js — content script for Canva presentations.
//
// How to find the slide title selector if this breaks:
//   1. Open a Canva presentation, navigate to a slide with known text.
//   2. Open DevTools > Console and run:
//        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
//          acceptNode(n) {
//            const t = n.parentElement?.tagName.toLowerCase();
//            if (["script","style","noscript"].includes(t)) return NodeFilter.FILTER_REJECT;
//            return n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
//          }
//        });
//        let nd; while ((nd = walker.nextNode())) {
//          const p = nd.parentElement;
//          console.log(p.tagName, p.className.slice(0,60), "→", nd.textContent.trim().slice(0,60));
//        }
//   3. Find the line matching your slide's title text and use that tag+class below.
//
// "span.a_GcMg" confirmed working in Canva editor, June 2026.
// Canva obfuscates class names — re-run the snippet above if it breaks.

console.log("[QuizBuzzer] canva.js loaded");

const TITLE_SELECTORS = [
  "span.a_GcMg",
  '[data-testid="page-title-text"]',
  ".page.selected [class*='textElement'] p",
];

function readSlideTitle() {
  for (const sel of TITLE_SELECTORS) {
    const els = document.querySelectorAll(sel);
    if (!els.length) continue;

    // Multiple matches means the selector hits both the main canvas and the
    // left-panel thumbnails. Pick the element with the largest rendered area
    // — that's always the main canvas, not a thumbnail.
    let best = null;
    let bestArea = 0;
    for (const el of els) {
      const { width, height } = el.getBoundingClientRect();
      const area = width * height;
      if (area > bestArea && el.textContent.trim()) {
        bestArea = area;
        best = el;
      }
    }
    if (best) return best.textContent.trim();
  }
  return "";
}

let lastTitle = "";
let debounceTimer = null;

function handleChange() {
  // True debounce: reset the timer on every mutation so we only read the DOM
  // once Canva has finished rendering the new slide (mutations have stopped).
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const title = readSlideTitle();
    console.log("[QuizBuzzer] readSlideTitle →", JSON.stringify(title));
    if (title && title !== lastTitle) {
      lastTitle = title;
      chrome.runtime.sendMessage({ action: "slideChanged", title });
      console.log("[QuizBuzzer] sent slideChanged:", title);
    }
  }, 500);
}

// MutationObserver covers both hash-based and pushState-based navigation
const observer = new MutationObserver(handleChange);
observer.observe(document.body, { childList: true, subtree: true });

// Also listen for hash changes as a belt-and-braces backup
window.addEventListener("hashchange", handleChange);

// Fire once on load to catch the initial slide
setTimeout(handleChange, 1000);
