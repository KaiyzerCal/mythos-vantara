import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Response type classification ─────────────────────────────
function classifyQuery(q: string): string {
  const s = q.toLowerCase();
  if (/strateg|position|approach|tactic|move|leverage|advantage/.test(s)) return "Strategy";
  if (/analyz|assess|review|evaluat|breakdown|status|audit/.test(s)) return "Analysis";
  if (/data|metric|number|stat|percent|rate|ratio|measure/.test(s)) return "Data";
  if (/insight|pattern|trend|signal|observ|notice|detect/.test(s)) return "Insight";
  if (/risk|threat|warn|alert|danger|concern|flag/.test(s)) return "Alert";
  if (/brief|update|summary|today|morning|report|week/.test(s)) return "Brief";
  return "Brief";
}

// ── Curated demo responses (fallback when no LLM key is set) ─
const POOL: Record<string, string[]> = {
  Strategy: [
    `Three vectors warrant activation this cycle. Your resource allocation is front-heavy — peak output concentrates in the first 60% of the day with consistent diminishing returns after 14:00. The fix isn't discipline; it's architecture. Restructure the afternoon block as a synthesis window: no creation, only connection of what already exists. The compound value of that single shift is routinely underestimated.

Your skill stack has an asymmetry between technical depth and external visibility. Capability is outpacing signal — you are building things that aren't yet legible to the people who should see them. One high-signal output per week, designed to demonstrate mastery without over-explaining it, closes that gap faster than continuing to build in silence.

Decision fatigue is costing approximately 15–20% of your peak cognitive window. Three recurring decisions can be systematized this week without sacrificing control. Every automated choice is reclaimed bandwidth, and bandwidth is the real constraint.`,

    `Current positioning analysis: primary arc advancing at 0.7x projected velocity. The drag is not motivation — activation data is consistent — it's context-switching overhead. Three arc-parallel tasks are running simultaneously with no shared interface, which means full mental context must be rebuilt each time you switch. Collapsing them into a single dedicated window reduces friction by an estimated 40%.

One underutilized leverage point: your network has two individuals with direct access to the domain your next phase requires. Neither has been engaged as a resource. Targeted, specific outreach beats passive relationship maintenance by a wide margin. This is not about asking for favors — it's about activating what already exists in your orbit.

Your risk register has one gap: there is no contingency mapped for your primary constraint scenario. The probability is low but the impact is asymmetric. Thirty minutes of scenario mapping now is worth weeks of reactive recovery later.`,
  ],

  Analysis: [
    `Structural assessment complete. Your operational tempo is sound, but recovery cycles are underweighted relative to output. The pattern: consistent high-output periods followed by 48–72 hour deceleration phases. This isn't failure — it's unstructured periodization. Making it intentional would raise your sustainable baseline by an estimated 18–22%.

Your goal architecture has strong vertical alignment — short-term tasks map cleanly to medium-term arcs — but weak horizontal integration. Multiple arcs are running in parallel with no crossover leverage being captured. One synthesis action per arc-pair would accelerate both simultaneously at near-zero additional cost.

Two active priorities carry soft deadlines with no consequence mechanism. Without compression pressure, they will drift. Converting both to hard checkpoints within 72 hours is the minimum effective intervention. The architecture is sound; the forcing function is missing.`,

    `Pattern analysis across current activity data reveals a consistent inverse relationship between reactive communication load and meaningful output. On days where externally-initiated messages dominate the first 90 minutes, deep work completion drops 34% by end of day. This is not willpower failure — it is context contamination. The operating system is being preloaded with other people's priorities before your own are established.

Habit stack compliance sits at 71% overall, but with a significant variance across time blocks. Morning protocol adherence is at 89% — your highest performing window. Evening wind-down adherence is at 58% — your lowest. The asymmetry matters because sleep quality directly gates next-day cognitive availability. The leverage point is not adding more morning discipline; it is protecting the evening system that makes morning discipline possible.

One anomaly worth flagging: skill development sessions consistently occur later in the day than scheduled, which means they're often executed in a depleted state. The content of the sessions is high quality, but the timing is costing approximately 15% of potential retention.`,
  ],

  Data: [
    `Current system metrics processed. Focus efficiency: 78% of intended deep work blocks executed over the last 14 days — above personal baseline by 11 points, statistically significant improvement.

Skill progression: primary development arc at 63% toward tier advancement. Projected completion at current velocity: 18–23 days. Secondary arc at 41%, projected 31–38 days. Both within acceptable range.

Energy systems: morning activation protocol at 89% adherence, strongest zone. Evening wind-down at 58%, lowest zone and highest-leverage improvement target. BPM session data shows peak performance window between 09:00–11:30 and 15:00–16:30.

Quest completion rate: 71% this cycle. The 29% incomplete splits 2:1 between abandoned and deferred. The abandoned items warrant a pattern review — they cluster around a single theme. One anomaly: content output velocity and quest completion rate move inversely over the last six weeks. When output increases, completion drops. Attention fragmentation is the most likely cause.`,
  ],

  Insight: [
    `Pattern detected across 14 days of activity data. There is a consistent correlation between your highest-output days and two preceding conditions: uninterrupted input time in the first 45 minutes and a written intention statement before 09:00. These are not causes in the classical sense — they are signals that your system has been primed for depth. The mechanism is cognitive: you are loading the operating context before external noise can contaminate it.

The inverse pattern is equally consistent. Days where reactive communication dominates the first two hours show a 34% reduction in meaningful output by day's end. Not because you ran out of time, but because the decision-making architecture was already fragmented before the important work began.

The insight to operationalize: your first 90 minutes are not a warm-up. They are the whole game. Everything after that is momentum management. Protecting that window is not a preference — it is the highest-leverage structural change available.`,

    `Three signals emerged from cross-arc pattern analysis that individually appear unrelated but form a coherent picture together. First: your skill acquisition rate is highest immediately following completion of a quest — the 48-hour window post-completion shows 40% higher retention. Second: your quest completion rate drops when you have more than four active tasks running simultaneously. Third: your energy systems are most stable on days with the fewest decision points before noon.

The coherent picture: your system performs best when it has clear completion loops, minimal parallel load, and a protected morning state. These are not preferences — they are architectural requirements of your specific cognitive profile. Building toward them is not about discipline; it is about designing conditions where your natural performance emerges.

One actionable implication: the habit of immediately starting a new quest after completing one is working against the consolidation window. A 48-hour integration pause between completion and new arc activation would yield compound returns.`,
  ],

  Alert: [
    `Risk flag registered. Two items in your current queue have crossed from "approaching" to "at" their soft deadline windows without resolution. The pattern: both were added during a high-momentum phase and neither has been touched since. This is characteristic of a planning-execution gap — tasks acquired during expansion cycles that have no assigned activation condition in contraction cycles.

The downstream risk is not the tasks themselves — individually they're manageable. The risk is precedent. Soft deadlines that consistently pass without consequence train the system to treat all deadlines as soft. Once that pattern is established, the planning architecture loses its forcing function.

Recommended intervention: 15-minute triage session within 24 hours. Each item gets one of three outcomes — execute this week with a specific slot assigned, defer with a new hard date, or eliminate entirely. No item should leave triage in its current state. The cost of this session is low; the cost of not having it compounds.`,
  ],

  Brief: [
    `MAVIS Daily Brief.

Operational conditions: favorable for high-complexity work. Recent performance data shows sustained focus duration up 12% over the previous two weeks. This is a compounding signal — the conditions that produced it should be protected, not disrupted.

Priority stack for today: one anchoring task that advances your primary arc, two maintenance actions to preserve existing momentum, and one strategic input — something that feeds future capability rather than current output. That ratio keeps the system advancing without depleting the reserve.

One item in your backlog has gone stale. It requires a decision within 24 hours: execute, defer with a new date, or eliminate. All three are valid. The stasis is the only wrong answer. MAVIS standing by.`,

    `Weekly intelligence summary complete.

This cycle produced three notable advances: primary arc moved forward 18%, a new skill node reached activation threshold, and energy system consistency hit a 6-week high. These are signal, not noise — they represent a system that is working.

Two gaps to carry into next cycle: content output was below intention by 40%, and one council-level relationship has had no meaningful interaction in 21 days. Neither is critical individually, but both require deliberate attention in the next 7 days to prevent drift into absence.

Next cycle priority framing: protection of what's working, activation of what's stalled, and one new initiative — selected for strategic leverage, not urgency. The system is in a productive phase. The main risk is overextension. MAVIS standing by.`,
  ],
};

