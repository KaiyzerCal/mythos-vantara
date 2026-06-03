import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Importance heuristic (mirrors mavis-chat) ─────────────────────────────────
function scoreImportance(text: string): number {
  const lower = text.toLowerCase();
  const HIGH = ["goal","decide","decided","contract","revenue","critical","never","always","promise","commit","committed","deadline","milestone","must","rule","principle"];
  const MED  = ["quest","task","project","plan","build","launch","strategy","system","habit","ritual"];
  if (HIGH.some(w => lower.includes(w))) return Math.min(9, 7 + HIGH.filter(w => lower.includes(w)).length);
  if (MED.some(w => lower.includes(w)))  return 5 + (MED.filter(w => lower.includes(w)).length > 1 ? 1 : 0);
  return 3;
}

// ── Allowed tables ────────────────────────────────────────────────────────────
const READ_TABLES = new Set([
  "quests", "tasks", "skills", "rituals", "allies", "inventory",
  "journal_entries", "vault_entries", "mavis_notes", "mavis_memory",
  "mavis_tacit", "mavis_tasks", "energy_systems", "bpm_sessions",
  "store_items", "transformations",
  "contacts", "contact_interactions", "health_metrics",
  "mavis_insights", "calendar_events",
]);

const WRITE_TABLES = new Set([
  "quests", "tasks", "rituals", "mavis_notes", "mavis_memory", "mavis_tasks",
  "contacts", "contact_interactions",
]);

// ── Sandboxed JS executor (mirrors mavis-code-exec) ───────────────────────────
const SAFE_GLOBALS = {
  Math, JSON, Date, Array, Object, Number, String, Boolean,
  parseInt, parseFloat, isNaN, isFinite,
  encodeURIComponent, decodeURIComponent,
};

