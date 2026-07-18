// mavis-contact-enrich
// Enriches contacts with LinkedIn/X data via Apify actors.
// Can be called for a specific contact (POST { contactId }) or in batch mode
// (POST {} — processes up to 10 contacts that haven't been enriched in 7 days).
// Stores results in contacts.enrichment JSONB and updates last_enriched_at.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const OPERATOR_USER_ID = Deno.env.get("TELEGRAM_OPERATOR_USER_ID")!;
const APIFY_API_KEY    = Deno.env.get("APIFY_API_KEY") ?? "";
const BOT_TOKEN        = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const CHAT_ID          = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID") ?? "";

async function runApifyActor(actorId: string, input: Record<string, unknown>): Promise<any[]> {
  if (!APIFY_API_KEY) throw new Error("APIFY_API_KEY not configured");

  // Start run
  const startRes = await fetch(
    `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${APIFY_API_KEY}&timeout=60`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(70_000),
    },
  );

  if (!startRes.ok) {
    const err = await startRes.text().catch(() => `HTTP ${startRes.status}`);
    throw new Error(`Apify run failed: ${err.slice(0, 200)}`);
  }

  return await startRes.json();
}

async function enrichContactLinkedIn(name: string, email?: string, company?: string): Promise<Record<string, unknown>> {
  // Use Apify's LinkedIn profile scraper
  // Actor: nFo5MFBypFuq8pPDy (LinkedIn Profile Scraper)
  const searchQuery = [name, company].filter(Boolean).join(" ");
  try {
    const items = await runApifyActor("2SyF0bVxmgGr8IVCZ", {
      searchQuery,
      maxItems: 1,
    });

    if (!items?.length) return {};
    const profile = items[0];

    return {
      headline:     profile.headline ?? profile.title ?? null,
      currentRole:  profile.jobTitle ?? null,
      company:      profile.companyName ?? company ?? null,
      location:     profile.location ?? null,
      summary:      (profile.summary ?? "").slice(0, 300) || null,
      linkedinUrl:  profile.profileUrl ?? profile.url ?? null,
      recentPost:   (profile.posts?.[0]?.text ?? "").slice(0, 250) || null,
      enrichedAt:   new Date().toISOString(),
      source:       "linkedin_apify",
    };
  } catch (err) {
    console.warn(`[contact-enrich] LinkedIn scrape failed for ${name}:`, err);
    return {};
  }
}

async function enrichContactWeb(name: string, email?: string, company?: string): Promise<Record<string, unknown>> {
  // Fallback: web search via Apify's Google Search actor
  const query = `"${name}" ${company ? `"${company}"` : ""} site:linkedin.com OR twitter.com`;
  try {
    const items = await runApifyActor("nFo5MFBypFuq8pPDy", {
      queries: [query],
      maxPagesPerQuery: 1,
      resultsPerPage: 3,
    });

    if (!items?.length) return {};
    const snippet = items.map((i: any) => i.description ?? "").join(" ").slice(0, 300);
    return {
      webSummary:  snippet || null,
      enrichedAt:  new Date().toISOString(),
      source:      "web_search_apify",
    };
  } catch {
    return {};
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" },
    });
  }

  try {
    const uid  = OPERATOR_USER_ID;
    const body = await req.json().catch(() => ({}));
    const specificContactId = body.contactId as string | undefined;

    // Build query: specific contact OR batch of stale/unenriched contacts
    let query = sb
      .from("contacts")
      .select("id, name, email, company")
      .eq("user_id", uid);

    if (specificContactId) {
      query = query.eq("id", specificContactId);
    } else {
      // Batch: up to 10 contacts not enriched in the last 7 days
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      query = query
        .or(`last_enriched_at.is.null,last_enriched_at.lt.${sevenDaysAgo}`)
        .not("name", "is", null)
        .order("last_enriched_at", { ascending: true, nullsFirst: true })
        .limit(10);
    }

    const { data: contacts, error } = await query;
    if (error) throw error;
    if (!contacts?.length) {
      return new Response(JSON.stringify({ ok: true, enriched: 0, message: "No contacts to enrich" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    let enriched = 0;
    const results: string[] = [];

    for (const contact of contacts as any[]) {
      try {
        // Try LinkedIn first, fall back to web search
        let enrichmentData = await enrichContactLinkedIn(contact.name, contact.email, contact.company);
        if (!Object.keys(enrichmentData).length) {
          enrichmentData = await enrichContactWeb(contact.name, contact.email, contact.company);
        }

        if (Object.keys(enrichmentData).length > 0) {
          await sb.from("contacts")
            .update({
              enrichment:      enrichmentData,
              last_enriched_at: new Date().toISOString(),
              // Backfill company from enrichment if not set
              ...(contact.company ? {} : { company: enrichmentData.company ?? undefined }),
            })
            .eq("id", contact.id)
            .eq("user_id", uid);

          enriched++;
          results.push(`✓ ${contact.name}${enrichmentData.headline ? ` — ${String(enrichmentData.headline).slice(0, 50)}` : ""}`);
        } else {
          results.push(`○ ${contact.name} — no data found`);
        }
      } catch (err) {
        results.push(`✗ ${contact.name} — error: ${err instanceof Error ? err.message.slice(0, 60) : "unknown"}`);
      }

      // Brief pause to avoid Apify rate limits
      await new Promise((r) => setTimeout(r, 1000));
    }

    // Send Telegram summary if batch mode
    if (!specificContactId && BOT_TOKEN && CHAT_ID) {
      const summary = `🔍 *Contact Enrichment Complete*\n${enriched}/${contacts.length} enriched\n\n${results.join("\n")}`;
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: CHAT_ID, text: summary.slice(0, 4000), parse_mode: "Markdown" }),
      }).catch(() => {});
    }

    return new Response(
      JSON.stringify({ ok: true, enriched, total: contacts.length, results }),
      { headers: { "Content-Type": "application/json" } },
    );

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[mavis-contact-enrich]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
