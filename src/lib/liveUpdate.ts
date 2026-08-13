// Self-hosted OTA updates via @capawesome/capacitor-live-update — no
// Capgo/Appflow account, no subscription. Bundles are plain zips of `dist/`
// hosted in the 'ota-bundles' Supabase Storage bucket (public read), pushed
// by .github/workflows/android-build.yml on every release. Native-only:
// there's nothing to "update" in a browser tab, it just serves the latest
// deploy already.
import { Capacitor } from "@capacitor/core";
import { LiveUpdate } from "@capawesome/capacitor-live-update";

const MANIFEST_URL = "https://wlygujlvsfimhtqsdxrx.supabase.co/storage/v1/object/public/ota-bundles/manifest.json";

interface OtaManifest {
  version: string;
  url: string;
  checksum: string; // SHA-256 hex, computed by CI at upload time
}

/**
 * Checks for a newer bundle and applies it. Safe to call unconditionally at
 * startup — no-ops immediately on web. Failures (offline, bad manifest,
 * flaky download) are swallowed: the app just keeps running on whatever
 * bundle is already installed rather than blocking startup on a network call.
 */
export async function checkForUpdate(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const res = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!res.ok) return;
    const manifest = (await res.json()) as OtaManifest;
    if (!manifest?.version || !manifest?.url || !manifest?.checksum) return;

    const current = await LiveUpdate.getCurrentBundle();
    if (current.bundleId === manifest.version) return;

    await LiveUpdate.downloadBundle({ url: manifest.url, bundleId: manifest.version, checksum: manifest.checksum });
    await LiveUpdate.setNextBundle({ bundleId: manifest.version });
    await LiveUpdate.reload();
  } catch {
    // Offline, malformed manifest, download failure, etc. — not fatal,
    // the app continues on its current bundle.
  }
}

/**
 * Confirms the app booted successfully on whatever bundle is currently
 * active. Must be called after a real render, not before — if this never
 * fires (crash on startup), readyTimeout expires and the plugin
 * auto-rolls-back to the last known-good bundle on next launch.
 */
export async function confirmBootSuccess(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const result = await LiveUpdate.ready();
    if (result.rollback) {
      console.warn("[liveUpdate] Previous bundle failed to boot — rolled back to", result.currentBundleId);
    }
  } catch {
    // Nothing to do if this fails — worst case is the timeout rolls back
    // on its own.
  }
}