async function runCode(code: string): Promise<{ result?: string; output: string[]; error?: string }> {
  const output: string[] = [];
  const mockConsole = {
    log:   (...args: unknown[]) => output.push(args.map(a => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" ")),
    error: (...args: unknown[]) => output.push("[ERR] " + args.join(" ")),
    warn:  (...args: unknown[]) => output.push("[WARN] " + args.join(" ")),
    table: (data: unknown) => output.push(JSON.stringify(data, null, 2)),
  };
  try {
    const paramNames = ["console", ...Object.keys(SAFE_GLOBALS)];
    const paramValues = [mockConsole, ...Object.values(SAFE_GLOBALS)];
    const fn = new Function(...paramNames, `"use strict";\n${code}`);
    const raw = fn(...paramValues);
    const result = raw instanceof Promise
      ? await Promise.race([raw, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout after 8s")), 8000))])
      : raw;
    const resultStr = result !== undefined
      ? (typeof result === "object" ? JSON.stringify(result, null, 2) : String(result))
      : "(no return value)";
    return { result: resultStr, output };
  } catch (err: any) {
    return { output, error: err?.message ?? String(err) };
  }
}

// ── Tool schema ───────────────────────────────────────────────────────────────
const AGENT_TOOLS = [
  {
    name: "query_db",
    description:
      "Query a MAVIS database table. Use to look up the operator's quests, tasks, skills, rituals, allies, inventory, notes, memories, or tacit rules. Always query before claiming something doesn't exist.",
    input_schema: {
      type: "object" as const,
      properties: {
        table: { type: "string", description: `Table name. Allowed: ${[...READ_TABLES].join(", ")}` },
        filters: { type: "object", description: "Key-value equality filters (e.g. {\"status\": \"active\"})" },
        columns: { type: "string", description: "Columns to select (default '*')" },
        limit: { type: "number", description: "Max rows (default 20, max 100)" },
        order_by: { type: "string", description: "Column to sort by (e.g. 'created_at')" },
        ascending: { type: "boolean", description: "Sort direction — true = oldest first, false = newest first (default false)" },
      },
      required: ["table"],
    },
  },
  {
    name: "search_knowledge",
    description:
      "Semantic vector search over MAVIS knowledge notes. Use when you need to find relevant information by meaning rather than exact field match.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Natural language search query" },
        limit: { type: "number", description: "Max results (default 6)" },
        threshold: { type: "number", description: "Similarity threshold 0–1 (default 0.6). Lower returns more results." },
      },
      required: ["query"],
    },
  },
  {
    name: "web_search",
    description:
      "Search the live web for current information — news, prices, events, documentation. Use when the query requires real-time or post-training data.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query" },
        max_results: { type: "number", description: "Number of results (default 5)" },
      },
      required: ["query"],
    },
  },
  {
    name: "upsert_record",
    description:
      "Insert or update a record in a MAVIS table. Use to create quests, tasks, notes, or update existing records on the operator's behalf.",
    input_schema: {
      type: "object" as const,
      properties: {
        table: { type: "string", description: `Table name. Allowed for writes: ${[...WRITE_TABLES].join(", ")}` },
        data: { type: "object", description: "Record fields. Do NOT include user_id — it is injected automatically." },
        on_conflict: { type: "string", description: "Column(s) for upsert dedup (e.g. 'id'). Omit for pure insert." },
      },
      required: ["table", "data"],
    },
  },
  {
    name: "read_note",
    description: "Fetch the full content of a specific MAVIS note by its UUID. Use after search_knowledge returns a relevant note ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        note_id: { type: "string", description: "UUID of the mavis_notes record" },
      },
      required: ["note_id"],
    },
  },
  {
    name: "run_code",
    description:
      "Execute sandboxed JavaScript/TypeScript for calculations, data transformation, analysis, or formatting. Has access to Math, JSON, Date, Array, Object — no network or file system. Returns stdout output and the final return value.",
    input_schema: {
      type: "object" as const,
      properties: {
        code: {
          type: "string",
          description: "JavaScript code to execute. Use console.log() for output. Return a value to capture the result.",
        },
        description: {
          type: "string",
          description: "Brief human-readable description of what this code does (shown to user as thinking indicator)",
        },
      },
      required: ["code"],
    },
  },
  {
    name: "query_documents",
    description:
      "Semantic search over uploaded and ingested documents (PDFs, articles, web pages) that have been extracted into the knowledge base. Use when the user asks about the content of a file they've uploaded or a URL they've ingested.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Natural language query about the document content" },
        limit: { type: "number", description: "Max results (default 6)" },
        doc_source: { type: "string", description: "Optional: filter by document file name to narrow results to a specific file" },
      },
      required: ["query"],
    },
  },
  {
    name: "analyze_image",
    description:
      "Analyze an image by URL using Claude vision. Use when the operator wants MAVIS to describe, read text from, or reason about an image file. Works with vault-media image URLs or any public image URL.",
    input_schema: {
      type: "object" as const,
      properties: {
        image_url: { type: "string", description: "Public URL of the image to analyze" },
        question: { type: "string", description: "What to look for or describe in the image (e.g., 'What text is visible?', 'Describe this chart', 'What objects are in this photo?')" },
      },
      required: ["image_url"],
    },
  },
  {
    name: "run_python",
    description:
      "Execute real Python code with full library support (pandas, numpy, math, json, datetime, etc.) in a sandboxed environment. Use for data analysis, CSV processing, mathematical modeling, or any task requiring Python-only libraries. Returns stdout and stderr.",
    input_schema: {
      type: "object" as const,
      properties: {
        code: { type: "string", description: "Python code to execute. Use print() for output." },
        description: { type: "string", description: "Brief description of what the code does (shown to user as thinking indicator)" },
      },
      required: ["code"],
    },
  },
  {
    name: "deep_research",
    description:
      "Perform multi-step web research on a topic: breaks query into angles, searches each, fetches sources, and synthesizes a comprehensive markdown report with citations. Use when a single web_search won't suffice — for competitive analysis, detailed how-tos, market research, or any topic requiring depth.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "The research question or topic" },
        depth: { type: "number", description: "Number of search angles to explore (2-5, default 3)" },
      },
      required: ["query"],
    },
  },
  {
    name: "post_to_linkedin",
    description: "Post content to LinkedIn as Nora Vale persona. Can generate content automatically or use provided text.",
    input_schema: {
      type: "object" as const,
      properties: {
        content: { type: "string", description: "Text to post. Leave empty to auto-generate." },
        generate: { type: "boolean", description: "If true, generate post content via Claude before posting." },
      },
      required: [],
    },
  },
  {
    name: "send_email",
    description: "Send an email via Resend. Can auto-draft the email body using Claude if generate=true.",
    input_schema: {
      type: "object" as const,
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject line" },
        body: { type: "string", description: "Email body. Leave empty if using generate." },
        generate: { type: "boolean", description: "If true, draft the email via Claude." },
        generate_prompt: { type: "string", description: "What the email should be about (used when generate=true)" },
      },
      required: ["to"],
    },
  },
  {
    name: "dispatch_webhook",
    description: "Fire an outbound webhook event to all registered endpoints matching the event type. Use when a significant action completes (quest, goal, revenue logged).",
    input_schema: {
      type: "object" as const,
      properties: {
        event_type: { type: "string", description: "Event type e.g. quest.completed, goal.achieved, mavis.insight" },
        payload: { type: "object", description: "Event data to send to the webhook" },
      },
      required: ["event_type"],
    },
  },
  {
    name: "post_to_instagram",
    description: "Post content to Instagram as Nora Vale persona. Requires an image_url for published posts; without one the caption is saved as a draft.",
    input_schema: {
      type: "object" as const,
      properties: {
        content: { type: "string", description: "Caption text. Leave empty to auto-generate." },
        image_url: { type: "string", description: "Public image URL to attach to the post." },
        generate: { type: "boolean", description: "If true, generate caption via Claude before posting." },
      },
      required: [],
    },
  },
  {
    name: "post_to_tiktok",
    description: "Post content to TikTok as Nora Vale persona. Provide a video_url for a video post, or omit for a text/caption draft.",
    input_schema: {
      type: "object" as const,
      properties: {
        content: { type: "string", description: "Caption/script text. Leave empty to auto-generate." },
        video_url: { type: "string", description: "Public video URL to publish. If omitted, saves as draft." },
        generate: { type: "boolean", description: "If true, generate content via Claude before posting." },
      },
      required: [],
    },
  },
  {
    name: "send_sms",
    description: "Send an SMS or WhatsApp message on the operator's behalf. Use for quick notifications, reminders, or follow-ups that don't require a full phone call.",
    input_schema: {
      type: "object" as const,
      properties: {
        to: { type: "string", description: "Recipient phone number in international format: +15551234567" },
        message: { type: "string", description: "Message text to send" },
        channel: { type: "string", description: "sms (default) or whatsapp" },
      },
      required: ["to", "message"],
    },
  },
  {
    name: "transcribe_meeting",
    description: "Transcribe a meeting audio file and extract action items, decisions, and next steps. Can automatically create tasks from action items.",
    input_schema: {
      type: "object" as const,
      properties: {
        audio_url: { type: "string", description: "Public URL to the audio file (MP3, MP4, WAV, M4A)" },
        meeting_title: { type: "string", description: "Name of the meeting for context" },
        participants: { type: "array", items: { type: "string" }, description: "List of participant names" },
        create_quests: { type: "boolean", description: "If true, automatically queue action items as MAVIS tasks" },
      },
      required: ["audio_url"],
    },
  },
  {
    name: "calendar_action",
    description: "Perform Google Calendar operations: find free time slots, create events, reschedule, cancel, or list upcoming events.",
    input_schema: {
      type: "object" as const,
      properties: {
        action: { type: "string", description: "find_free_time | create_event | reschedule_event | cancel_event | list_events" },
        title: { type: "string", description: "Event title (for create_event)" },
        start_date: { type: "string", description: "Date in YYYY-MM-DD format" },
        start_time: { type: "string", description: "Time in HH:MM:SS format (e.g. 14:00:00)" },
        end_date: { type: "string", description: "End date" },
        end_time: { type: "string", description: "End time" },
        duration_minutes: { type: "number", description: "Duration in minutes (for find_free_time)" },
        event_id: { type: "string", description: "Google Calendar event ID (for reschedule/cancel)" },
        location: { type: "string", description: "Event location" },
        description: { type: "string", description: "Event description" },
        attendees: { type: "array", items: { type: "string" }, description: "Attendee email addresses" },
      },
      required: ["action"],
    },
  },
  {
    name: "research_lead",
    description: "Research a company as a potential SkyforgeAI lead. MAVIS scrapes the web, profiles the company, scores the lead, and optionally drafts outreach.",
    input_schema: {
      type: "object" as const,
      properties: {
        company: { type: "string", description: "Company name to research" },
        target_role: { type: "string", description: "Target decision-maker role (CEO, Head of Marketing, etc.)" },
        draft_outreach: { type: "boolean", description: "If true, also draft a personalized cold email after researching" },
      },
      required: ["company"],
    },
  },
  {
    name: "monitor_competitor",
    description: "Add a competitor website to MAVIS's monitoring list, or run a check on all monitored competitors to detect changes.",
    input_schema: {
      type: "object" as const,
      properties: {
        action: { type: "string", description: "add (add new competitor) or check (run monitoring check on all)" },
        name: { type: "string", description: "Competitor company name (for add action)" },
        url: { type: "string", description: "Competitor website URL (for add action)" },
      },
      required: ["action"],
    },
  },
  {
    name: "health_protocol",
    description: "Synthesize wearable and health data (Oura, WHOOP, Strava, health_metrics) into today's personalized performance protocol — training recommendation, nutrition focus, readiness score.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: { type: "string", description: "Date to generate protocol for (YYYY-MM-DD, defaults to today)" },
      },
      required: [],
    },
  },
  {
    name: "dispatch_task",
    description: "Queue an autonomous background task for MAVIS to execute. Use when the operator asks MAVIS to handle something that requires multiple steps, external calls, or extended time. The task runs automatically via the autonomous engine. Task types: 'goal' (multi-step objective), 'create_product', 'demand_scan', 'send_announcement', 'nora_tweet', 'revenue_snapshot'.",
    input_schema: {
      type: "object" as const,
      properties: {
        type: { type: "string", description: "Task type: goal | create_product | demand_scan | send_announcement | nora_tweet | revenue_snapshot" },
        description: { type: "string", description: "Human-readable description of what this task will do" },
        payload: { type: "object", description: "Task-specific parameters. For 'goal': { objective, context }. For 'create_product': { title, description, price_cents }. For 'nora_tweet': { content }." },
        scheduled_at: { type: "string", description: "ISO timestamp to delay execution (optional — omit to run immediately)" },
      },
      required: ["type", "description", "payload"],
    },
  },
  {
    name: "make_phone_call",
    description: "Initiate an outbound AI phone call. MAVIS will call the number and speak on the operator's behalf to accomplish the stated purpose — e.g. make a reservation, follow up with a client, cancel an appointment, gather information.",
    input_schema: {
      type: "object" as const,
      properties: {
        to: { type: "string", description: "Phone number in international format: +15551234567" },
        purpose: { type: "string", description: "What MAVIS should accomplish on the call. Be specific: 'Reserve a table for 2 at La Piazza on Friday at 7pm under the name Caliyah Johnson.'" },
        caller_name: { type: "string", description: "Name MAVIS introduces itself as (default: MAVIS)" },
      },
      required: ["to", "purpose"],
    },
  },
];

