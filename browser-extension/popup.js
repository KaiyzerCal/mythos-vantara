// MAVIS Clipper - Popup Script

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Get current tab URL + title
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const urlDisplay = document.getElementById("url-display");
  const rawUrl = tab.url ?? "";
  urlDisplay.textContent = rawUrl.length > 60
    ? rawUrl.slice(0, 60) + "…"
    : rawUrl || "(no URL)";

  // 2. Try to get selected text from content script
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_SELECTION" });
    if (response?.selectedText) {
      const preview = document.getElementById("selection-preview");
      preview.textContent = response.selectedText.slice(0, 200);
      preview.style.display = "-webkit-box";
    }
  } catch {
    // No content script on this tab (e.g. chrome:// pages) — silently ignore
  }

  // 3. Clip button
  document.getElementById("clip-btn").addEventListener("click", async () => {
    const note = document.getElementById("note-input").value.trim();
    const btn = document.getElementById("clip-btn");
    const status = document.getElementById("status");

    btn.disabled = true;
    btn.textContent = "Clipping…";
    status.textContent = "";
    status.style.color = "";

    // Re-fetch selection at clip time so we capture the latest highlight
    let selectedText = "";
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: "GET_SELECTION" });
      selectedText = res?.selectedText ?? "";
    } catch {
      // ignore — tab may not have content script
    }

    const urlToClip = tab.url;
    const fullNote = [
      note,
      selectedText ? `\n\nSelected: ${selectedText}` : "",
    ].join("").trim();

    chrome.runtime.sendMessage(
      { type: "CLIP", url: urlToClip, note: fullNote || undefined },
      (response) => {
        if (chrome.runtime.lastError) {
          status.style.color = "#f87171";
          status.textContent = chrome.runtime.lastError.message ?? "Extension error";
          btn.disabled = false;
          btn.textContent = "CLIP TO VAULT";
          return;
        }

        if (response?.ok) {
          status.style.color = "#4ade80";
          status.textContent = "✓ Saved to Vault";
          btn.textContent = "Clipped!";
        } else {
          status.style.color = "#f87171";
          status.textContent = response?.error ?? "Failed to clip";
          btn.disabled = false;
          btn.textContent = "CLIP TO VAULT";
        }
      }
    );
  });

  // 4. Settings link
  document.getElementById("settings-link").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
});
