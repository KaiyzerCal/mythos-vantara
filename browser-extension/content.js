// MAVIS Clipper - Content Script
// Injected into all pages. Responds to GET_SELECTION messages from the popup.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_SELECTION") {
    sendResponse({ selectedText: window.getSelection()?.toString() ?? "" });
  }
});
