import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

// Baseline product telemetry (Stabilization Brief Phase 1.4). Fire-and-forget
// by design — a logging failure must never block or surface as a user-facing
// error. Writes to mavis_events; RLS restricts each user to their own rows.
export function logEvent(eventName: string, metadata: Record<string, unknown> = {}): void {
  supabase.auth.getUser().then(({ data: { user } }) => {
    if (!user) return;
    return supabase.from("mavis_events").insert({
      event_name: eventName,
      user_id: user.id,
      metadata: metadata as Json,
    });
  }).catch(() => { /* non-critical — never let telemetry break the app */ });
}
