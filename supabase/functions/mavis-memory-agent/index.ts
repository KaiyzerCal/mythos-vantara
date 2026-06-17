// MAVIS Memory Agent — long-term memory toolkit with delivery routing.
// Mirrors n8n "AI Agent Chatbot Long Term Memory Tools Router":
//   save_memory | retrieve_memories | send_to_telegram | send_to_email
//
// n8n stored memories in a Google Doc; MAVIS uses mavis_memory (Supabase).
// Delivery: Telegram (Claude-formatted list) | Gmail (Claude-formatted HTML table).
//
// Requires: ANTHROPIC_API_KEY + TELEGRAM_BOT_TOKEN.
// Email delivery also requires mavis-google-agent (provider='google').

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SB_URL        = Deno.env.get("SUPABASE_URL")!;
const SB_SRK        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const BOT_TOKEN     = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function callClaude(systemPrompt: string, userPrompt: string, model = "claude-haiku-4-5-20251001"): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Claude error ${res.status}`);
  const data = await res.json();
  return (data.content?.[0]?.text ?? "").trim();
}

async function tgSend(chatId: string, text: string): Promise<boolean> {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    signal: AbortSignal.timeout(15_000),
  });
  return res.ok;
}

function formatMemoriesForContext(rows: Record<string, unknown>[]): string {
  return rows.map((r, i) => {
    const ts = r.timestamp ? new Date(r.timestamp as number).toISOString() : (r.created_at ?? "");
    const tags = Array.isArray(r.tags) ? ` [${(r.tags as string[]).join(", ")}]` : "";
    return `${i + 1}. [${ts}]${tags}\n${r.content}`;
  }).join("\n\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { userId, action, ...p } = body as Record<string, unknown>;

    if (!userId) throw new Error("userId required");
    if (!action)  throw new Error("action required");

    const adminSb = createClient(SB_URL, SB_SRK, { auth: { persistSession: false } });
    let result: unknown;

    switch (action as string) {
      // ── SAVE MEMORY ─────────────────────────────────────────────────────────
      // n8n: append {"date": now, "memory": query} to Google Doc.
      // MAVIS: insert to mavis_memory with optional Claude-extracted tags.
      case "save_memory": {
        const { memory, content: rawContent, tags, importance = 4, session_id = "memory-agent", role = "memory" } = p as Record<string, unknown>;
        const memContent = (memory ?? rawContent ?? "") as string;
        if (!memContent) throw new Error("memory (or content) required");

        // Claude extracts tags if none provided
        let finalTags = Array.isArray(tags) ? tags as string[] : [];
        if (finalTags.length === 0) {
          const extracted = await callClaude(
            "Extract 2-5 short keyword tags from this memory. Reply ONLY with a JSON array of lowercase strings, nothing else. Example: [\"goal\",\"finance\",\"health\"]",
            memContent,
          ).catch(() => "[]");
          try { finalTags = JSON.parse(extracted); } catch { finalTags = []; }
        }

        const { error } = await adminSb.from("mavis_memory").insert({
          user_id:         userId,
          session_id,
          role,
          content:         memContent.slice(0, 4000),
          timestamp:       Date.now(),
          importance_score: importance,
          consolidated:    false,
          tags:            finalTags,
        });
        if (error) throw new Error(`DB insert failed: ${error.message}`);

        result = { saved: true, memory: memContent.slice(0, 200), tags: finalTags, importance };
        break;
      }

      // ── RETRIEVE MEMORIES ───────────────────────────────────────────────────
      // n8n: GET entire Google Doc content.
      // MAVIS: query mavis_memory with optional filters.
      case "retrieve_memories": {
        const { tags: filterTags, min_importance = 1, limit = 50, query, days_back } = p as Record<string, unknown>;

        let q = adminSb.from("mavis_memory")
          .select("content, timestamp, created_at, tags, importance_score, role")
          .eq("user_id", userId)
          .gte("importance_score", min_importance as number)
          .order("timestamp", { ascending: false })
          .limit(limit as number);

        if (Array.isArray(filterTags) && filterTags.length > 0) {
          q = q.contains("tags", filterTags as string[]);
        }
        if (days_back) {
          const cutoff = Date.now() - (days_back as number) * 86_400_000;
          q = q.gte("timestamp", cutoff);
        }

        const { data: rows, error } = await q;
        if (error) throw new Error(`DB query failed: ${error.message}`);

        const memories = (rows ?? []) as Record<string, unknown>[];
        let filtered = memories;
        // Simple keyword search on content if query provided
        if (query && typeof query === "string") {
          const lq = query.toLowerCase();
          filtered = memories.filter((r) => (r.content as string).toLowerCase().includes(lq));
        }

        result = { memories: filtered, count: filtered.length, formatted: formatMemoriesForContext(filtered) };
        break;
      }

      // ── SEND MEMORIES TO TELEGRAM ────────────────────────────────────────────
      // n8n: get doc → Claude format as unformatted list → sendMessage.
      // MAVIS: retrieve from mavis_memory → Claude format → Telegram.
      case "send_to_telegram": {
        const { telegram_chat_id, limit = 30, min_importance = 3, tags: filterTags, days_back, title = "MAVIS Memories" } = p as Record<string, unknown>;
        if (!telegram_chat_id) throw new Error("telegram_chat_id required");

        let q = adminSb.from("mavis_memory")
          .select("content, timestamp, tags, importance_score")
          .eq("user_id", userId)
          .gte("importance_score", min_importance as number)
          .order("timestamp", { ascending: false })
          .limit(limit as number);
        if (Array.isArray(filterTags) && filterTags.length > 0) q = q.contains("tags", filterTags as string[]);
        if (days_back) q = q.gte("timestamp", Date.now() - (days_back as number) * 86_400_000);

        const { data: rows } = await q;
        const memories = (rows ?? []) as Record<string, unknown>[];
        if (memories.length === 0) {
          await tgSend(telegram_chat_id as string, `${title}\n\nNo memories found.`);
          result = { sent: true, count: 0 };
          break;
        }

        const rawContent = formatMemoriesForContext(memories);
        // Port of n8n Prepare Telegram Message: "Format this content into a simple unformatted list..."
        const formatted = await callClaude(
          "Format the provided memories into a simple unformatted plain-text list. Each entry on its own line. Avoid any preamble or further explanation.",
          rawContent,
        );

        // Telegram has a 4096 char limit per message — split if needed
        const header = `<b>${title}</b>\n`;
        const chunks: string[] = [];
        let current = header;
        for (const line of formatted.split("\n")) {
          if ((current + line + "\n").length > 4000) {
            chunks.push(current);
            current = line + "\n";
          } else {
            current += line + "\n";
          }
        }
        if (current.trim()) chunks.push(current);

        let sent = 0;
        for (const chunk of chunks) {
          const ok = await tgSend(telegram_chat_id as string, chunk);
          if (ok) sent++;
        }

        result = { sent: sent > 0, chunks: sent, count: memories.length };
        break;
      }

      // ── SEND MEMORIES TO EMAIL ───────────────────────────────────────────────
      // n8n: get doc → Claude format as HTML table → Gmail.
      // MAVIS: retrieve from mavis_memory → Claude format → mavis-google-agent send_email.
      case "send_to_email": {
        const { send_to, subject = "MAVIS Memories", limit = 50, min_importance = 3, tags: filterTags, days_back } = p as Record<string, unknown>;
        if (!send_to) throw new Error("send_to (email address) required");

        let q = adminSb.from("mavis_memory")
          .select("content, timestamp, tags, importance_score")
          .eq("user_id", userId)
          .gte("importance_score", min_importance as number)
          .order("timestamp", { ascending: false })
          .limit(limit as number);
        if (Array.isArray(filterTags) && filterTags.length > 0) q = q.contains("tags", filterTags as string[]);
        if (days_back) q = q.gte("timestamp", Date.now() - (days_back as number) * 86_400_000);

        const { data: rows } = await q;
        const memories = (rows ?? []) as Record<string, unknown>[];
        if (memories.length === 0) {
          result = { sent: false, count: 0, message: "No memories found matching filters." };
          break;
        }

        const rawContent = formatMemoriesForContext(memories);
        // Port of n8n Prepare Gmail Message: "Format into a simple modern HTML table max 800px wide..."
        const htmlTable = await callClaude(
          "Format the provided memories into a simple, modern HTML table that is max 800px wide, suitable as email body content. Include columns for Date, Tags, and Memory. Avoid any preamble or further explanation. Do not wrap in ``` or ```html.",
          rawContent,
          "claude-haiku-4-5-20251001",
        );

        // Delegate email sending to mavis-google-agent
        const emailRes = await fetch(`${SB_URL}/functions/v1/mavis-google-agent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SB_SRK}` },
          body: JSON.stringify({ userId, action: "send_email", to: send_to, subject, body: htmlTable, is_html: true }),
          signal: AbortSignal.timeout(30_000),
        });
        const emailData = await emailRes.json().catch(() => ({}));
        if (!emailRes.ok) throw new Error((emailData as Record<string, unknown>).error as string ?? `Email send failed: ${emailRes.status}`);

        result = { sent: true, count: memories.length, to: send_to, subject };
        break;
      }

      default:
        throw new Error(`Unknown memory action: ${action}. Supported: save_memory, retrieve_memories, send_to_telegram, send_to_email`);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
