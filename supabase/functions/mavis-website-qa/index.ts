// MAVIS Website Q&A — live website crawl-and-answer without external APIs.
// Mirrors n8n "AI Customer-Support Assistant WhatsApp Ready":
//   list_links(url) → internal link map of a page (up to 100 unique URLs)
//   get_page(url)   → rendered plain text of a page (HTML tags stripped)
//   answer_from_website → full pipeline: list_links → pick ≤5 best links →
//     get_page each → Claude answers; repeat one level deeper if needed
//     (max 2 list_links rounds + 8 get_page calls, mirroring n8n strategy)
//
// clean_answer strips Markdown/formatting markers for plain-text delivery
// channels (WhatsApp, SMS, Telegram without parse_mode).
//
// No external scraping API needed — pure HTTP fetch.
// Requires: ANTHROPIC_API_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SB_URL        = Deno.env.get("SUPABASE_URL")!;
const SB_SRK        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const USER_AGENT = "Mozilla/5.0 (compatible; MAVIS-WebQA/1.0; +https://mavis.ai)";

// ── HTML utilities ────────────────────────────────────────────────────────────

function extractLinks(html: string, baseUrl: string): string[] {
  let base: URL;
  try { base = new URL(baseUrl); } catch { return []; }

  const seen = new Set<string>();
  const links: string[] = [];
  const hrefRe = /href=["']([^"'#][^"']*?)["']/gi;
  let m: RegExpExecArray | null;

  while ((m = hrefRe.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw || raw.startsWith("mailto:") || raw.startsWith("tel:") || raw.startsWith("javascript:")) continue;
    try {
      const abs = new URL(raw, baseUrl);
      abs.hash = "";                          // drop fragment
      if (abs.hostname !== base.hostname) continue; // same domain only
      if (abs.pathname === "/" && abs.search === "") continue; // skip bare root
      const href = abs.href;
      if (!seen.has(href)) { seen.add(href); links.push(href); }
      if (links.length >= 100) break;
    } catch { /* invalid URL — skip */ }
  }
  return links;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, " ")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ── Plain-text cleaner (port of n8n cleanAnswer node) ─────────────────────────

