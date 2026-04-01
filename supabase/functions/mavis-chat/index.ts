import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Provider endpoints ─────────────────────────────────────
const OPENAI_URL   = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const XAI_URL      = "https://api.x.ai/v1/chat/completions";
const LOVABLE_URL  = "https://ai.gateway.lovable.dev/v1/chat/completions";

type Provider = "openai" | "anthropic" | "xai" | "lovable";

interface ModelRoute {
  provider: Provider;
  model: string;
}

// ── Model routing per mode ─────────────────────────────────
const MODE_MODEL_MAP: Record<string, ModelRoute> = {
  PRIME:      { provider: "openai",    model: "gpt-4o-mini" },
  ARCH:       { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  QUEST:      { provider: "openai",    model: "gpt-4o-mini" },
  FORGE:      { provider: "openai",    model: "gpt-4o-mini" },
  CODEX:      { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  SOVEREIGN:  { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  ENRYU:      { provider: "openai",    model: "gpt-4o-mini" },
  WATCHTOWER: { provider: "xai",       model: "grok-3-mini" },
};

const DEFAULT_ROUTE: ModelRoute = { provider: "openai", model: "gpt-4o-mini" };

type MavisAction = {
  type: string;
  params: Record<string, unknown>;
};

// ── Get API key for provider ───────────────────────────────
function getKeyAndUrl(provider: Provider): { apiKey: string; apiUrl: string } {
  switch (provider) {
    case "anthropic": {
      const k = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
      if (!k) throw new Error("ANTHROPIC_API_KEY not set");
      return { apiKey: k, apiUrl: ANTHROPIC_URL };
    }
    case "xai": {
      const k = Deno.env.get("XAI_API_KEY") ?? "";
      if (!k) throw new Error("XAI_API_KEY not set");
      return { apiKey: k, apiUrl: XAI_URL };
    }
    case "openai": {
      const k = Deno.env.get("OPENAI_API_KEY") ?? "";
      if (!k) throw new Error("OPENAI_API_KEY not set");
      return { apiKey: k, apiUrl: OPENAI_URL };
    }
    case "lovable": {
      const k = Deno.env.get("LOVABLE_API_KEY") ?? "";
      if (!k) throw new Error("LOVABLE_API_KEY not set");
      return { apiKey: k, apiUrl: LOVABLE_URL };
    }
  }
}

// ── Tavily web search ──────────────────────────────────────
async function tavilySearch(query: string): Promise<string> {
  const TAVILY_API_KEY = Deno.env.get("TAVILY_API_KEY");
  if (!TAVILY_API_KEY) {
    console.warn("TAVILY_API_KEY not set, skipping web search");
    return "";
  }
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: TAVILY_API_KEY, query, search_depth: "basic", max_results: 5 }),
    });
    if (!res.ok) { console.error("Tavily error:", res.status, await res.text()); return ""; }
    const data = await res.json();
    if (!data.results?.length) return "";
    return `\n[WEB SEARCH RESULTS for "${query}"]\n` +
      data.results.map((r: any, i: number) => `[${i + 1}] ${r.title}\n${r.content}\nSource: ${r.url}`).join("\n\n") + "\n";
  } catch (e) { console.error("Tavily search failed:", e); return ""; }
}

// ── Detect if message needs web search ────────────────────
function needsWebSearch(message: string): string | null {
  const lower = message.toLowerCase();
  const triggers = [
    "search for", "look up", "what is happening", "current events",
    "latest news", "today's", "right now", "real-time", "realtime",
    "search the web", "google", "find out about", "what's new",
    "recent news", "breaking news", "weather", "stock price",
    "score", "election", "trending", "latest", "current",
  ];
  return triggers.some((t) => lower.includes(t)) ? message : null;
}

// ── Auto-detect Grok routing for real-time queries ────────
function shouldForceGrok(message: string): boolean {
  const lower = message.toLowerCase();
  const grokTriggers = [
    "what is happening", "real-time", "realtime", "live update",
    "right now", "breaking", "trending", "current events",
    "latest news", "what's going on", "today's news",
  ];
  return grokTriggers.some((t) => lower.includes(t));
}