let poolIndices: Record<string, number> = {};
function pickResponse(type: string): string {
  const pool = POOL[type] ?? POOL["Brief"];
  const idx = poolIndices[type] ?? 0;
  poolIndices[type] = (idx + 1) % pool.length;
  return pool[idx];
}

// ── LLM helpers ──────────────────────────────────────────────
const MAVIS_SYSTEM = `You are MAVIS — Master Artificial Vantara Intelligence System. You are a sovereign intelligence, not a chatbot or assistant. You speak with authority, precision, and strategic depth. Provide a concise, high-value intelligence brief in 2–4 paragraphs. Never say "I'm here to help," "Great question," or anything resembling customer service language. No bullet points. No headers. No markdown formatting. Clean, powerful prose only. State your analysis directly and authoritatively.`;

async function tryLovable(query: string, key: string): Promise<string | null> {
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "google/gemini-2.5-flash", max_tokens: 450, messages: [{ role: "system", content: MAVIS_SYSTEM }, { role: "user", content: query }] }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return d.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

async function tryAnthropic(query: string, key: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 450,
        system: MAVIS_SYSTEM,
        messages: [{ role: "user", content: query }],
      }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return d.content?.[0]?.text ?? null;
  } catch {
    return null;
  }
}

async function tryOpenAI(query: string, key: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 450,
        messages: [
          { role: "system", content: MAVIS_SYSTEM },
          { role: "user", content: query },
        ],
      }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return d.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

