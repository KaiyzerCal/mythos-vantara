// MAVIS Watchdog — catches the failures that otherwise go unnoticed for months.
//
// Two checks in one function (service-role only; called by pg_cron every 6 hours and by hand
// after a deploy):
//
//  1. SMOKE TEST (rolling, 25 functions per run, ~2h per full cycle). Sends a CORS preflight (OPTIONS, no credentials) to every function listed in
//     mavis_smoke_targets. OPTIONS boots the function but runs no job (and with no credentials a
//     function that ignores the method still stops at its own auth check). Classifies each as
//     ok | boot_error (503 BOOT_ERROR) | missing (404 NOT_FOUND) | timeout | error. A function that
//     WAS ok and now is not is a regression; any boot_error is a problem. "missing" is only a
//     problem when the function used to be ok (repo folders that were never deployed are noise).
//  2. WATCHDOG. Looks for runaway spend and silent breakage:
//       - a background job making >= 150 AI calls a day, or > $2/day total estimated spend,
//       - AI calls where every provider failed,
//       - tables growing by >1000 rows (and >50%) in a day,
//       - cron-triggered HTTP calls that keep returning errors (net._http_response).
//
// A Telegram message goes out only when something is wrong AND it differs from the last alert (or
// the last alert is 24h old). Every run is recorded in mavis_watchdog_reports.

import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { isServiceRoleCaller } from "../_shared/auth.ts";

// Defined inline: supabase-js 2.49.4 has no "/cors" export, so importing it fails to boot.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";

// Tuning knobs.
const CALLS_PER_JOB_PER_DAY = 150;
const DAILY_COST_USD = 2;
// Hard cap: past this the cost guard pauses paid background AI (see _shared/providers.ts). Alert-only below it.
const HARD_CAP_USD = 4;
const GROWTH_MIN_ROWS = 1000;
const GROWTH_MIN_RATIO = 0.5;
const SNAPSHOT_MIN_AGE_MS = 20 * 3600_000;
const REALERT_MS = 24 * 3600_000;
const WATCHED_TABLES = [
  "mavis_tasks", "approvals", "mavis_action_queue", "mavis_memory", "mavis_ambient_events",
  "mavis_agent_traces", "quests", "journal_entries", "mavis_plan_steps", "mavis_ai_usage",
];

type Sb = ReturnType<typeof createClient>;
interface Problem { id: string; kind: string; text: string }

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// ── 1. Smoke test ────────────────────────────────────────────────────────────
async function probe(name: string): Promise<{ status: string; http: number | null; detail: string }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "OPTIONS",
      headers: { Origin: "https://watchdog.invalid", "Access-Control-Request-Method": "POST" },
      signal: AbortSignal.timeout(8000),
    });
    const body = (await res.text().catch(() => "")).slice(0, 160);
    if (/rate limit exceeded/i.test(body)) return { status: "throttled", http: res.status, detail: body };
    if (res.status === 404 && /NOT_FOUND/i.test(body)) return { status: "missing", http: 404, detail: body };
    if (res.status === 503 || /BOOT_ERROR|failed to start/i.test(body)) return { status: "boot_error", http: res.status, detail: body };
    if (res.status >= 500) return { status: "error", http: res.status, detail: body };
    return { status: "ok", http: res.status, detail: "" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/rate limit exceeded/i.test(msg)) return { status: "throttled", http: null, detail: msg.slice(0, 160) };
    return { status: /timeout|abort/i.test(msg) ? "timeout" : "error", http: null, detail: msg.slice(0, 160) };
  }
}

// The platform allows ~30 outgoing calls per minute from one invocation ("Rate limit exceeded for
// trace ..."), so a run checks a batch, not all 321: the least-recently-checked functions first.
// A cron every 10 minutes cycles through everything in ~2 hours. After a deploy, pass `names`
// to check specific functions immediately.
const BATCH = 25;

