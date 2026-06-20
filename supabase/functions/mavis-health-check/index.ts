// ============================================================
// MAVIS Health Check — Feature diagnostics suite
// Tests DB tables, AI providers, secrets, and storage.
// All tests are read-only; no data is mutated.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TestResult {
  id: string;
  name: string;
  category: string;
  status: "pass" | "fail" | "warn" | "skip";
  message: string;
  latency_ms: number;
}

async function runTest(
  id: string,
  name: string,
  category: string,
  fn: () => Promise<{ status: "pass" | "fail" | "warn" | "skip"; message: string }>,
): Promise<TestResult> {
  const t0 = Date.now();
  try {
    const result = await fn();
    return { id, name, category, ...result, latency_ms: Date.now() - t0 };
  } catch (e: any) {
    return { id, name, category, status: "fail", message: e?.message ?? "Unknown error", latency_ms: Date.now() - t0 };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const tests: Promise<TestResult>[] = [];

  // ── Database: Core game/profile tables ───────────────────
  const CORE_TABLES: { id: string; name: string; table: string }[] = [
    { id: "db_profiles",      name: "Profiles",          table: "profiles" },
    { id: "db_quests",        name: "Quests",            table: "quests" },
    { id: "db_tasks",         name: "Tasks",             table: "tasks" },
    { id: "db_journal",       name: "Journal",           table: "journal_entries" },
    { id: "db_vault",         name: "Vault",             table: "vault_entries" },
    { id: "db_inventory",     name: "Inventory",         table: "inventory" },
    { id: "db_skills",        name: "Skills",            table: "skills" },
    { id: "db_allies",        name: "Allies",            table: "allies" },
    { id: "db_chat",          name: "Chat Conversations", table: "chat_conversations" },
    { id: "db_messages",      name: "Chat Messages",     table: "chat_messages" },
  ];

  for (const t of CORE_TABLES) {
    tests.push(
      runTest(t.id, t.name, "Core Tables", async () => {
        const { count, error } = await (supabase as any)
          .from(t.table)
          .select("id", { count: "exact", head: true });
        if (error) return { status: "fail", message: error.message };
        return { status: "pass", message: `${count ?? 0} rows` };
      }),
    );
  }

  // ── Database: MAVIS intelligence tables ──────────────────
  const MAVIS_TABLES: { id: string; name: string; table: string }[] = [
    { id: "db_memory",        name: "MAVIS Memory",      table: "mavis_memory" },
    { id: "db_knowledge",     name: "Knowledge Graph",   table: "mavis_knowledge" },
    { id: "db_tacit",         name: "Tacit Rules",       table: "mavis_tacit" },
    { id: "db_mavis_tasks",   name: "MAVIS Tasks",       table: "mavis_tasks" },
    { id: "db_social_queue",  name: "Social Queue",      table: "mavis_social_queue" },
    { id: "db_scrape_queue",  name: "Scrape Queue",      table: "mavis_scrape_queue" },
    { id: "db_documents",     name: "RAG Documents",     table: "mavis_documents" },
    { id: "db_revenue",       name: "Revenue",           table: "mavis_revenue" },
  ];

  for (const t of MAVIS_TABLES) {
    tests.push(
      runTest(t.id, t.name, "MAVIS Tables", async () => {
        const { count, error } = await (supabase as any)
          .from(t.table)
          .select("id", { count: "exact", head: true });
        if (error) return { status: "fail", message: error.message };
        return { status: "pass", message: `${count ?? 0} rows` };
      }),
    );
  }

  // ── AI Providers: live minimal calls ─────────────────────
  const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  const GEMINI_KEY    = Deno.env.get("GEMINI_API_KEY");
  const OPENAI_KEY    = Deno.env.get("OPENAI_API_KEY");

  tests.push(
    runTest("ai_anthropic", "Anthropic Claude", "AI Providers", async () => {
      if (!ANTHROPIC_KEY) return { status: "warn", message: "ANTHROPIC_API_KEY not set" };
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 5,
          messages: [{ role: "user", content: "Reply OK" }],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { status: "fail", message: `HTTP ${res.status}: ${body.slice(0, 80)}` };
      }
      return { status: "pass", message: "Claude Haiku responsive" };
    }),
  );

  tests.push(
    runTest("ai_gemini", "Google Gemini", "AI Providers", async () => {
      if (!GEMINI_KEY) return { status: "warn", message: "GEMINI_API_KEY not set" };
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: "Reply OK" }] }],
            generationConfig: { maxOutputTokens: 5 },
          }),
        },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { status: "fail", message: `HTTP ${res.status}: ${body.slice(0, 80)}` };
      }
      return { status: "pass", message: "Gemini Flash responsive" };
    }),
  );

  tests.push(
    runTest("ai_openai", "OpenAI", "AI Providers", async () => {
      if (!OPENAI_KEY) return { status: "warn", message: "OPENAI_API_KEY not set" };
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          max_tokens: 5,
          messages: [{ role: "user", content: "Reply OK" }],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { status: "fail", message: `HTTP ${res.status}: ${body.slice(0, 80)}` };
      }
      return { status: "pass", message: "GPT-4o-mini responsive" };
    }),
  );

  // ── Integrations: secret presence checks ─────────────────
  const INTEGRATIONS: { id: string; name: string; key: string; optional?: boolean }[] = [
    { id: "int_resend",    name: "Resend (Email)",      key: "RESEND_API_KEY" },
    { id: "int_blotato",   name: "Blotato (Social)",    key: "BLOTATO_API_KEY" },
    { id: "int_heygen",    name: "HeyGen (Video)",      key: "HEYGEN_API_KEY" },
    { id: "int_telegram",  name: "Telegram Bot",        key: "TELEGRAM_BOT_TOKEN" },
    { id: "int_vapi",      name: "VAPI (Voice)",        key: "VAPI_API_KEY",   optional: true },
    { id: "int_github",    name: "GitHub Token",        key: "GITHUB_TOKEN",   optional: true },
    { id: "int_stripe",    name: "Stripe",              key: "STRIPE_SECRET_KEY", optional: true },
    { id: "int_gumroad",   name: "Gumroad",             key: "GUMROAD_ACCESS_TOKEN", optional: true },
    { id: "int_google_cal", name: "Google Calendar",   key: "GOOGLE_CLIENT_SECRET", optional: true },
    { id: "int_oura",      name: "Oura Ring",           key: "OURA_ACCESS_TOKEN", optional: true },
    { id: "int_strava",    name: "Strava",              key: "STRAVA_CLIENT_SECRET", optional: true },
  ];

  for (const s of INTEGRATIONS) {
    tests.push(
      runTest(s.id, s.name, "Integrations", async () => {
        const val = Deno.env.get(s.key);
        if (!val) {
          return s.optional
            ? { status: "skip", message: "Not configured (optional)" }
            : { status: "warn", message: `${s.key} not set` };
        }
        return { status: "pass", message: "Configured" };
      }),
    );
  }

  // ── Storage ───────────────────────────────────────────────
  tests.push(
    runTest("storage_buckets", "Storage Buckets", "Storage", async () => {
      const { data, error } = await supabase.storage.listBuckets();
      if (error) return { status: "fail", message: error.message };
      return { status: "pass", message: `${data.length} bucket(s) accessible` };
    }),
  );

  // ── Auth ─────────────────────────────────────────────────
  tests.push(
    runTest("auth_session", "Auth Session", "Auth", async () => {
      return { status: "pass", message: `Authenticated as ${user.email ?? user.id.slice(0, 8)}` };
    }),
  );

  const results = await Promise.all(tests);

  const summary = {
    total: results.length,
    pass:  results.filter((r) => r.status === "pass").length,
    fail:  results.filter((r) => r.status === "fail").length,
    warn:  results.filter((r) => r.status === "warn").length,
    skip:  results.filter((r) => r.status === "skip").length,
  };

  return new Response(JSON.stringify({ results, summary, ran_at: new Date().toISOString() }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
