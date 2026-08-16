import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { isServiceRoleCaller, resolveOperatorUid } from "../_shared/auth.ts";
import { callWithFallback } from "../_shared/providers.ts";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

type RelationshipType =
  | "close_friend"
  | "family"
  | "mentor"
  | "investor"
  | "client"
  | "colleague"
  | "collaborator"
  | string;

function defaultCadence(relationshipType: RelationshipType): number {
  switch (relationshipType) {
    case "close_friend":
    case "family":
      return 7;
    case "mentor":
    case "investor":
    case "client":
      return 14;
    case "colleague":
    case "collaborator":
      return 21;
    default:
      return 30;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!isServiceRoleCaller(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const uid = resolveOperatorUid(req)!;
    const now = new Date();
    const nowMs = now.getTime();

    // Query all contacts
    const { data: contacts, error: contactsError } = await supabase
      .from("contacts")
      .select("id, name, relationship_type, last_contact_at, notes, follow_up_days, birthday, created_at")
      .eq("user_id", uid);

    if (contactsError) {
      throw new Error("Failed to fetch contacts: " + contactsError.message);
    }

    const allContacts = contacts ?? [];

    // Find overdue contacts
    interface OverdueContact {
      name: string;
      relationshipType: string;
      daysSince: number;
      notes: string;
    }

    const overdueContacts: OverdueContact[] = [];

    for (const contact of allContacts) {
      const cadenceDays: number =
        contact.follow_up_days != null
          ? contact.follow_up_days
          : defaultCadence(contact.relationship_type ?? "");

      const cadenceMs = cadenceDays * 24 * 60 * 60 * 1000;

      if (contact.last_contact_at) {
        const lastMs = new Date(contact.last_contact_at).getTime();
        const daysSince = Math.floor((nowMs - lastMs) / (24 * 60 * 60 * 1000));
        if (nowMs - lastMs > cadenceMs) {
          overdueContacts.push({
            name: contact.name,
            relationshipType: contact.relationship_type ?? "unknown",
            daysSince,
            notes: contact.notes ?? "",
          });
        }
      } else if (contact.created_at) {
        // Never contacted — check if created > 30 days ago
        const createdMs = new Date(contact.created_at).getTime();
        const daysSinceCreated = Math.floor((nowMs - createdMs) / (24 * 60 * 60 * 1000));
        if (daysSinceCreated > 30) {
          overdueContacts.push({
            name: contact.name,
            relationshipType: contact.relationship_type ?? "unknown",
            daysSince: daysSinceCreated,
            notes: contact.notes ?? "",
          });
        }
      }
    }

    // Find upcoming birthdays (within next 7 days)
    interface BirthdayContact {
      name: string;
      daysUntil: number;
    }

    const upcomingBirthdays: BirthdayContact[] = [];
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    for (const contact of allContacts) {
      if (!contact.birthday) continue;

      // Parse birthday, set to current year for comparison
      const bday = new Date(contact.birthday);
      const thisYearBday = new Date(
        now.getFullYear(),
        bday.getMonth(),
        bday.getDate()
      );

      // If already passed this year, check next year
      if (thisYearBday.getTime() < nowMs) {
        thisYearBday.setFullYear(now.getFullYear() + 1);
      }

      const msUntil = thisYearBday.getTime() - nowMs;
      if (msUntil >= 0 && msUntil <= sevenDaysMs) {
        upcomingBirthdays.push({
          name: contact.name,
          daysUntil: Math.floor(msUntil / (24 * 60 * 60 * 1000)),
        });
      }
    }

    // Nothing to nudge
    if (overdueContacts.length === 0 && upcomingBirthdays.length === 0) {
      return new Response(JSON.stringify({ nudged: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build context for Claude
    const contextLines: string[] = [];

    if (overdueContacts.length > 0) {
      contextLines.push("Overdue contacts:");
      // Sort by most overdue first
      overdueContacts.sort((a, b) => b.daysSince - a.daysSince);
      overdueContacts.forEach((c) => {
        contextLines.push(
          `  - ${c.name} (${c.relationshipType}): ${c.daysSince} days since last contact${c.notes ? " | Notes: " + c.notes.slice(0, 80) : ""}`
        );
      });
      contextLines.push("");
    }

    if (upcomingBirthdays.length > 0) {
      contextLines.push("Upcoming birthdays (within 7 days):");
      upcomingBirthdays.forEach((b) => {
        contextLines.push(
          `  - ${b.name}: ${b.daysUntil === 0 ? "TODAY" : "in " + b.daysUntil + " day(s)"}`
        );
      });
    }

    const contextStr = contextLines.join("\n");

    // Call the free-first provider cascade
    const providerKeys = {
      openai: Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "",
      claude: Deno.env.get("ANTHROPIC_API_KEY") ?? "",
      grok:   Deno.env.get("GROK_API_KEY") ?? Deno.env.get("XAI_API_KEY") ?? "",
      gemini: Deno.env.get("GEMINI_API_KEY") ?? "",
      groq:   Deno.env.get("GROQ_API_KEY") ?? "",
    };
    let nudgeText = "Check your contacts.";
    try {
      const text = (await callWithFallback(
        "claude",
        [{ role: "user", content: contextStr }],
        "You are MAVIS. Generate a concise relationship nudge (max 5 bullet lines). List who needs attention and why. Reference their relationship type. Suggest one opening message idea for the most overdue person.",
        providerKeys,
      )).content;
      if (text) nudgeText = text;
    } catch { /* keep default nudgeText */ }

    // Send Telegram notification
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
    const chatId = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID")!;
    const telegramMsg = `MAVIS CRM NUDGE 🤝\n─────\n${nudgeText}`;

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: telegramMsg }),
    });

    return new Response(
      JSON.stringify({
        nudged: true,
        overdue: overdueContacts.length,
        birthdays: upcomingBirthdays.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("mavis-crm-nudge error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