async function smokeTest(sb: Sb, only?: string[]): Promise<{ problems: Problem[]; checked: number; counts: Record<string, number>; targets: number; fresh: number }> {
  const { data: targets } = await sb.from("mavis_smoke_targets").select("name");
  const all = ((targets ?? []) as { name: string }[]).map((t) => t.name).filter((n) => n !== "mavis-watchdog");
  const { data: prevRows } = await sb.from("mavis_smoke_results").select("name,status,last_ok_at,checked_at");
  const prev = new Map<string, { status: string; last_ok_at: string | null; checked_at: string }>(
    ((prevRows ?? []) as any[]).map((r) => [r.name, { status: r.status, last_ok_at: r.last_ok_at, checked_at: r.checked_at }]),
  );

  const names = (only && only.length
    ? only.filter((n) => all.includes(n))
    : [...all].sort((a, b) => (prev.get(a)?.checked_at ?? "").localeCompare(prev.get(b)?.checked_at ?? "")).slice(0, BATCH)
  ).slice(0, 30);

  const results = new Map<string, { status: string; http: number | null; detail: string }>();
  let i = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (i < names.length) {
      const name = names[i++];
      results.set(name, await probe(name));
    }
  }));

  const now = new Date().toISOString();
  const counts: Record<string, number> = {};
  const upserts: Record<string, unknown>[] = [];
  const problems: Problem[] = [];
  for (const [name, r] of results) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    if (r.status === "throttled") continue; // not a verdict: leave the old result and try again next run
    const wasOk = prev.get(name)?.last_ok_at != null;
    upserts.push({ name, status: r.status, http: r.http, detail: r.detail, checked_at: now, last_ok_at: r.status === "ok" ? now : (prev.get(name)?.last_ok_at ?? null) });
    if (r.status === "boot_error") problems.push({ id: `boot:${name}`, kind: "function won't start", text: `${name} fails to start (${r.detail.slice(0, 80)})` });
    else if (r.status === "missing" && wasOk) problems.push({ id: `missing:${name}`, kind: "function missing", text: `${name} was deployed before but is now missing (404)` });
    else if ((r.status === "error" || r.status === "timeout") && wasOk && prev.get(name)?.status === "ok") {
      problems.push({ id: `err:${name}`, kind: "function erroring", text: `${name} now ${r.status}${r.http ? ` (HTTP ${r.http})` : ""}` });
    }
  }
  if (upserts.length) await sb.from("mavis_smoke_results").upsert(upserts, { onConflict: "name" });
  const fresh = [...prev.values()].filter((v) => Date.now() - new Date(v.checked_at).getTime() < 3 * 3600_000).length;
  return { problems, checked: names.length, counts, targets: all.length, fresh };
}

