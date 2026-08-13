import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App.tsx";
import "./index.css";
import { checkForUpdate, confirmBootSuccess } from "./lib/liveUpdate";

// Optional — degrades to a no-op when VITE_SENTRY_DSN isn't set. Set it in
// Supabase/Lovable env config to enable client-side crash reporting.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
  });
}

// Runs before render so an available update reloads the page once, up
// front, rather than rendering the old bundle and immediately reloading
// out from under it. No-ops on web; on native it either finds nothing new
// (returns immediately) or triggers reload() and this script re-runs fresh.
// Wrapped in an IIFE rather than top-level await — the build targets
// Safari 13 for web, which predates it.
void (async () => {
  await checkForUpdate();

  createRoot(document.getElementById("root")!).render(<App />);

  // Confirms the bundle that just rendered is good — must come after a
  // real render. If this is never reached (crash on startup), the
  // plugin's readyTimeout auto-rolls-back to the last known-good bundle
  // on next launch.
  void confirmBootSuccess();
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch(() => {/* non-fatal */});
  });
}
