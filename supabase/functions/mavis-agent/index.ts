import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Allowed tables ────────────────────────────────────────────────────────────
const READ_TABLES = new Set([
  "quests", "tasks", "skills", "rituals", "allies", "inventory",
  "journal_entries", "vault_entries", "mavis_notes", "mavis_memory",
  "mavis_tacit", "mavis_tasks", "energy_systems", "bpm_sessions",
  "store_items", "transformations",
]);

const WRITE_TABLES = new Set([
  "quests", "tasks", "rituals", "mavis_notes", "mavis_memory", "mavis_tasks",
]);

// ── Tool schema ───────────────────────────────────────────────────────────────
const AGENT_TOOLS = [
  {
    name: "query_db",
    description:
      "Query a MAVIS database table. Use to look up the operator's quests, tasks, skills, rituals, allies, inventory, notes, memories, or tacit rules. Always query before claiming something doesn't exist.",
    input_schema: {
      type: "object" as const,
      properties: {
        table: {
          type: "string",
          description: `Table name. Allowed: ${[...READ_TABLES].join(", ")}`,
        },
        filters: {
          type: "object",
          description: "Key-value equality filters (e.g. {\"status\": \"active\"})",
        },
        columns: {
          type: "string",
          description: "Columns to select (default '*')",
        },
        limit: {
          type: "number",
          description: "Max rows (default 20, max 100)",
        },
        order_by: {
          type: "string",
          description: "Column to sort by (e.g. 'created_at')",
        },
        ascending: {
          type: "boolean",
          description: "Sort direction — true = oldest first, false = newest first (default false)",
        },
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
        threshold: {
          type: "number",
          description: "Similarity threshold 0–1 (default 0.6). Lower returns more, potentially less relevant results.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "web_search",
    description:
      "Search the live web for current information — news, prices, events, documentation. Use when the query requires information from after your training cutoff or real-time data.",
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
        table: {
          type: "string",
          description: `Table name. Allowed for writes: ${[...WRITE_TABLES].join(", ")}`,
        },
        data: {
          type: "object",
          description: "Record fields. Do NOT include user_id — it is injected automatically.",
        },
        on_conflict: {
          type: "string",
          description: "Column(s) for upsert dedup (e.g. 'id'). Omit for pure insert.",
        },
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
];

// ── Tool executor ─────────────────────────────────────────────────────────────
async function executeTool(
  name: string,
  input: Record<string, unknown>,
  userId: string,
  adminSb: ReturnType<typeof createClient>,
  openaiKey: string,
  tavilyKey: string,
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

        if (!READ_TABLES.has(table)) {
          return JSON.stringify({ error: `Table '${table}' is not accessible` });
        }
        let q = adminSb.from(table).select(columns).eq("user_id", userId).limit(limit);
        for (const [k, v] of Object.entries(filters)) {
          q = q.eq(k, v as string);
        }
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
        if (!embedRes.ok) {
          return JSON.stringify({ error: `Embedding failed: ${embedRes.status}` });
        }
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
        return JSON.stringify(results);
      }

      case "upsert_record": {
        const table = String(input.table ?? "");
        const data = (input.data ?? {}) as Record<string, unknown>;
        const onConflict = input.on_conflict ? String(input.on_conflict) : undefined;

        if (!WRITE_TABLES.has(table)) {
          return JSON.stringify({ error: `Writing to '${table}' is not permitted` });
        }
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
        const { data, error } = await adminSb
          .from("mavis_notes")
          .select("*")
          .eq("id", noteId)
          .eq("user_id", userId)
          .maybeSingle();
        if (error) return JSON.stringify({ error: error.message });
        if (!data) return JSON.stringify({ error: "Note not found" });
        return JSON.stringify(data);
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
          let iteration = 0;
          let finalText = "";

          // ── ReAct loop ─────────────────────────────────────
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

            // Append assistant turn for next iteration
            messages = [...messages, { role: "assistant", content }];

            if (stopReason !== "tool_use") {
              finalText = content
                .filter((b: any) => b.type === "text")
                .map((b: any) => String(b.text))
                .join("");
              break;
            }

            // Execute each tool call and collect results
            const toolResults: any[] = [];
            for (const block of content) {
              if (block.type !== "tool_use") continue;
              const toolLabel = `${block.name}(${JSON.stringify(block.input).slice(0, 80)})`;
              send({ thinking: toolLabel });
              const result = await executeTool(
                block.name,
                block.input as Record<string, unknown>,
                userId,
                adminSb,
                openaiKey,
                tavilyKey,
              );
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: result,
              });
            }

            messages = [...messages, { role: "user", content: toolResults }];
          }

          if (!finalText) finalText = "[Agent loop completed with no text response]";

          // ── Stream final text in chunks ───────────────────
          // ~8-char chunks so the streaming bubble feels live
          const CHUNK = 8;
          for (let i = 0; i < finalText.length; i += CHUNK) {
            send({ t: finalText.slice(i, i + CHUNK) });
          }

          // ── Persist conversation ──────────────────────────
          let conversationId = inConvoId;
          if (!conversationId) {
            const { data: c } = await adminSb
              .from("chat_conversations")
              .insert({
                user_id: userId,
                title: `AGENT Thread — ${new Date().toLocaleDateString()}`,
              })
              .select("id")
              .maybeSingle();
            if (c?.id) conversationId = c.id;
          }

          send({ done: true, conversationId, provider: MODEL, iterations: iteration });
        } catch (err: any) {
          send({ error: err.message ?? "Agent error" });
        } finally {
          controller.close();
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