// ── 2. Watchdog checks ───────────────────────────────────────────────────────
async function usageChecks(sb: Sb): Promise<Problem[]> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data } = await sb.from("mavis_ai_usage").select("label,lane,provider,est_cost_usd,success").gte("created_at", since).limit(50000);
  const rows = (data ?? []) as { label: string | null; lane: string; provider: string; est_cost_usd: number | null; success: boolean }[];
  const problems: Problem[] = [];
  const byLabel = new Map<string, { calls: number; cost: number; lane: string }>();
  let total = 0, failedAll = 0;
  for (const r of rows) {
    const cost = Number(r.est_cost_usd ?? 0);
    total += cost;
    if (!r.success && r.provider === "none") failedAll++;
    const key = r.label ?? "(unlabelled)";
    const cur = byLabel.get(key) ?? { calls: 0, cost: 0, lane: r.lane };
    cur.calls++; cur.cost += cost;
    byLabel.set(key, cur);
  }
  for (const [label, v] of byLabel) {
    // Chat messages (stream/interactive lanes) are the operator typing; background jobs should not be chatty.
    if (v.lane === "background" && v.calls >= CALLS_PER_JOB_PER_DAY) {
      problems.push({ id: `calls:${label.slice(0, 50)}`, kind: "runaway AI job", text: `"${label.slice(0, 60)}" made ${v.calls} AI calls in 24h (~$${v.cost.toFixed(2)})` });
    }
  }
  const top = [...byLabel.entries()].sort((a, b) => b[1].cost - a[1].cost).slice(0, 3)
    .map(([l, v]) => `"${l.slice(0, 40)}" ${v.calls} calls $${v.cost.toFixed(2)}`).join("; ");
  // Cost guard: set while over the hard cap, cleared when back under. 7h outlives the 6h schedule, so it never
  // lapses between runs, and it expires on its own if the watchdog itself stops.
  const over = total >= HARD_CAP_USD;
  await sb.from("mavis_provider_health").upsert({
    provider: "cost-guard",
    unhealthy_until: new Date(Date.now() + (over ? 7 * 3600_000 : -1000)).toISOString(),
    reason: over ? `24h spend $${total.toFixed(2)} >= $${HARD_CAP_USD}` : "under cap",
  }, { onConflict: "provider" });
  if (total >= DAILY_COST_USD) {
    problems.push({
      id: "spend:day", kind: "high AI spend",
      text: `Estimated AI spend $${total.toFixed(2)} in the last 24h (alert $${DAILY_COST_USD}, guard $${HARD_CAP_USD}${over ? " - COST GUARD ON: background AI paused, chat unaffected" : ""}). Top: ${top}`,
    });
  }
  if (failedAll >= 20) problems.push({ id: "allfail", kind: "AI providers failing", text: `${failedAll} AI calls in 24h failed on every provider` });
  return problems;
}

async function growthChecks(sb: Sb): Promise<Problem[]> {
  const problems: Problem[] = [];
  const now = Date.now();
  const snaps: { table_name: string; row_count: number }[] = [];
  for (const table of WATCHED_TABLES) {
    const { count, error } = await sb.from(table).select("*", { count: "exact", head: true });
    if (error || count == null) continue;
    snaps.push({ table_name: table, row_count: count });
    const { data: old } = await sb.from("mavis_watchdog_snapshots").select("row_count,taken_at")
      .eq("table_name", table).lte("taken_at", new Date(now - SNAPSHOT_MIN_AGE_MS).toISOString())
      .order("taken_at", { ascending: false }).limit(1);
    const prev = (old ?? [])[0] as { row_count: number; taken_at: string } | undefined;
    if (!prev) continue;
    const grew = count - Number(prev.row_count);
    const hours = Math.max(1, (now - new Date(prev.taken_at).getTime()) / 3600_000);
    const perDay = grew * (24 / hours);
    if (perDay > GROWTH_MIN_ROWS && grew > Number(prev.row_count) * GROWTH_MIN_RATIO) {
      problems.push({ id: `growth:${table}`, kind: "table growing fast", text: `${table} grew by ${grew} rows in ${hours.toFixed(0)}h (${prev.row_count} → ${count})` });
    }
  }
  // Keep a week of history; one snapshot per run is plenty.
  if (snaps.length) await sb.from("mavis_watchdog_snapshots").insert(snaps);
  await sb.from("mavis_watchdog_snapshots").delete().lt("taken_at", new Date(now - 8 * 86400_000).toISOString());
  return problems;
}

async function cronHttpChecks(sb: Sb): Promise<Problem[]> {
  const { data, error } = await sb.rpc("mavis_cron_http_errors", { hours: 6 });
  if (error) return [];
  return ((data ?? []) as { status_code: number; n: number; sample: string }[])
    .filter((r) => Number(r.n) >= 5)
    .map((r) => ({ id: `http:${r.status_code}:${String(r.sample).slice(0, 40)}`, kind: "scheduled calls failing", text: `${r.n} scheduled calls in 6h returned HTTP ${r.status_code}: ${String(r.sample).slice(0, 80)}` }));
}


