/**
 * Wearable and AR display adapters for MAVIS ambient overlay.
 * Supports: Meta Ray-Ban Glasses, Apple Vision Pro (visionOS 26), WebXR AR.
 * All adapters gracefully degrade when hardware/SDK unavailable.
 */

export type WearableDevice = "meta_ray_ban" | "vision_pro" | "webxr" | "none";

export interface OverlayContent {
  text: string;
  duration_ms?: number;
  type?: "ambient" | "notification" | "card";
  priority?: "low" | "normal" | "high";
}

export interface WearableStatus {
  device: WearableDevice;
  connected: boolean;
  battery?: number;
  overlayActive?: boolean;
}

// visionOS spatial anchor for persistent AR content
export interface SpatialAnchor {
  id: string;
  position: { x: number; y: number; z: number };
  content: OverlayContent;
  world_locked: boolean;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

async function getAuthToken(): Promise<string> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? "";
}

// ── Device detection ──────────────────────────────────────────────────────────

function detectAvailableDevice(): WearableDevice {
  if (typeof navigator === "undefined") return "none";

  // Meta Ray-Ban connection hint via Bluetooth API
  // Actual connection managed by Meta's companion app; we check API availability
  if ("bluetooth" in navigator) {
    // Ray-Ban Smart Glasses present as a Bluetooth peripheral.
    // Full pairing requires user gesture + companion app; we mark as potentially available.
    // Returning "webxr" here avoids false positives — callers can attempt meta_ray_ban explicitly.
  }

  // WebXR AR support (browser-based fallback)
  if ("xr" in navigator) {
    return "webxr";
  }

  return "none";
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function sendWearableOverlay(
  content: OverlayContent,
  device: WearableDevice = "none",
): Promise<{ success: boolean; device: WearableDevice; message?: string }> {
  let resolvedDevice = device;

  if (resolvedDevice === "none") {
    resolvedDevice = detectAvailableDevice();
  }

  if (resolvedDevice === "none") {
    return { success: false, device: "none", message: "No wearable device detected" };
  }

  try {
    const token = await getAuthToken();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-wearable-overlay`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        action:      "send_overlay",
        content:     content.text,
        duration_ms: content.duration_ms,
        overlay_type: content.type ?? "ambient",
        device_type: resolvedDevice,
      }),
    });
    const data = (await res.json()) as { message?: string };
    return { success: res.ok, device: resolvedDevice, message: data.message };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { success: false, device: resolvedDevice, message };
  }
}

export async function getWearableStatus(): Promise<WearableStatus> {
  const device = detectAvailableDevice();
  return { device, connected: device !== "none" };
}

export async function clearWearableOverlay(
  device: WearableDevice = "none",
): Promise<{ success: boolean; device: WearableDevice; message?: string }> {
  const resolvedDevice = device === "none" ? detectAvailableDevice() : device;

  if (resolvedDevice === "none") {
    return { success: false, device: "none", message: "No wearable device detected" };
  }

  try {
    const token = await getAuthToken();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-wearable-overlay`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action: "clear_overlay", device_type: resolvedDevice }),
    });
    const data = (await res.json()) as { message?: string };
    return { success: res.ok, device: resolvedDevice, message: data.message };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { success: false, device: resolvedDevice, message };
  }
}

export async function createSpatialAnchor(
  content: OverlayContent,
  position = { x: 0, y: 0, z: -0.5 },
): Promise<SpatialAnchor | null> {
  const id = crypto.randomUUID();
  // In visionOS, this would call the RealityKit anchor API.
  // For now, store anchor definition for when visionOS 26 SDK is available.
  return { id, position, content, world_locked: true };
}
