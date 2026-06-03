// Service worker — handles context menu for right-click capture.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "mavis-capture",
    title: "Send to MAVIS",
    contexts: ["selection", "page"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const text = info.selectionText ?? "";
  if (text) {
    chrome.storage.local.set({ mavis_selected_text: text.slice(0, 4000) });
  }
  chrome.action.openPopup();
});
