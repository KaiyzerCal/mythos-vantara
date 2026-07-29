import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { supabase } from "@/integrations/supabase/client";

// Native push notification registration (Stabilization Brief Phase 2.9).
// mavis-push-notify (the send side) already reads active tokens from
// device_push_tokens and sends via FCM/APNS — that backend has existed with
// no client ever populating the table, so proactive nudges could only ever
// reach the operator via Telegram. This is the missing client half.
//
// Deliberately NOT called on app launch — call requestPushRegistration()
// from an explicit, intent-showing surface (this app wires it into
// NotificationsPage) so the OS permission prompt has context instead of
// firing cold on first open.

export type PushRegistrationResult =
  | { status: "unsupported" }        // web build — no native push
  | { status: "denied" }             // operator declined the OS prompt
  | { status: "error"; message: string }
  | { status: "registered" };

let listenersAttached = false;

async function upsertToken(userId: string, token: string): Promise<void> {
  const platform = Capacitor.getPlatform(); // "ios" | "android" | "web"
  await (supabase as any).from("device_push_tokens").upsert(
    {
      user_id: userId,
      token,
      platform,
      device_name: navigator.userAgent.slice(0, 200),
      active: true,
      last_used_at: new Date().toISOString(),
    },
    { onConflict: "user_id,token" },
  );
}

/** True if the current build can register for native push at all. */
export function canRegisterForPush(): boolean {
  return Capacitor.isNativePlatform();
}

/** Has the OS already granted (or previously denied) the permission? */
export async function getPushPermissionState(): Promise<"granted" | "denied" | "prompt" | "unsupported"> {
  if (!Capacitor.isNativePlatform()) return "unsupported";
  const status = await PushNotifications.checkPermissions();
  if (status.receive === "granted") return "granted";
  if (status.receive === "denied") return "denied";
  return "prompt";
}

/**
 * Requests OS permission (if not already decided) and, on grant, registers
 * for push and persists the resulting token to device_push_tokens. Call this
 * from a user-initiated action (a button in NotificationsPage settings), not
 * automatically on launch.
 */
export async function requestPushRegistration(userId: string): Promise<PushRegistrationResult> {
  if (!Capacitor.isNativePlatform()) return { status: "unsupported" };

  try {
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== "granted") return { status: "denied" };

    if (!listenersAttached) {
      listenersAttached = true;
      PushNotifications.addListener("registration", (token) => {
        upsertToken(userId, token.value).catch((e) => console.error("[push] token upsert failed:", e));
      });
      PushNotifications.addListener("registrationError", (err) => {
        console.error("[push] registration error:", err);
      });
      // Notification interaction handling is intentionally out of scope here
      // (deep-linking on tap) — this phase only wires up token registration.
    }

    await PushNotifications.register();
    return { status: "registered" };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
