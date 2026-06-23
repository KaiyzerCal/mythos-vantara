const SB_URL_KEY = "mavis_sb_url";
const SB_KEY_KEY = "mavis_sb_key";
const SB_TOKEN_KEY = "mavis_token";

function showToast(msg, type = "success") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast ${type}`;
  setTimeout(() => { el.className = "toast"; }, 3000);
}

async function getStorage(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

async function setStorage(data) {
  return new Promise(resolve => chrome.storage.local.set(data, resolve));
}

async function init() {
  const stored = await getStorage([SB_URL_KEY, SB_KEY_KEY, SB_TOKEN_KEY]);
  const sbUrl = stored[SB_URL_KEY];
  const sbKey = stored[SB_KEY_KEY];
  const token = stored[SB_TOKEN_KEY];

  if (!sbUrl || !sbKey) {
    document.getElementById("authView").style.display = "block";
    return;
  }

  document.getElementById("mainView").style.display = "block";
  document.getElementById("statusDot").classList.add("connected");

  // Get current tab URL and selected text
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  document.getElementById("pageUrl").textContent = tab?.url ?? "—";

  // Retrieve selected text injected by content script
  const result = await getStorage(["mavis_selected_text"]);
  if (result.mavis_selected_text) {
    document.getElementById("captureText").value = result.mavis_selected_text;
    chrome.storage.local.remove("mavis_selected_text");
  }

  document.getElementById("saveBtn").addEventListener("click", () => save(sbUrl, sbKey, token, tab));
  document.getElementById("capturePageBtn").addEventListener("click", () => capturePage(tab));
}

async function capturePage(tab) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => document.body.innerText.slice(0, 8000),
  });
  document.getElementById("captureText").value = result?.result ?? "";
}

async function save(sbUrl, sbKey, token, tab) {
  const text = document.getElementById("captureText").value.trim();
  const type = document.getElementById("captureType").value;
  const url = tab?.url ?? "";
  const title = tab?.title ?? "Captured from web";

  if (!text) { showToast("Nothing to save", "error"); return; }

  const btn = document.getElementById("saveBtn");
  btn.disabled = true;
  btn.textContent = "Saving…";

  try {
    const stored = await getStorage([SB_TOKEN_KEY]);
    const authToken = stored[SB_TOKEN_KEY] ?? "";

    if (type === "memory" || type === "research") {
      const content = type === "research"
        ? `[WEB RESEARCH] ${title}\nSource: ${url}\n\n${text}`
        : `[WEB CAPTURE] ${title}\nSource: ${url}\n\n${text}`;

      const res = await fetch(`${sbUrl}/rest/v1/mavis_memory`, {
        method: "POST",
        headers: {
          "apikey": sbKey,
          "Authorization": `Bearer ${authToken}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal",
        },
        body: JSON.stringify({
          role: "user",
          content,
          importance_score: type === "research" ? 7 : 5,
          tags: ["web_capture", new URL(url).hostname],
        }),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      showToast("Saved to MAVIS memory");

    } else if (type === "vault") {
      const res = await fetch(`${sbUrl}/rest/v1/vault_entries`, {
        method: "POST",
        headers: {
          "apikey": sbKey,
          "Authorization": `Bearer ${authToken}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal",
        },
        body: JSON.stringify({
          title,
          content: `Source: ${url}\n\n${text}`,
          category: "personal",
          importance: "medium",
        }),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      showToast("Saved to Vault");

    } else if (type === "ask") {
      // Open MAVIS with the text pre-filled
      const mavisUrl = sbUrl.replace("supabase.co", "vantara.app") ?? "https://app.mythosai.co";
      const q = encodeURIComponent(`Analyze this: ${text.slice(0, 500)}`);
      chrome.tabs.create({ url: `${mavisUrl}/mavis?q=${q}` });
      showToast("Opening MAVIS…");
    }

    document.getElementById("captureText").value = "";
  } catch (e) {
    showToast(e.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Save to MAVIS";
  }
}

// Auth flow
document.addEventListener("DOMContentLoaded", () => {
  init();

  const saveAuthBtn = document.getElementById("saveAuthBtn");
  if (saveAuthBtn) {
    saveAuthBtn.addEventListener("click", async () => {
      const url = document.getElementById("sbUrl").value.trim().replace(/\/$/, "");
      const key = document.getElementById("sbKey").value.trim();
      if (!url || !key) return;
      await setStorage({ [SB_URL_KEY]: url, [SB_KEY_KEY]: key });
      location.reload();
    });
  }
});