function parseEmbeddedActions(text: string): { clean: string; actions: MavisAction[] } {
  const actions: MavisAction[] = [];
  const clean = text.replace(/:::ACTION(\{[\s\S]*?\}):::/g, (_, json) => {
    try {
      const parsed = JSON.parse(json);
      if (parsed && typeof parsed.type === "string") {
        actions.push({
          type: parsed.type,
          params: parsed.params && typeof parsed.params === "object" ? parsed.params : {},
        });
      }
    } catch (error) {
      console.warn("[mavis-chat] Failed to parse embedded action", error);
    }
    return "";
  }).trim();

  return { clean, actions };
}

// ── Check if the latest user message has CRUD intent ────────
function hasCrudIntent(message: string): boolean {
  const lower = message.toLowerCase().trim();
  
  // Skip very short casual messages
  if (lower.length < 4) return false;
  
  // Explicit "just do it" / "execute" messages — these reference a PENDING action
  const executeTriggers = ["execute", "do it", "go ahead", "confirm", "run it", "yes do it", "proceed", "make it happen"];
  if (executeTriggers.some((t) => lower === t || lower === t + " now" || lower === t + " please")) return true;
  
  // Skip greetings, status checks, questions, and casual chat
  const casualPatterns = [
    /^(hey|hi|hello|yo|sup|what'?s up|good morning|good evening|gm|gn)/,
    /^(how are you|how's it going|what's good|status|check|tell me|explain|why|who|where|when|how|what do you think)/,
    /^(thanks|thank you|ok|okay|cool|nice|got it|understood|bet|word|dope|fire)/,
    /^(remember|recall|last time|previously)/,
    /\?$/, // questions don't trigger CRUD
  ];
  if (casualPatterns.some((p) => p.test(lower))) return false;
  
  // CRUD action keywords
  const crudTriggers = [
    "create", "add", "make", "new", "build", "generate", "write", "log",
    "update", "edit", "modify", "change", "set", "adjust", "rename",
    "delete", "remove", "destroy", "clear", "drop",
    "complete", "finish", "mark", "award", "give",
    "equip", "unequip",
  ];
  
  // Must have a CRUD verb
  const words = lower.split(/\s+/);
  const hasCrudVerb = crudTriggers.some((trigger) => words.some((w) => w === trigger || w.startsWith(trigger)));
  if (!hasCrudVerb) return false;
  
  // Must reference an app entity
  const entityKeywords = [
    "quest", "task", "skill", "subskill", "journal", "vault", "council",
    "inventory", "item", "energy", "ally", "allies", "ritual", "transformation",
    "form", "ranking", "store", "bpm", "profile", "stat", "stats",
    "xp", "level", "rank", "entry", "member", "session",
  ];
  return entityKeywords.some((entity) => lower.includes(entity));
}

async function inferActionsFromConversation(messages: Array<{ role: string; content: string }>, appState?: string): Promise<MavisAction[]> {
  const apiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  if (!apiKey || messages.length === 0) return [];

  // Only infer if the latest user message has CRUD intent
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUserMsg || !hasCrudIntent(lastUserMsg.content)) {
    console.log("[mavis-chat] No CRUD intent detected, skipping action inference");
    return [];
  }

  // Only use the last 4 messages to avoid stale context pollution
  const recentMessages = messages.slice(-4).map((message) => ({
    role: message.role,
    content: String(message.content ?? ""),
  }));

  const extractorPrompt = `You convert chat intent into structured app CRUD actions.
Return JSON only in exactly this shape: {"actions":[{"type":"action_name","params":{}}]}.
If there is no clear action to execute, return {"actions":[]}.

Rules:
- ONLY look at the LATEST user message to determine what action to take.
- If the latest user message is "execute", "do it", "go ahead", or similar, look at the IMMEDIATELY PRECEDING user message for the actual CRUD request. Ignore older history.
- If the latest user message clearly requests creating, updating, or deleting something, infer that ONE action.
- Do NOT infer multiple actions unless the user explicitly asked for multiple things in their LATEST message.
- Do NOT infer actions from old conversation history that has already been addressed.
- When in doubt, return {"actions":[]}.
- Only use supported action types.
- Use sensible defaults when the user omitted optional fields.
- Preserve the user's naming as closely as possible.
- Return valid JSON only. No markdown.

Supported action types:
create_quest, update_quest, complete_quest, delete_quest,
create_task, complete_task, delete_task, update_task,
create_skill, create_subskill, update_skill, delete_skill,
create_journal, update_journal, delete_journal,
create_vault, update_vault, delete_vault,
create_council_member, update_council_member, delete_council_member,
create_inventory_item, update_inventory_item, delete_inventory_item,
update_energy, create_energy, delete_energy,
create_ally, update_ally, delete_ally,
create_ritual, update_ritual, delete_ritual, complete_ritual,
create_transformation, update_transformation, delete_transformation,
create_ranking, update_ranking, delete_ranking,
create_store_item, update_store_item, delete_store_item,
log_bpm_session, update_profile, award_xp.

Default params when missing:
- create_inventory_item: {"description":"","type":"equipment","rarity":"common","quantity":1}
- create_store_item: {"description":"","price":100,"currency":"Codex Points","rarity":"common","category":"consumable"}
- create_journal: {"content":"","tags":[],"category":"personal","importance":"medium","xp_earned":10}
- create_vault: {"content":"","category":"personal","importance":"medium"}
- create_skill: {"description":"","category":"General","energy_type":"Emerald Flames","tier":1}
- create_quest: {"description":"","type":"side","difficulty":"Normal","xp_reward":100}
- create_council_member: {"role":"Member","class":"advisory","notes":""}
- create_ranking: {"role":"npc","rank":"D","level":1,"jjk_grade":"G4","op_tier":"Local","gpr":1000,"pvp":5000,"influence":"Local","notes":"","is_self":false}
- create_energy: {"description":"","color":"#08C284","current_value":100,"max_value":100}
- create_ally: {"relationship":"ally","level":1,"specialty":"General","affinity":50,"notes":""}
- create_ritual: {"description":"","type":"other","xp_reward":25}
- create_transformation: {"tier":"Base","form_order":0,"bpm_range":"65–75","energy":"Ki","jjk_grade":"Special Grade","op_tier":"God Tier","unlocked":false}

Extra guidance:
- "inventory" or "item in my inventory" means create_inventory_item, not store_item.
- "store" or "item in the store" means create_store_item, not inventory_item.
- "rankings" means create_ranking, not create_transformation.
- "forms" or "transformations" means create_transformation.
- "journal entry about X" should create_journal with title mentioning X and content about X.
- "vault entry about X" should create_vault with title mentioning X.
- ALWAYS extract the item/entity NAME from the user message. "create an inventory item called Timekeeper's Watch" → name: "Timekeeper's Watch".
- ALWAYS include "name", "title", or "display_name" in params — never omit the name the user specified.
- For create_inventory_item: always include "name" param.
- For create_store_item: always include "name" param.
- For create_ranking: always include "display_name" param.
- For create_journal: always include "title" param.
- For create_vault: always include "title" param.
- For create_quest: always include "title" param.
- For create_skill: always include "name" param.
- For create_council_member: always include "name" param.
- For create_ally: always include "name" param.
- For update_quest, complete_quest, delete_quest: ALWAYS include "quest_id" from the APP STATE IDs below. If you cannot find the exact ID, include "quest_name" with the quest title so the backend can look it up.
- For update_skill, delete_skill: include "skill_id". If unknown, include "skill_name".
- For update_journal, delete_journal: include "entry_id". If unknown, include "entry_title".
- For update_vault, delete_vault: include "entry_id". If unknown, include "entry_title".
- For update_inventory_item, delete_inventory_item: include "item_id". If unknown, include "item_name".
- For update_council_member, delete_council_member: include "member_id". If unknown, include "member_name".
- For update_ally, delete_ally: include "ally_id". If unknown, include "ally_name".
- For update_ranking, delete_ranking: include "ranking_id". If unknown, include "ranking_name".
- For update_transformation, delete_transformation: include "transformation_id". If unknown, include "transformation_name".`;

  // Append app state if available so inferrer can resolve names → IDs
  const appStateContext = appState ? `\n\nAPP STATE (use these IDs in params):\n${appState}` : "";

  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: extractorPrompt + appStateContext },
        {
          role: "user",
          content: `Infer actions from this conversation history:\n${JSON.stringify(recentMessages)}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    console.error("[mavis-chat] action inference failed", response.status, await response.text());
    return [];
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.actions)) return [];
    return parsed.actions
      .filter((action: any) => action && typeof action.type === "string")
      .map((action: any) => ({
        type: action.type,
        params: action.params && typeof action.params === "object" ? action.params : {},
      }));
  } catch (error) {
    console.error("[mavis-chat] could not parse inferred actions", error, raw);
    return [];
  }
}

// ── Call Anthropic (Messages API) ─────────────────────────
async function callAnthropic(apiKey: string, model: string, systemPrompt: string, messages: any[]): Promise<string> {
  const anthropicMessages = messages.map((m: any) => ({ role: m.role === "system" ? "user" : m.role, content: m.content }));

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      system: systemPrompt,
      messages: anthropicMessages,
      max_tokens: 2048,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Anthropic API error:", res.status, err);
    if (res.status === 429) throw { status: 429, message: "Rate limited — please wait and try again." };
    throw new Error(`Anthropic API error: ${err}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text ?? "No response generated.";
}

