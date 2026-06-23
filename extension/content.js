// Captures selected text and stores it for the popup to read.
document.addEventListener("mouseup", () => {
  const selected = window.getSelection()?.toString().trim();
  if (selected && selected.length > 10) {
    chrome.storage.local.set({ mavis_selected_text: selected.slice(0, 4000) });
  }
});