// ── Tool executor ─────────────────────────────────────────────────────────────
async function executeTool(
  name: string,
  input: Record<string, unknown>,
  userId: string,
  adminSb: ReturnType<typeof createClient>,
  openaiKey: string,
  tavilyKey: string,
  sourcesAcc: Array<{ title: string; url: string }>,
): Promise<string> {
  try {
    switch (name) {
      case "query_db": {
        const table = String(input.table ?? "");
        const filters = (input.filters ?? {}) as Record<string, unknown>;
        const columns = String(input.columns ?? "*");
        const limit = Math.min(Number(input.limit ?? 20), 100);
        const orderBy = String(input.order_by ?? "created_at");
        const ascending = Boolean(input.ascending ?? false);

        if (!READ_TABLES.has(table)) return JSON.stringify({ error: `Table '${table}' is not accessible` });
        let q = adminSb.from(table).select(columns).eq("user_id", userId).limit(limit);
        for (const [k, v] of Object.entries(filters)) q = q.eq(k, v as string);
        if (orderBy) q = q.order(orderBy, { ascending });
        const { data, error } = await q;
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify(data ?? []);
      }

      case "search_knowledge": {
        const query = String(input.query ?? "");
        const limit = Number(input.limit ?? 6);
        const threshold = Number(input.threshold ?? 0.6);

        const embedRes = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
          body: JSON.stringify({ model: "text-embedding-3-small", input: query }),
        });
        if (!embedRes.ok) return JSON.stringify({ error: `Embedding failed: ${embedRes.status}` });
        const embedData = await embedRes.json();
        const embedding = embedData.data?.[0]?.embedding;
        if (!embedding) return JSON.stringify({ error: "No embedding returned" });

        const { data, error } = await adminSb.rpc("match_mavis_notes", {
          query_embedding: embedding,
          match_threshold: threshold,
          match_count: limit,
          p_user_id: userId,
        });
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify(data ?? []);
      }

      case "web_search": {
        const query = String(input.query ?? "");
        const maxResults = Number(input.max_results ?? 5);

        if (!tavilyKey) return JSON.stringify({ error: "Web search not configured (no Tavily key)" });
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: tavilyKey, query, max_results: maxResults }),
        });
        if (!res.ok) return JSON.stringify({ error: `Tavily ${res.status}` });
        const d = await res.json();
        const results = (d.results ?? []).map((r: any) => ({
          title: r.title,
          url: r.url,
          content: (r.content ?? "").slice(0, 600),
        }));
        // Accumulate sources for citation display
        for (const r of results) {
          if (r.url && !sourcesAcc.some(s => s.url === r.url)) {
            sourcesAcc.push({ title: r.title ?? r.url, url: r.url });
          }
        }
        return JSON.stringify(results);
      }

      case "upsert_record": {
        const table = String(input.table ?? "");
        const data = (input.data ?? {}) as Record<string, unknown>;
        const onConflict = input.on_conflict ? String(input.on_conflict) : undefined;

        if (!WRITE_TABLES.has(table)) return JSON.stringify({ error: `Writing to '${table}' is not permitted` });
        const record = { ...data, user_id: userId };
        if (onConflict) {
          const { data: result, error } = await adminSb.from(table).upsert(record, { onConflict }).select().maybeSingle();
          if (error) return JSON.stringify({ error: error.message });
          return JSON.stringify({ success: true, record: result });
        } else {
          const { data: result, error } = await adminSb.from(table).insert(record).select().maybeSingle();
          if (error) return JSON.stringify({ error: error.message });
          return JSON.stringify({ success: true, record: result });
        }
      }

      case "read_note": {
        const noteId = String(input.note_id ?? "");
        const { data, error } = await adminSb.from("mavis_notes").select("*").eq("id", noteId).eq("user_id", userId).maybeSingle();
        if (error) return JSON.stringify({ error: error.message });
        if (!data) return JSON.stringify({ error: "Note not found" });
        return JSON.stringify(data);
      }

      case "run_code": {
        const code = String(input.code ?? "");
        if (!code.trim()) return JSON.stringify({ error: "No code provided" });
        const result = await runCode(code);
        return JSON.stringify(result);
      }

      case "query_documents": {
        const query = String(input.query ?? "");
        const limit = Number(input.limit ?? 6);
        const docSource = input.doc_source ? String(input.doc_source) : null;

        if (!openaiKey) return JSON.stringify({ error: "OpenAI key not configured for embeddings" });
        const embedRes = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
          body: JSON.stringify({ model: "text-embedding-3-small", input: query }),
        });
        if (!embedRes.ok) return JSON.stringify({ error: `Embedding failed: ${embedRes.status}` });
        const embedData = await embedRes.json();
        const embedding = embedData.data?.[0]?.embedding;
        if (!embedding) return JSON.stringify({ error: "No embedding returned" });

        const { data, error } = await adminSb.rpc("match_mavis_notes", {
          query_embedding: embedding,
          match_threshold: 0.4,
          match_count: limit * 2,
          p_user_id: userId,
        });
        if (error) return JSON.stringify({ error: error.message });

        let results = (data ?? []).filter((n: any) =>
          Array.isArray(n.tags) && n.tags.includes("document")
        );
        if (docSource) {
          results = results.filter((n: any) =>
            String(n.properties?.doc_source ?? "").toLowerCase().includes(docSource.toLowerCase())
          );
        }
        return JSON.stringify(results.slice(0, limit).map((n: any) => ({
          title: n.title,
          content: n.content,
          doc_source: n.properties?.doc_source ?? null,
          similarity: n.similarity,
        })));
      }

      case "analyze_image": {
        const imageUrl = String(input.image_url ?? "");
        const question = String(input.question ?? "Describe this image in detail.");
        if (!imageUrl) return JSON.stringify({ error: "image_url is required" });

        const claudeKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
        if (!claudeKey) return JSON.stringify({ error: "Claude API key not configured" });

        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": claudeKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 2048,
            messages: [{
              role: "user",
              content: [
                { type: "image", source: { type: "url", url: imageUrl } },
                { type: "text", text: question },
              ],
            }],
          }),
        });
        if (!res.ok) {
          const err = await res.text();
          return JSON.stringify({ error: `Vision API error ${res.status}: ${err.slice(0, 200)}` });
        }
        const d = await res.json();
        const analysis = (d.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
        return JSON.stringify({ analysis, image_url: imageUrl });
      }

      case "run_python": {
        const code = String(input.code ?? "");
        if (!code.trim()) return JSON.stringify({ error: "No code provided" });

        const supabaseUrl2 = Deno.env.get("SUPABASE_URL") ?? "";
        const serviceKey2 = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

        try {
          const res = await fetch(`${supabaseUrl2}/functions/v1/mavis-python-exec`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey2}` },
            body: JSON.stringify({ code, timeout_ms: 30000 }),
          });
          const data = await res.json();
          return JSON.stringify(data);
        } catch (err: any) {
          return JSON.stringify({ error: err.message ?? "Python exec failed" });
        }
      }

      case "deep_research": {
        const query = String(input.query ?? "");
        const depth = Math.min(Math.max(Number(input.depth ?? 3), 2), 5);
        if (!query.trim()) return JSON.stringify({ error: "No query provided" });

        const supabaseUrl3 = Deno.env.get("SUPABASE_URL") ?? "";
        const serviceKey3 = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

        try {
          const res = await fetch(`${supabaseUrl3}/functions/v1/mavis-deep-research`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey3}` },
            body: JSON.stringify({ query, depth }),
          });
          // deep-research streams SSE; collect full text
          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          let report = "";
          let buf = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const raw = line.slice(6).trim();
              if (raw === "[DONE]") break;
              try { const j = JSON.parse(raw); if (j.token) report += j.token; } catch { /* skip */ }
            }
          }
          return JSON.stringify({ report, query });
        } catch (err: any) {
          return JSON.stringify({ error: err.message ?? "Deep research failed" });
        }
      }

      case "post_to_linkedin": {
        const supabaseUrl4 = Deno.env.get("SUPABASE_URL") ?? "";
        const serviceKey4  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        try {
          const res = await fetch(`${supabaseUrl4}/functions/v1/mavis-nora-linkedin`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey4}` },
            body: JSON.stringify({
              user_id: userId,
              content: String(input.content ?? ""),
              generate: Boolean(input.generate ?? !input.content),
            }),
          });
          return JSON.stringify(await res.json());
        } catch (err: any) {
          return JSON.stringify({ error: err.message ?? "LinkedIn post failed" });
        }
      }

      case "send_email": {
        const supabaseUrl5 = Deno.env.get("SUPABASE_URL") ?? "";
        const serviceKey5  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        try {
          const res = await fetch(`${supabaseUrl5}/functions/v1/mavis-email-send`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey5}` },
            body: JSON.stringify({
              user_id: userId,
              to: input.to,
              subject: input.subject,
              body: input.body,
              generate: input.generate,
              generate_prompt: input.generate_prompt,
            }),
          });
          return JSON.stringify(await res.json());
        } catch (err: any) {
          return JSON.stringify({ error: err.message ?? "Email send failed" });
        }
      }

      case "dispatch_webhook": {
        const supabaseUrl6 = Deno.env.get("SUPABASE_URL") ?? "";
        const serviceKey6  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        try {
          const res = await fetch(`${supabaseUrl6}/functions/v1/mavis-webhook-dispatch`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey6}` },
            body: JSON.stringify({
              user_id: userId,
              event_type: input.event_type,
              payload: input.payload ?? {},
            }),
          });
          return JSON.stringify(await res.json());
        } catch (err: any) {
          return JSON.stringify({ error: err.message ?? "Webhook dispatch failed" });
        }
      }

      case "post_to_instagram": {
        const supabaseUrl7 = Deno.env.get("SUPABASE_URL") ?? "";
        const serviceKey7  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        try {
          const res = await fetch(`${supabaseUrl7}/functions/v1/mavis-nora-instagram`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey7}` },
            body: JSON.stringify({
              user_id: userId,
              content: String(input.content ?? ""),
              image_url: input.image_url,
              generate: Boolean(input.generate ?? !input.content),
            }),
          });
          return JSON.stringify(await res.json());
        } catch (err: any) {
          return JSON.stringify({ error: err.message ?? "Instagram post failed" });
        }
      }

      case "post_to_tiktok": {
        const supabaseUrl8 = Deno.env.get("SUPABASE_URL") ?? "";
        const serviceKey8  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        try {
          const res = await fetch(`${supabaseUrl8}/functions/v1/mavis-nora-tiktok`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey8}` },
            body: JSON.stringify({
              user_id: userId,
              content: String(input.content ?? ""),
              video_url: input.video_url,
              generate: Boolean(input.generate ?? !input.content),
            }),
          });
          return JSON.stringify(await res.json());
        } catch (err: any) {
          return JSON.stringify({ error: err.message ?? "TikTok post failed" });
        }
      }

      case "send_sms": {
        const sbUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const sk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        const res = await fetch(`${sbUrl}/functions/v1/mavis-sms`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${sk}` },
          body: JSON.stringify({ to: String(input.to ?? ""), message: String(input.message ?? ""), channel: input.channel ?? "sms" }),
        });
        return JSON.stringify(await res.json());
      }

      case "transcribe_meeting": {
        const sbUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const sk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        const res = await fetch(`${sbUrl}/functions/v1/mavis-meeting-transcribe`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${sk}` },
          body: JSON.stringify({ audio_url: input.audio_url, meeting_title: input.meeting_title, participants: input.participants, create_quests: input.create_quests ?? false }),
        });
        const data = await res.json();
        if (!res.ok) return JSON.stringify({ error: data.error ?? "Transcription failed" });
        return JSON.stringify({ success: true, summary: data.summary, action_items: data.action_items, decisions: data.decisions });
      }

      case "calendar_action": {
        const sbUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const sk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        const res = await fetch(`${sbUrl}/functions/v1/mavis-calendar-manage`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${sk}` },
          body: JSON.stringify({ ...input }),
        });
        return JSON.stringify(await res.json());
      }

      case "research_lead": {
        const sbUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const sk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        const res = await fetch(`${sbUrl}/functions/v1/mavis-lead-gen`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${sk}` },
          body: JSON.stringify({ company: input.company, target_role: input.target_role, action: "research" }),
        });
        const leadData = await res.json();
        if (!res.ok) return JSON.stringify({ error: leadData.error });
        if (input.draft_outreach) {
          const draftRes = await fetch(`${sbUrl}/functions/v1/mavis-lead-gen`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${sk}` },
            body: JSON.stringify({ action: "draft_outreach", lead_id: leadData.id }),
          });
          const draftData = await draftRes.json();
          return JSON.stringify({ ...leadData, outreach_draft: draftData.outreach_draft });
        }
        return JSON.stringify(leadData);
      }

      case "monitor_competitor": {
        const sbUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const sk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        const res = await fetch(`${sbUrl}/functions/v1/mavis-competitor-monitor`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${sk}` },
          body: JSON.stringify({ action: input.action, name: input.name, url: input.url }),
        });
        return JSON.stringify(await res.json());
      }

      case "health_protocol": {
        const sbUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const sk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        const res = await fetch(`${sbUrl}/functions/v1/mavis-health-protocol`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${sk}` },
          body: JSON.stringify({ date: input.date }),
        });
        return JSON.stringify(await res.json());
      }

      case "dispatch_task": {
        const taskType   = String(input.type ?? "goal");
        const taskDesc   = String(input.description ?? "");
        const taskPayload = (input.payload ?? {}) as Record<string, unknown>;
        const scheduledAt = input.scheduled_at ? String(input.scheduled_at) : null;
        try {
          const { data, error } = await adminSb.from("mavis_tasks").insert({
            user_id: userId,
            type: taskType,
            description: taskDesc,
            payload: taskPayload,
            status: "pending",
            scheduled_at: scheduledAt,
          }).select("id").single();
          if (error) return JSON.stringify({ error: error.message });
          return JSON.stringify({ success: true, task_id: data.id, type: taskType, message: `Task queued. MAVIS will execute: ${taskDesc}` });
        } catch (err: any) {
          return JSON.stringify({ error: err.message ?? "Failed to dispatch task" });
        }
      }

      case "make_phone_call": {
        const supabaseUrl9 = Deno.env.get("SUPABASE_URL") ?? "";
        const serviceKey9  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        try {
          const res = await fetch(`${supabaseUrl9}/functions/v1/mavis-phone-call`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey9}` },
            body: JSON.stringify({
              to: String(input.to ?? ""),
              purpose: String(input.purpose ?? ""),
              caller_name: input.caller_name ? String(input.caller_name) : "MAVIS",
            }),
          });
          const data = await res.json();
          if (!res.ok) return JSON.stringify({ error: data.error ?? `Phone call failed: ${res.status}` });
          return JSON.stringify({ success: true, ...data, message: `Call initiated to ${input.to}. MAVIS is dialing.` });
        } catch (err: any) {
          return JSON.stringify({ error: err.message ?? "Phone call failed" });
        }
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err: any) {
    return JSON.stringify({ error: err.message ?? "Tool execution failed" });
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const rawMessages: any[] = Array.isArray(body.messages) ? body.messages : [];
    const systemPrompt: string = body.systemPrompt ?? "";
    const inConvoId: string | null = body.conversationId ?? null;

    // ── Auth ──────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const openaiKey = Deno.env.get("OPENAI_API") ?? "";
    const claudeKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
    const tavilyKey = Deno.env.get("Tavily_API") ?? "";
    const geminiKey = Deno.env.get("GEMINI_API_KEY") ?? "";

    if (!claudeKey) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userSb = createClient(supabaseUrl, token, { auth: { persistSession: false } });
    const adminSb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: { user }, error: authErr } = await userSb.auth.getUser();
    if (authErr || !user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id;
    const enc = new TextEncoder();

    const sseBody = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: Record<string, unknown>) =>
          controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));

        let finalText = "";
        let conversationId = inConvoId;
        let iteration = 0;
        // Capture the last user message for memory write-back
        const lastUserMsg = rawMessages.filter(m => m.role === "user").slice(-1)[0]?.content ?? "";

        try {
          // ── Trim history to ~60k chars ────────────────────
          let charTotal = 0;
          const trimmed: any[] = [];
          for (let i = rawMessages.length - 1; i >= 0; i--) {
            const c = typeof rawMessages[i].content === "string"
              ? rawMessages[i].content
              : JSON.stringify(rawMessages[i].content ?? "");
            charTotal += c.length;
            if (charTotal > 60000 && trimmed.length > 0) break;
            trimmed.unshift(rawMessages[i]);
          }
          let messages: any[] = trimmed;

          const MODEL = "claude-sonnet-4-6";
          const MAX_ITER = 8;
          // Accumulates web_search sources for citation display
          const sources: Array<{ title: string; url: string }> = [];

          // ── Tier 0: Gemini pre-flight (no tools) ───────────
          let lvHandled = false;
          if (geminiKey) {
            try {
              const lvMsgs = messages.map((m: any) => ({
                role: m.role === "user" ? "user" : "model",
                parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
              }));
              const lvRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  systemInstruction: { parts: [{ text: systemPrompt }] },
                  contents: lvMsgs,
                  generationConfig: { maxOutputTokens: 4096 },
                }),
              });
              if (lvRes.ok) {
                const lvData = await lvRes.json();
                const lvText: string = (lvData.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim();
                if (lvText) { finalText = lvText; lvHandled = true; }
              }
            } catch { /* fall through to Claude ReAct loop */ }
          }

          // ── ReAct loop ─────────────────────────────────────
          if (!lvHandled)
          while (iteration < MAX_ITER) {
            iteration++;

            const res = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": claudeKey,
                "anthropic-version": "2023-06-01",
              },
              body: JSON.stringify({
                model: MODEL,
                max_tokens: 4096,
                system: systemPrompt,
                tools: AGENT_TOOLS,
                messages,
              }),
            });

            if (!res.ok) {
              const errText = await res.text();
              throw new Error(`Claude ${res.status}: ${errText.slice(0, 300)}`);
            }

            const d = await res.json();
            const content: any[] = d.content ?? [];
            const stopReason: string = d.stop_reason ?? "end_turn";

            messages = [...messages, { role: "assistant", content }];

            if (stopReason !== "tool_use") {
              finalText = content
                .filter((b: any) => b.type === "text")
                .map((b: any) => String(b.text))
                .join("");
              break;
            }

            // ── Parallel tool execution ───────────────────────
            const toolBlocks = content.filter((b: any) => b.type === "tool_use");

            // Emit thinking events immediately (sequential — UI ordering matters)
            for (const block of toolBlocks) {
              const label = block.name === "run_code"
                ? `run_code: ${String(block.input.description ?? "executing…")}`
                : `${block.name}(${JSON.stringify(block.input).slice(0, 80)})`;
              send({ thinking: label });
            }

            // Execute all tools in parallel
            const results = await Promise.all(
              toolBlocks.map(block =>
                executeTool(block.name, block.input as Record<string, unknown>, userId, adminSb, openaiKey, tavilyKey, sources)
              )
            );

            const toolResults = toolBlocks.map((block, i) => ({
              type: "tool_result",
              tool_use_id: block.id,
              content: results[i],
            }));

            messages = [...messages, { role: "user", content: toolResults }];
          }

          if (!finalText) finalText = "[Agent loop completed with no text response]";

          // ── Stream final text in chunks ───────────────────
          const CHUNK = 8;
          for (let i = 0; i < finalText.length; i += CHUNK) {
            send({ t: finalText.slice(i, i + CHUNK) });
          }

          // ── Persist conversation ──────────────────────────
          if (!conversationId) {
            const { data: c } = await adminSb
              .from("chat_conversations")
              .insert({ user_id: userId, title: `AGENT Thread — ${new Date().toLocaleDateString()}` })
              .select("id")
              .maybeSingle();
            if (c?.id) conversationId = c.id;
          }

          send({ done: true, conversationId, provider: MODEL, iterations: iteration, sources });
        } catch (err: any) {
          send({ error: err.message ?? "Agent error" });
        } finally {
          controller.close();

          // ── Memory write-back (non-blocking, best-effort) ─
          if (finalText && lastUserMsg) {
            (async () => {
              try {
                const importance = scoreImportance(lastUserMsg + " " + finalText);
                await adminSb.from("mavis_memory").insert({
                  user_id: userId,
                  content: `[AGENT] USER: ${lastUserMsg}\n\nMAVIS: ${finalText.slice(0, 4000)}`,
                  role: "exchange",
                  importance,
                  source: "mavis_agent",
                  consolidated: false,
                });
              } catch { /* non-critical */ }
            })();

            // Fact extraction — pull structured facts from the agent exchange
            if (openaiKey) {
              (async () => {
                try {
                  const factRes = await fetch("https://api.openai.com/v1/chat/completions", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
                    body: JSON.stringify({
                      model: "gpt-4o-mini",
                      max_tokens: 400,
                      messages: [
                        {
                          role: "system",
                          content: "Extract 0–3 durable facts about the user from this exchange. Return a JSON array of strings, each a concise statement. If none, return [].",
                        },
                        {
                          role: "user",
                          content: `USER: ${lastUserMsg.slice(0, 800)}\nMAVIS: ${finalText.slice(0, 1200)}`,
                        },
                      ],
                      response_format: { type: "json_object" },
                    }),
                  });
                  if (!factRes.ok) return;
                  const factData = await factRes.json();
                  const raw = factData.choices?.[0]?.message?.content ?? "{}";
                  const parsed = JSON.parse(raw);
                  const facts: string[] = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.facts) ? parsed.facts : []);
                  for (const fact of facts.slice(0, 3)) {
                    if (typeof fact !== "string" || !fact.trim()) continue;
                    const key = `fact_${fact.trim().toLowerCase().replace(/\W+/g, "_").slice(0, 40)}`;
                    await adminSb.from("mavis_tacit").upsert({
                      user_id: userId,
                      key,
                      value: fact.trim(),
                      category: "fact",
                      source: "mavis_agent_fact_extraction",
                      confidence: 0.7,
                    }, { onConflict: "user_id,key" });
                  }
                } catch { /* non-critical */ }
              })();
            }
          }
        }
      },
    });

    return new Response(sseBody, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
