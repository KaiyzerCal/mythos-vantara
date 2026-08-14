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

// Render immediately — never block first paint on a network call. The OTA
// check used to be awaited before this render, which meant every launch
// paid for a manifest fetch (and, whenever a new bundle existed, a full
// download) before the user saw anything but a blank screen. Now it runs
// in the background after render; if it finds an update it reloads the
// page once that update is ready, which is a much better trade than
// stalling every single launch on it.
createRoot(document.getElementById("root")!).render(<App />);

// Confirms the bundle that just rendered is good — must come after a real
// render. If this is never reached (crash on startup), the plugin's
// readyTimeout auto-rolls-back to the last known-good bundle on next launch.
void confirmBootSuccess();

void checkForUpdate();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch(() => {/* non-fatal */});
  });
}
