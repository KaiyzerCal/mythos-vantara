// MAVIS Clipper - Background Service Worker
// Handles CLIP messages from popup and POSTs to the mavis-ingest-url edge function.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "CLIP") return;

  chrome.storage.local.get(["supabaseUrl", "accessToken"], async (settings) => {
    const { supabaseUrl, accessToken } = settings;

    if (!supabaseUrl || !accessToken) {
      sendResponse({ ok: false, error: "Not configured — open MAVIS Clipper settings" });
      return;
    }

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-ingest-url`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          url: message.url,
          note: message.note || undefined,
          // mavis-ingest-url will fetch the page title itself from the URL
        }),
      });

      const data = await res.json();
      sendResponse({ ok: res.ok, data });
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  });

  return true; // keep message channel open for async response
});
