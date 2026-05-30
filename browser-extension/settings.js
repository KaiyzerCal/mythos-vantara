document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get(["supabaseUrl", "accessToken"], (data) => {
    if (data.supabaseUrl) document.getElementById("supabase-url").value = data.supabaseUrl;
    if (data.accessToken) document.getElementById("access-token").value = data.accessToken;
  });

  document.getElementById("save-btn").addEventListener("click", () => {
    const supabaseUrl = document.getElementById("supabase-url").value.trim().replace(/\/$/, "");
    const accessToken = document.getElementById("access-token").value.trim();
    if (!supabaseUrl || !accessToken) {
      const status = document.getElementById("status");
      status.style.color = "#f87171";
      status.textContent = "Both fields are required.";
      return;
    }
    chrome.storage.local.set({ supabaseUrl, accessToken }, () => {
      const status = document.getElementById("status");
      status.style.color = "#4ade80";
      status.textContent = "✓ Saved";
      setTimeout(() => { status.textContent = ""; }, 2000);
    });
  });
});
