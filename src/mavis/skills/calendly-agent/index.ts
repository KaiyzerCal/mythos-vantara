// SKILL: calendly-agent
// Creates booking links, checks availability, and manages Calendly via mavis-calendly-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "calendly-agent", output: "Manage your Calendly. Example: 'create a 30-minute meeting link' or 'show my upcoming Calendly bookings'" };
  }
  const action = /upcoming|bookings|scheduled|who booked/i.test(input) ? "list_events"
    : /create|new link|booking link|schedule link/i.test(input) ? "create_event_type"
    : "list_events";
  const durationMatch = input.match(/(\d+)[\s-]?min(?:ute)?/i);
  try {
    const { data, error } = await supabase.functions.invoke("mavis-calendly-agent", {
      body: { action, duration_minutes: durationMatch ? parseInt(durationMatch[1]) : 30, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.events ?? data?.link ?? data?.booking_url ?? data?.result ?? data?.output;
    return {
      skillName: "calendly-agent",
      output: result
        ? (typeof result === "string" && result.startsWith("http")
            ? `📅 **Booking Link:** ${result}`
            : `📅 **Calendly:** ${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 2000)}`)
        : JSON.stringify(data),
    };
  } catch (err) {
    return { skillName: "calendly-agent", output: `Calendly error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "calendly-agent",
  description: "Manages Calendly — creates booking links and shows upcoming scheduled meetings",
  keywords: [
    "calendly", "booking link", "create meeting link", "calendly link",
    "schedule a meeting", "book time with me", "send a booking link",
    "calendly bookings", "upcoming bookings", "meeting link",
  ],
}, handler);