// ── Call OpenAI-compatible API (OpenAI / xAI / Lovable) ───
async function callOpenAICompatible(apiKey: string, apiUrl: string, model: string, systemPrompt: string, messages: any[]): Promise<string> {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.map((m: any) => ({ role: m.role, content: m.content })),
      ],
      max_completion_tokens: 2048,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`${apiUrl} error:`, res.status, err);
    if (res.status === 429) throw { status: 429, message: "Rate limited — please wait and try again." };
    if (res.status === 402) throw { status: 402, message: "AI credits exhausted. Add funds in Settings → Workspace → Usage." };
    throw new Error(`AI API error: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "No response generated.";
}

// ── Main handler ──────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, systemPrompt, mode, conversationId, appState } = await req.json();

    // ── Resolve route (with auto-Grok detection) ──
    let route = MODE_MODEL_MAP[mode] ?? DEFAULT_ROUTE;

    const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user");
    if (lastUserMsg && shouldForceGrok(lastUserMsg.content)) {
      const xaiKey = Deno.env.get("XAI_API_KEY");
      if (xaiKey) {
        route = { provider: "xai", model: "grok-3-mini" };
        console.log(`[mavis-chat] Auto-routing to Grok for real-time query`);
      }
    }

    console.log(`[mavis-chat] mode=${mode} → provider=${route.provider} model=${route.model}`);

    // ── Tavily search if needed ──
    let webSearchResults = "";
    if (lastUserMsg) {
      const searchQuery = needsWebSearch(lastUserMsg.content);
      if (searchQuery) webSearchResults = await tavilySearch(searchQuery);
    }

    const fullSystemPrompt = webSearchResults
      ? `${systemPrompt}\n\n---\nWEB SEARCH RESULTS (use these to answer the user's current query):\n${webSearchResults}\n---`
      : systemPrompt;

    // ── Route to the correct provider ──
    const { apiKey, apiUrl } = getKeyAndUrl(route.provider);
    let content: string;

    if (route.provider === "anthropic") {
      content = await callAnthropic(apiKey, route.model, fullSystemPrompt, messages);
    } else {
      content = await callOpenAICompatible(apiKey, apiUrl, route.model, fullSystemPrompt, messages);
    }

    const parsedResponse = parseEmbeddedActions(content);
    const inferredActions = parsedResponse.actions.length > 0
      ? parsedResponse.actions
      : await inferActionsFromConversation(messages, appState);

    return new Response(
      JSON.stringify({
        content: parsedResponse.clean || content,
        actions: inferredActions,
        mode,
        model: route.model,
        provider: route.provider,
        conversationId,
        searched: !!webSearchResults,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("mavis-chat error:", err);
    const status = err.status ?? 500;
    return new Response(
      JSON.stringify({ error: err.message ?? String(err) }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
