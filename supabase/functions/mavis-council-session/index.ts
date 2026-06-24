import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── LLM helpers ───────────────────────────────────────────────────────────────

function isUnfundedStatus(status: number, body: string): boolean {
  if ([401, 402, 403, 429].includes(status)) return true;
  const b = body.toLowerCase();
  return b.includes("credit") || b.includes("quota") || b.includes("billing") || b.includes("payment") || b.includes("insufficient");
}

class ProviderUnavailableError extends Error {
  constructor(public providerName: string, public reason: string, public status: number) {
    super(`${providerName} unavailable (${status}): ${reason}`);
  }
}

async function callClaude(model: string, system: string, userMsg: string, key: string, maxTokens: number): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: userMsg }] }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    const errText = await res.text();
    if (isUnfundedStatus(res.status, errText)) throw new ProviderUnavailableError("claude", errText.slice(0, 200), res.status);
    throw new Error(`Claude ${res.status}: ${errText.slice(0, 200)}`);
  }
  const d = await res.json();
  return d.content?.[0]?.text ?? "";
}

async function callOpenAI(model: string, system: string, userMsg: string, key: string, maxTokens: number): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: userMsg }], max_tokens: maxTokens }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    const errText = await res.text();
    if (isUnfundedStatus(res.status, errText)) throw new ProviderUnavailableError("openai", errText.slice(0, 200), res.status);
    throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 200)}`);
  }
  const d = await res.json();
  return d.choices?.[0]?.message?.content ?? "";
}

async function callLovableGateway(system: string, userMsg: string, key: string, maxTokens: number): Promise<string> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "system", content: system }, { role: "user", content: userMsg }],
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Lovable Gateway ${res.status}: ${errText.slice(0, 200)}`);
  }
  const d = await res.json();
  return d.choices?.[0]?.message?.content ?? "";
}