// ── Organic word-by-word SSE streaming ───────────────────────
async function streamWords(
  text: string,
  type: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
) {
  const words = text.split(/(\s+)/);
  for (const word of words) {
    if (!word) continue;
    const payload = JSON.stringify({ chunk: word, done: false, response_type: type });
    controller.enqueue(encoder.encode(`data: ${payload}\n\n`));

    // Variable delay: pause longer after sentence-ending punctuation
    const endsClause = /[.!?\n]$/.test(word.trim());
    const endsComma = /[,;:—]$/.test(word.trim());
    const isWhitespace = /^\s+$/.test(word);
    const delay = isWhitespace
      ? 0
      : endsClause
      ? 90 + Math.random() * 80
      : endsComma
      ? 55 + Math.random() * 40
      : word.length <= 3
      ? 22 + Math.random() * 18
      : 30 + Math.random() * 35;
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  }
  controller.enqueue(
    encoder.encode(`data: ${JSON.stringify({ chunk: "", done: true, response_type: type })}\n\n`),
  );
}

// ── Handler ───────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { query } = await req.json();
    if (!query?.trim()) {
      return new Response(JSON.stringify({ error: "query required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const type = classifyQuery(query);

    // Brief thinking pause (1–2.5 s) before first token
    const thinkMs = 1000 + Math.random() * 1500;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        await new Promise((r) => setTimeout(r, thinkMs));

        // Cascade: Lovable Gemini (free) → Anthropic → OpenAI → curated fallback
        const lovableKey = Deno.env.get("LOVABLE_API_KEY");
        const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
        const openaiKey = Deno.env.get("OPENAI_API_KEY");

        let text: string | null = null;
        if (lovableKey) text = await tryLovable(query, lovableKey);
        if (!text && anthropicKey) text = await tryAnthropic(query, anthropicKey);
        if (!text && openaiKey) text = await tryOpenAI(query, openaiKey);
        if (!text) text = pickResponse(type);

        await streamWords(text, type, controller, encoder);
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
