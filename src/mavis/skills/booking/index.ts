// SKILL: booking
// Books appointments, reservations, and services via mavis-booking.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "booking", output: "Book an appointment or reservation. Example: 'book a dentist appointment for Tuesday afternoon' or 'make a reservation at a steakhouse for 2 people Friday 7pm'" };
  }
  const service = input.replace(/^(book|make|schedule|reserve)\s+(a\s+)?(an?\s+)?/i, "").trim();
  try {
    const { data, error } = await supabase.functions.invoke("mavis-booking", {
      body: { request: service, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.booking ?? data?.confirmation ?? data?.result ?? data?.output;
    return {
      skillName: "booking",
      output: result
        ? `📋 **Booking:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}`
        : JSON.stringify(data),
    };
  } catch (err) {
    return { skillName: "booking", output: `Booking error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "booking",
  description: "Books appointments, restaurant reservations, and service bookings",
  keywords: [
    "book an appointment", "make a reservation", "book a table",
    "reserve a spot", "schedule appointment", "book a hotel",
    "restaurant reservation", "booking", "reserve for",
  ],
}, handler);