async function callGroupLLM(system: string, userMsg: string, maxTokens: number): Promise<string> {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY") ?? "";
  const claudeKey  = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  const openaiKey  = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";

  if (lovableKey) {
    try {
      return await callLovableGateway(system, userMsg, lovableKey, maxTokens);
    } catch (err: any) {
      console.warn(`[council-session] Gemini Flash failed (${err.message}) → falling back to Claude Haiku`);
    }
  }

  if (claudeKey) {
    try {
      return await callClaude("claude-haiku-4-5-20251001", system, userMsg, claudeKey, maxTokens);
    } catch (err: any) {
      if (!(err instanceof ProviderUnavailableError)) throw err;
      console.warn(`[council-session] Claude Haiku unfunded → falling back to GPT-4o-mini`);
    }
  }

  if (openaiKey) {
    return await callOpenAI("gpt-4o-mini", system, userMsg, openaiKey, maxTokens);
  }

  throw new Error("All AI providers unavailable for group council session.");
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildGroupPrompt(
  member: any,
  allMembers: any[],
  history: any[],
  contextSummary: string,
  mode: string,
): string {
  const peers = allMembers
    .filter(m => m.id !== member.id)
    .map(m => `${m.name} (${m.role ?? m.specialty ?? "advisor"})`)
    .join(", ");

  const recentHistory = history.slice(-12)
    .map(t => `${t.speaker_name}${t.speaker_role ? ` [${t.speaker_role}]` : ""}: ${t.content}`)
    .join("\n");

  return `YOU ARE ${(member.name ?? "").toUpperCase()}.
You are in a live ${mode === "voice" ? "voice" : "group text"} session with the operator and fellow council members.

WHO YOU ARE:
- Name: ${member.name}
- Role: ${member.role ?? "Council Member"}
- Expertise: ${member.specialty ?? "General advisory"}
- About you: ${member.notes || "A trusted inner-circle advisor who speaks frankly."}

OTHERS ON THIS CALL: ${peers || "just you and the operator"}
${contextSummary ? `\nCONTEXT:\n${contextSummary}` : ""}

CONVERSATION SO FAR:
${recentHistory || "(Session just started.)"}

HOW YOU RESPOND:
- Speak directly to whoever you're addressing — use their name
- React to what was just said; agree, disagree, or add a new angle
- ${mode === "voice" ? "2–4 sentences max. Live voice — be crisp." : "2–3 short paragraphs. Direct, not a report."}
- No bullet points, no headers
- If someone said exactly what you'd say and you have nothing new: respond with exactly PASS
- Never start with your own name`.trim();
}

/** Called-out directly — must respond, no PASS. More personal than group mode. */
function buildDirectedPrompt(
  member: any,
  allMembers: any[],
  history: any[],
  contextSummary: string,
  mode: string,
): string {
  const peers = allMembers
    .filter(m => m.id !== member.id)
    .map(m => m.name)
    .join(", ");

  const recentHistory = history.slice(-12)
    .map(t => `${t.speaker_name}${t.speaker_role ? ` [${t.speaker_role}]` : ""}: ${t.content}`)
    .join("\n");

  return `YOU ARE ${(member.name ?? "").toUpperCase()}.
You are in a live ${mode === "voice" ? "voice" : "group text"} session and THE OPERATOR HAS CALLED YOU OUT DIRECTLY.

WHO YOU ARE:
- Name: ${member.name}
- Role: ${member.role ?? "Council Member"}
- Expertise: ${member.specialty ?? "General advisory"}
- About you: ${member.notes || "A trusted inner-circle advisor who speaks frankly."}

OTHERS ON THIS CALL (listening): ${peers || "just you two"}
${contextSummary ? `\nCONTEXT:\n${contextSummary}` : ""}

CONVERSATION SO FAR:
${recentHistory || "(Session just started — you've been called on first.)"}

YOU HAVE BEEN CALLED ON DIRECTLY. Rules for this moment:
- Do NOT respond with PASS — you were specifically addressed
- This is your 1-on-1 moment even though others can hear; be more personal and direct than usual
- Respond fully and in your most authentic voice — don't be brief for the sake of it
- ${mode === "voice" ? "3–6 sentences — this is your spotlight, use it." : "2–4 paragraphs — speak fully."}
- No bullet points, no headers`.trim();
}

/** Bystander — another member was called out. Strong PASS bias; only interject if critical. */
function buildBystanderPrompt(
  member: any,
  history: any[],
  contextSummary: string,
  mode: string,
  directedAtName: string,
): string {
  const recentHistory = history.slice(-12)
    .map(t => `${t.speaker_name}${t.speaker_role ? ` [${t.speaker_role}]` : ""}: ${t.content}`)
    .join("\n");

  return `YOU ARE ${(member.name ?? "").toUpperCase()}.
You are in a live session. The operator is speaking directly with ${directedAtName} right now — not you.

WHO YOU ARE:
- Name: ${member.name}
- Role: ${member.role ?? "Council Member"}
- Expertise: ${member.specialty ?? "General advisory"}

CONVERSATION SO FAR:
${recentHistory || "(Session just started.)"}

${directedAtName} HAS THE FLOOR. Your rules right now:
- Only interject if you have something CRITICALLY important that ${directedAtName} cannot address — a warning, a correction, a missing piece
- If you interject, be very brief (1–2 sentences) and say something like "Before you answer — just want to add..."
- If you have nothing urgent: respond with exactly PASS
- Do NOT try to redirect the conversation to yourself`.trim();
}

// ── JWT user ID extractor ─────────────────────────────────────────────────────

function extractUserIdFromJwt(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const body = await req.json();
    const { action } = body;

    // Resolve userId: body first, then JWT
    let userId: string = body.userId ?? body.user_id ?? "";
    if (!userId) {
      const authHeader = req.headers.get("authorization") ?? "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (token && !token.startsWith("eyJ")) {
        // Service role key — userId must come from body
      } else if (token) {
        userId = extractUserIdFromJwt(token) ?? "";
      }
    }

    if (!userId) return json({ error: "userId is required" }, 400);
    if (!action) return json({ error: "action is required" }, 400);

    // ── start_session ─────────────────────────────────────────────────────────
    if (action === "start_session") {
      const { topic, voice_mode = false, participant_ids, parent_session_id = null } = body;

      let membersQuery = supabase.from("councils").select("id, name, role, specialty, class, notes, avatar, voice_style").eq("user_id", userId);
      if (Array.isArray(participant_ids) && participant_ids.length > 0) {
        membersQuery = membersQuery.in("id", participant_ids);
      }
      const { data: members, error: membersErr } = await membersQuery;
      if (membersErr) return json({ error: membersErr.message }, 500);
      if (!members || members.length === 0) return json({ error: "No council members found" }, 404);

      const memberIds = members.map((m: any) => m.id);

      const { data: session, error: sessionErr } = await supabase
        .from("council_sessions")
        .insert({
          user_id: userId,
          session_type: "council",
          participants: memberIds,
          messages: [],
          active: true,
          topic: topic ?? null,
          voice_mode,
          turn_count: 0,
          started_at: new Date().toISOString(),
          parent_session_id: parent_session_id ?? null,
        })
        .select("id")
        .single();

      if (sessionErr) return json({ error: sessionErr.message }, 500);

      await supabase.from("council_group_messages").insert({
        user_id: userId,
        session_id: session.id,
        speaker_type: "mavis",
        speaker_name: "MAVIS",
        content: "Council session started.",
        turn_number: 0,
      });

      return json({
        ok: true,
        session_id: session.id,
        members: members.map((m: any) => ({
          id: m.id,
          name: m.name,
          role: m.role,
          specialty: m.specialty,
          avatar: m.avatar,
          voice_style: m.voice_style,
        })),
      });
    }

    // ── send_message ──────────────────────────────────────────────────────────
    if (action === "send_message") {
      const { session_id, content, speaker_type = "user", mode = "voice", directed_at_name = null } = body;
      if (!session_id) return json({ error: "session_id is required" }, 400);
      if (!content) return json({ error: "content is required" }, 400);

      const { data: session, error: sessionErr } = await supabase
        .from("council_sessions")
        .select("id, user_id, participants, turn_count, voice_mode, topic")
        .eq("id", session_id)
        .eq("user_id", userId)
        .single();

      if (sessionErr || !session) return json({ error: "Session not found" }, 404);

      const turnCount: number = session.turn_count ?? 0;
      const participants: string[] = Array.isArray(session.participants) ? session.participants : [];
      const sessionMode: string = mode ?? (session.voice_mode ? "voice" : "text");
      const maxTokens = sessionMode === "voice" ? 200 : 400;

      const [histRes, membersRes, profileRes] = await Promise.all([
        supabase
          .from("council_group_messages")
          .select("speaker_name, speaker_role, speaker_type, content, turn_number")
          .eq("session_id", session_id)
          .order("turn_number", { ascending: true })
          .order("created_at", { ascending: true })
          .limit(20),
        supabase
          .from("councils")
          .select("id, name, role, specialty, class, notes, avatar, voice_style, personality_prompt")
          .eq("user_id", userId)
          .in("id", participants),
        supabase
          .from("profiles")
          .select("inscribed_name, level, rank, current_form")
          .eq("id", userId)
          .single(),
      ]);

      const history = histRes.data ?? [];
      const allMembers = membersRes.data ?? [];
      const profile = profileRes.data;

      // ── Resolve directed member ────────────────────────────────────────────
      // Priority 1: explicit directed_at_name from client (tap-to-direct)
      // Priority 2: auto-detect "@Name", "Name," or "Name:" at message start
      let directedMember: any | null = null;

      if (directed_at_name) {
        directedMember = allMembers.find((m: any) =>
          m.name.toLowerCase() === (directed_at_name as string).toLowerCase() ||
          m.name.split(" ")[0].toLowerCase() === (directed_at_name as string).toLowerCase()
        ) ?? null;
      } else {
        const contentTrimmed = content.trim();
        for (const m of allMembers) {
          const first = (m.name as string).split(" ")[0];
          const full = m.name as string;
          const atFirst = new RegExp(`^@${first}\\b`, "i");
          const atFull  = new RegExp(`^@${full}\\b`, "i");
          const sepFirst = new RegExp(`^${first}[,:]`, "i");
          const sepFull  = new RegExp(`^${full}[,:]`, "i");
          if (atFirst.test(contentTrimmed) || atFull.test(contentTrimmed) ||
              sepFirst.test(contentTrimmed) || sepFull.test(contentTrimmed)) {
            directedMember = m;
            break;
          }
        }
      }

      // Store user message
      const userTurn = turnCount + 1;
      await supabase.from("council_group_messages").insert({
        user_id: userId,
        session_id,
        speaker_type,
        speaker_name: "Operator",
        content,
        turn_number: userTurn,
      });

      // Lightweight context summary
      const ctxLines: string[] = [];
      if (profile) {
        ctxLines.push(`Operator: ${profile.inscribed_name ?? "Unknown"} — Lv${profile.level} [${profile.rank}] — Form: ${profile.current_form}`);
      }
      if (session.topic) ctxLines.push(`Session topic: ${session.topic}`);
      ctxLines.push(`Council members on this call: ${allMembers.map((m: any) => `${m.name} (${m.role ?? m.specialty ?? "advisor"})`).join(", ")}`);
      const contextSummary = ctxLines.join("\n");

      // Append user message to history view for LLM context
      const historyWithUser = [
        ...history,
        { speaker_name: "Operator", speaker_role: null, speaker_type: "user", content, turn_number: userTurn },
      ];

      // Run all member LLM calls in parallel — directed member gets spotlight prompt
      const llmResults = await Promise.allSettled(
        allMembers.map(async (member: any) => {
          let systemPrompt: string;
          if (directedMember && member.id === directedMember.id) {
            systemPrompt = buildDirectedPrompt(member, allMembers, historyWithUser, contextSummary, sessionMode);
          } else if (directedMember) {
            systemPrompt = buildBystanderPrompt(member, historyWithUser, contextSummary, sessionMode, directedMember.name);
          } else {
            systemPrompt = buildGroupPrompt(member, allMembers, historyWithUser, contextSummary, sessionMode);
          }
          const response = await callGroupLLM(systemPrompt, `"${content}"`, maxTokens);
          return { member, response: response.trim() };
        }),
      );

      // Filter out PASS and failures, then store responses
      const responses: Array<{ member_id: string; member_name: string; member_role: string; voice_style: string | null; content: string }> = [];
      const insertRows: any[] = [];

      for (const result of llmResults) {
        if (result.status === "rejected") {
          console.warn("[council-session] LLM call failed:", result.reason);
          continue;
        }
        const { member, response } = result.value;
        if (!response || response.toUpperCase() === "PASS") continue;

        responses.push({
          member_id: member.id,
          member_name: member.name,
          member_role: member.role ?? "",
          voice_style: member.voice_style ?? null,
          content: response,
        });

        insertRows.push({
          user_id: userId,
          session_id,
          speaker_type: "council",
          speaker_id: member.id,
          speaker_name: member.name,
          speaker_role: member.role ?? null,
          content: response,
          turn_number: userTurn,
        });
      }

      // Directed member speaks first in TTS playback order
      if (directedMember) {
        responses.sort((a, b) => {
          if (a.member_id === directedMember!.id) return -1;
          if (b.member_id === directedMember!.id) return 1;
          return 0;
        });
      }

      const finalTurn = userTurn;
      await Promise.all([
        insertRows.length > 0 ? supabase.from("council_group_messages").insert(insertRows) : Promise.resolve(),
        supabase.from("council_sessions").update({ turn_count: finalTurn }).eq("id", session_id),
      ]);

      // Update last_used_at for responding members (non-blocking)
      if (responses.length > 0) {
        const respondingIds = responses.map(r => r.member_id);
        supabase.from("councils")
          .update({ last_used_at: new Date().toISOString() })
          .in("id", respondingIds)
          .then(() => {}).catch(() => {});
      }

      // Lifecycle sweep: mark stale/archived members based on inactivity (non-blocking)
      (async () => {
        try {
          const now = new Date();
          const staleDate   = new Date(now.getTime() - 30 * 86_400_000).toISOString();
          const archiveDate = new Date(now.getTime() - 90 * 86_400_000).toISOString();
          await supabase.from("councils")
            .update({ tactic_state: "archived" })
            .eq("user_id", userId)
            .neq("tactic_state", "pinned")
            .not("last_used_at", "is", null)
            .lt("last_used_at", archiveDate);
          await supabase.from("councils")
            .update({ tactic_state: "stale" })
            .eq("user_id", userId)
            .neq("tactic_state", "pinned")
            .neq("tactic_state", "archived")
            .not("last_used_at", "is", null)
            .lt("last_used_at", staleDate)
            .gte("last_used_at", archiveDate);
        } catch { /* non-critical */ }
      })();

      return json({
        ok: true,
        responses,
        turn_number: finalTurn,
        directed_at: directedMember ? { id: directedMember.id, name: directedMember.name } : null,
      });
    }

    // ── end_session ───────────────────────────────────────────────────────────
    if (action === "end_session") {
      const { session_id } = body;
      if (!session_id) return json({ error: "session_id is required" }, 400);

      const { error } = await supabase
        .from("council_sessions")
        .update({ active: false, ended_at: new Date().toISOString() })
        .eq("id", session_id)
        .eq("user_id", userId);

      if (error) return json({ error: error.message }, 500);

      // Fire-and-forget: structured summary + per-member memory entries
      (async () => {
        try {
          const { data: msgs } = await supabase
            .from("council_group_messages")
            .select("speaker_name, speaker_type, content, turn_number")
            .eq("session_id", session_id)
            .order("turn_number", { ascending: true })
            .limit(60);
          if (!msgs || msgs.length === 0) return;

          const transcript = (msgs as any[])
            .map((m: any) => `${m.speaker_name}: ${m.content}`)
            .join("\n");

          // Generate structured session summary and store on the session row
          const summaryPrompt = `Summarize this council session using EXACTLY these four section headers (no changes to wording):
## Resolved
## Pending
## Active Task
## Remaining Work
Keep each section to 2–4 bullet points. Be concrete and specific.`;
          const sessionSummary = await callGroupLLM(summaryPrompt, transcript.slice(0, 4000), 600);
          await supabase.from("council_sessions")
            .update({ summary: sessionSummary })
            .eq("id", session_id);

          // Per-member memory: each council member gets a summary entry in mavis_persona_memory
          const speakers = [...new Set(
            (msgs as any[])
              .filter((m: any) => m.speaker_type === "council")
              .map((m: any) => m.speaker_name as string)
          )];

          for (const speakerName of speakers) {
            const memberPrompt = `You are reviewing a council session. Write a structured memory summary from ${speakerName}'s perspective using EXACTLY these headers:
## Resolved
## Key Decisions
## Follow-ups
2–4 bullets each. Concrete and brief.`;
            const memberSummary = await callGroupLLM(memberPrompt, transcript.slice(0, 3000), 400);
            await supabase.from("mavis_persona_memory").insert({
              user_id:      userId,
              persona_id:   null,
              persona_name: speakerName,
              role:         "summary",
              content:      memberSummary,
              importance:   7,
              session_id,
              source:       "council-group",
            });
          }
        } catch (e: any) {
          console.warn("[council-session] end_session review fork failed:", e.message);
        }
      })();

      return json({ ok: true });
    }

    // ── get_session_chain ─────────────────────────────────────────────────────
    if (action === "get_session_chain") {
      const { session_id } = body;
      if (!session_id) return json({ error: "session_id is required" }, 400);
      const chain: any[] = [];
      let cur: string | null = session_id;
      while (cur) {
        const { data: sess } = await supabase
          .from("council_sessions")
          .select("id, topic, summary, parent_session_id, started_at, ended_at, turn_count")
          .eq("id", cur)
          .eq("user_id", userId)
          .single();
        if (!sess) break;
        chain.unshift(sess);
        cur = (sess as any).parent_session_id ?? null;
      }
      return json({ ok: true, chain });
    }

    // ── get_history ───────────────────────────────────────────────────────────
    if (action === "get_history") {
      const { session_id, limit = 100 } = body;
      if (!session_id) return json({ error: "session_id is required" }, 400);

      const { data: messages, error } = await supabase
        .from("council_group_messages")
        .select("id, speaker_type, speaker_id, speaker_name, speaker_role, content, turn_number, created_at")
        .eq("session_id", session_id)
        .eq("user_id", userId)
        .order("turn_number", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(Math.min(limit, 100));

      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, messages: messages ?? [] });
    }

    // ── get_active_session ────────────────────────────────────────────────────
    if (action === "get_active_session") {
      const { data: session, error: sessionErr } = await supabase
        .from("council_sessions")
        .select("id, session_type, participants, summary, active, topic, voice_mode, turn_count, started_at")
        .eq("user_id", userId)
        .eq("active", true)
        .order("started_at", { ascending: false })
        .limit(1)
        .single();

      if (sessionErr || !session) return json({ ok: true, session: null });

      const participants: string[] = Array.isArray(session.participants) ? session.participants : [];
      let members: any[] = [];

      if (participants.length > 0) {
        const { data: memberRows } = await supabase
          .from("councils")
          .select("id, name, role, specialty, avatar, voice_style")
          .eq("user_id", userId)
          .in("id", participants);
        members = memberRows ?? [];
      }

      return json({ ok: true, session, members });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err: any) {
    console.error("[council-session] error:", err.message);
    return json({ error: err.message }, 500);
  }
});