// Things MAVIS or the app added that should be fully integrated but are not: a malformed Beyonder pathway,
// journal entries nothing has emotion-tagged, new skills that never got a search embedding.
async function integrityChecks(sb: Sb): Promise<Problem[]> {
  const problems: Problem[] = [];
  const { data: bey } = await sb.rpc("mavis_beyonder_audit");
  for (const r of (bey ?? []) as { pathway: string; problem: string }[]) {
    problems.push({ id: `bey:${r.pathway}:${r.problem}`.slice(0, 90), kind: "pathway malformed", text: `${r.pathway}: ${r.problem}` });
  }
  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count: untagged } = await sb.from("journal_entries").select("*", { count: "exact", head: true })
    .or("emotion_tagged.is.null,emotion_tagged.eq.false").is("emotion_scores", null).lt("created_at", dayAgo);
  if ((untagged ?? 0) > 5) problems.push({ id: "emotion:backlog", kind: "emotion tagging stalled", text: `${untagged} journal entries older than a day are still untagged` });
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { count: unembedded } = await sb.from("skills").select("*", { count: "exact", head: true }).is("embedding", null).lt("created_at", hourAgo);
  if ((unembedded ?? 0) > 0) problems.push({ id: "embed:skills", kind: "skills not searchable", text: `${unembedded} skills older than an hour have no search embedding (quest auto-linking cannot find them)` });
  return problems;
}

// ── Alerting ─────────────────────────────────────────────────────────────────
async function sendTelegram(text: string): Promise<boolean> {
  if (!BOT_TOKEN || !CHAT_ID) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text: text.slice(0, 3800) }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch { return false; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!isServiceRoleCaller(req)) return json({ error: "Unauthorized" }, 401);
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  try {
    const body = await req.json().catch(() => ({}));
    const mode = String(body.mode ?? "all"); // all | smoke | watchdog
    const problems: Problem[] = [];
    let smoke: { checked: number; counts: Record<string, number>; targets: number; fresh: number } | null = null;

    if (mode === "all" || mode === "smoke") {
      const s = await smokeTest(sb, Array.isArray(body.names) ? body.names.map(String) : undefined);
      problems.push(...s.problems);
      smoke = { checked: s.checked, counts: s.counts, targets: s.targets, fresh: s.fresh };
    }
    if (mode === "all" || mode === "watchdog") {
      for (const check of [usageChecks, growthChecks, cronHttpChecks, integrityChecks]) {
        try { problems.push(...await check(sb)); } catch (err) { console.warn("[watchdog] check failed:", err instanceof Error ? err.message : err); }
      }
    }

    // Alert only on a new or day-old set of problems.
    const alertKey = problems.map((p) => p.id).sort().join("|");
    let alerted = false;
    if (problems.length > 0 && body.alert !== false) {
      const { data: last } = await sb.from("mavis_watchdog_reports").select("alert_key,created_at,alerted")
        .eq("alerted", true).order("created_at", { ascending: false }).limit(1);
      const prev = (last ?? [])[0] as { alert_key: string; created_at: string } | undefined;
      const stale = !prev || prev.alert_key !== alertKey || Date.now() - new Date(prev.created_at).getTime() > REALERT_MS;
      if (stale) {
        alerted = await sendTelegram(
          `MAVIS watchdog — ${problems.length} problem${problems.length > 1 ? "s" : ""}:\n` +
          problems.slice(0, 12).map((p) => `• ${p.kind}: ${p.text}`).join("\n") +
          (problems.length > 12 ? `\n…and ${problems.length - 12} more` : ""),
        );
      }
    }
    // The rolling smoke test runs every 10 minutes; only record it when it found something.
    if (mode !== "smoke" || problems.length > 0) await sb.from("mavis_watchdog_reports").insert({ problems, alert_key: alertKey || null, alerted });

    return json({ ok: true, mode, smoke, problems, alerted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[watchdog]", msg);
    return json({ error: msg }, 500);
  }
});