function cleanForPlainText(text: string): string {
  return text
    .replace(/[*_~]+/g, "")                                         // remove bold/italic/strike
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 $2")     // [text](url) → text url
    .replace(/\n{3,}/g, "\n\n")                                     // collapse 3+ blank lines
    .trim();
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function fetchHtml(url: string, timeoutMs = 15_000): Promise<{ html: string; ok: boolean; status: number }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept": "text/html,*/*" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    if (!res.ok) return { html: "", ok: false, status: res.status };
    const html = await res.text();
    return { html, ok: true, status: res.status };
  } catch {
    return { html: "", ok: false, status: 0 };
  }
}

// ── Claude helpers ────────────────────────────────────────────────────────────

async function callClaude(systemPrompt: string, userPrompt: string, model = "claude-haiku-4-5-20251001", maxTokens = 1024): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system: systemPrompt, messages: [{ role: "user", content: userPrompt }] }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Claude error: ${res.status}`);
  const data = await res.json();
  return String(data.content?.[0]?.text ?? "").trim();
}

async function pickBestLinks(links: string[], question: string, limit = 5): Promise<string[]> {
  if (links.length <= limit) return links;
  const list = links.slice(0, 60).join("\n");    // cap list to keep prompt small
  const raw = await callClaude(
    `You select the most relevant URLs for a customer question. Reply ONLY with a JSON array of ${limit} URLs chosen from the list, no commentary.`,
    `Question: ${question}\n\nLinks:\n${list}`,
  );
  try {
    const chosen = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] ?? "[]") as string[];
    return chosen.filter((u) => links.includes(u)).slice(0, limit);
  } catch {
    return links.slice(0, limit); // fallback to first N
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { userId, action, ...p } = body as Record<string, unknown>;

    if (!action) throw new Error("action required");

    const adminSb = userId
      ? createClient(SB_URL, SB_SRK, { auth: { persistSession: false } })
      : null;

    let result: unknown;

    switch (action as string) {
      // ── LIST LINKS ────────────────────────────────────────────────────────────
      // Scrape a page → return up to 100 unique same-domain internal links.
      // Equivalent to n8n list_links tool (but self-hosted, no external service).
      case "list_links": {
        const { url } = p as { url: string };
        if (!url) throw new Error("url required");
        const { html, ok, status } = await fetchHtml(url);
        if (!ok) throw new Error(`Fetch failed (${status}): ${url}`);
        const links = extractLinks(html, url);
        result = { url, links, count: links.length };
        break;
      }

      // ── GET PAGE ──────────────────────────────────────────────────────────────
      // Fetch a URL and return its plain text (HTML tags stripped).
      // Equivalent to n8n get_page / get_text tool.
      case "get_page": {
        const { url, max_chars = 30_000 } = p as { url: string; max_chars?: number };
        if (!url) throw new Error("url required");
        const { html, ok, status } = await fetchHtml(url);
        if (!ok) throw new Error(`Fetch failed (${status}): ${url}`);
        const text = htmlToText(html).slice(0, max_chars as number);
        result = { url, text, char_count: text.length };
        break;
      }

      // ── ANSWER FROM WEBSITE ───────────────────────────────────────────────────
      // Full Q&A pipeline: list_links → pick ≤5 best → get_page each →
      // Claude answers. Repeats one level deeper if needed.
      // Max: 2 list_links rounds + 8 get_page calls (exact n8n limits).
      case "answer_from_website": {
        const {
          url:           websiteUrl,
          question,
          company_name = "our company",
          model        = "claude-haiku-4-5-20251001",
          max_page_fetches = 8,
          max_link_rounds  = 2,
          clean_output     = true,
          conversation_history,
        } = p as Record<string, unknown>;

        if (!websiteUrl) throw new Error("url (company website root) required");
        if (!question)   throw new Error("question required");

        const systemPrompt = `You are ${company_name}'s real-time website assistant for ${websiteUrl}.

ANSWER RULES
- Reply in clear and friendly tone as part of ${company_name} (use "we", "our").
- Keep answers concise but complete.
- Quote the exact wording for facts such as stock status, prices, shipping terms, payment methods, warranties, or policies.
- Write URLs as plain text, e.g.: "See our page at https://..." — do not use Markdown links [text](url).
- No Markdown formatting symbols (* _ ~ # etc.). Plain text only.
- If the information is not on the site, say: "I can't find that information on our site right now. Would you like to speak with a human agent?"
- Stay on-domain; ignore mailto:, tel:, javascript:, or off-site links.`;

        const gatheredTexts: { url: string; text: string }[] = [];
        let pagesFetched = 0;
        let linkRounds   = 0;
        let urlsToCheck  = [String(websiteUrl)];

        while (pagesFetched < (max_page_fetches as number) && linkRounds < (max_link_rounds as number)) {
          // Step 1: list_links on the current level
          const { html: rootHtml, ok } = await fetchHtml(urlsToCheck[0]);
          if (!ok) break;
          const allLinks = extractLinks(rootHtml, urlsToCheck[0]);
          linkRounds++;

          // Step 2: Claude picks ≤5 best links
          const chosen = await pickBestLinks(allLinks, String(question), 5);
          if (chosen.length === 0) break;

          // Step 3: get_page on each chosen link
          for (const link of chosen) {
            if (pagesFetched >= (max_page_fetches as number)) break;
            const { html, ok: pOk } = await fetchHtml(link, 12_000);
            if (!pOk) continue;
            gatheredTexts.push({ url: link, text: htmlToText(html).slice(0, 15_000) });
            pagesFetched++;
          }

          // Step 4: ask Claude if we have enough to answer
          const pagesContext = gatheredTexts.map((p) => `--- ${p.url} ---\n${p.text}`).join("\n\n");
          const checkPrompt  = `Website pages retrieved so far:\n\n${pagesContext}\n\nQuestion: ${question}\n\nDo you have enough information to answer? Reply YES or NO only.`;
          const hasAnswer    = await callClaude(systemPrompt, checkPrompt, "claude-haiku-4-5-20251001", 10);

          if (hasAnswer.toUpperCase().startsWith("YES")) break;

          // Prepare for next level: use best gathered page as new root
          if (linkRounds < (max_link_rounds as number) && gatheredTexts.length > 0) {
            urlsToCheck = [gatheredTexts[gatheredTexts.length - 1].url];
          } else break;
        }

        // Final answer synthesis
        const pagesContext = gatheredTexts.map((p) => `--- ${p.url} ---\n${p.text}`).join("\n\n");

        const prevHistory = Array.isArray(conversation_history)
          ? (conversation_history as {role:string;content:string}[]).map((m) => `${m.role}: ${m.content}`).join("\n")
          : "";
        const finalPrompt = prevHistory
          ? `Previous conversation:\n${prevHistory}\n\nWebsite pages:\n${pagesContext}\n\nUser question: ${question}`
          : `Website pages:\n${pagesContext}\n\nUser question: ${question}`;

        let answer = await callClaude(systemPrompt, finalPrompt, model as string, 1024);
        if (clean_output) answer = cleanForPlainText(answer);

        // Log to mavis_memory if userId provided
        if (userId && adminSb) {
          await adminSb.from("mavis_memory").insert({
            user_id: userId,
            content: `Website Q&A (${websiteUrl}): Q: ${String(question).slice(0, 100)} A: ${answer.slice(0, 200)}`,
            importance_score: 2,
            tags: ["website_qa", "customer_support", String(websiteUrl).split("/")[2] ?? "website"],
            timestamp: Date.now(),
            consolidated: false,
          }).then(() => {});
        }

        result = {
          answer,
          sources_checked: gatheredTexts.map((p) => p.url),
          pages_fetched: pagesFetched,
          link_rounds: linkRounds,
          company: company_name,
          website: websiteUrl,
        };
        break;
      }

      // ── CLEAN TEXT ────────────────────────────────────────────────────────────
      // Strip Markdown formatting for plain-text channels (WhatsApp, SMS).
      // Port of n8n cleanAnswer node.
      case "clean_text": {
        const { text } = p as { text: string };
        if (!text) throw new Error("text required");
        result = { clean: cleanForPlainText(text) };
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}. Supported: list_links, get_page, answer_from_website, clean_text`);
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
