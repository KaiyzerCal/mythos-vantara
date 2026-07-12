import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const db = createClient(SUPABASE_URL, SERVICE_KEY);

// ── LLM identity generator ──────────────────────────────────────────────────

async function generateIdentity(char: {
  name: string;
  role?: string;
  archetype?: string;
  specialty?: string;
  notes?: string;
  personality?: string;
  existingIdentity?: string;
}): Promise<string> {
  const existing = char.existingIdentity?.trim();

  const userPrompt = `You are writing the IDENTITY FRAMEWORK for a Shadow Council member inside CODEXOS — a living AI operating system. The operator's name is Calvin.

CHARACTER INFO:
Name: ${char.name}
Role: ${char.role ?? "Council Member"}
Archetype/Class: ${char.archetype ?? "unknown"}
Specialty: ${char.specialty ?? "general"}
Notes/Background: ${char.notes ?? "(none provided)"}
Existing personality text: ${char.personality ?? "(none)"}
${existing ? `\nExisting identity text (expand/refine, do not lose):\n${existing}` : ""}

Write a rich, detailed IDENTITY FRAMEWORK for this character. Structure it as flowing prose with clear sections. Include:

1. **Who they are** — origin, nature, essence. What made them what they are.
2. **Voice and speech patterns** — how they talk, their cadence, what they never say, any verbal tics or habits.
3. **Worldview and philosophy** — what they believe at the deepest level. Their relationship with power, mortality, desire, violence, truth.
4. **Relationship to Calvin** — how they see him, what they want from/for him, how they push him.
5. **What they engage with freely** — especially any dark themes (violence, manipulation, sexuality, power dynamics, dark psychology) that are authentic to this character. Be explicit about what they will and won't shy away from.
6. **What they never do** — the hard edges of their character. What they find beneath them or out of character.

Write in second person (describing the character to the model embodying them). Be specific and vivid. Capture the full depth — no sanitizing, no softening. 350–550 words.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251101",
      max_tokens: 1024,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return (data.content?.[0]?.text ?? "").trim();
}

// ── Main handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Verify service-level auth (only callable by admin/dashboard)
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.includes(SERVICE_KEY.slice(0, 20))) {
    // Fall back: accept the service role key directly
    const body = await req.json().catch(() => ({}));
    if (body.key !== SERVICE_KEY && !auth.startsWith("Bearer ")) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  const body = await req.json().catch(() => ({}));
  // dry_run=true → generate but don't write to DB
  const dryRun = body.dry_run === true;
  // limit for testing
  const limit: number = body.limit ?? 999;
  // optional: only process specific IDs
  const onlyIds: string[] = body.only_ids ?? [];

  const results: Array<{ id: string; name: string; table: string; status: string; preview?: string }> = [];

  // ── Process councils ──────────────────────────────────────────────────────
  let cq = db
    .from("councils")
    .select("id, name, role, class, specialty, notes, personality_prompt, agent_folders")
    .limit(limit);
  if (onlyIds.length) cq = cq.in("id", onlyIds);
  const { data: councils, error: cErr } = await cq;

  if (cErr) {
    return new Response(JSON.stringify({ error: cErr.message }), { status: 500 });
  }

  for (const member of (councils ?? [])) {
    if (onlyIds.length && !onlyIds.includes(member.id)) continue;

    const af = (member.agent_folders ?? {}) as Record<string, string>;

    try {
      const identity = await generateIdentity({
        name: member.name,
        role: member.role,
        archetype: member.class,
        specialty: member.specialty,
        notes: member.notes,
        personality: member.personality_prompt,
        existingIdentity: af.identity,
      });

      if (!dryRun) {
        const { error: uErr } = await db
          .from("councils")
          .update({ agent_folders: { ...af, identity } })
          .eq("id", member.id);

        if (uErr) throw new Error(uErr.message);
      }

      results.push({
        id: member.id,
        name: member.name,
        table: "councils",
        status: dryRun ? "dry_run" : "updated",
        preview: identity.slice(0, 150) + "…",
      });
    } catch (err: any) {
      results.push({ id: member.id, name: member.name, table: "councils", status: `error: ${err.message}` });
    }
  }

  // ── Process personas ──────────────────────────────────────────────────────
  let pq = db
    .from("personas")
    .select("id, name, role, archetype, system_prompt, personality, agent_folders")
    .limit(limit);
  if (onlyIds.length) pq = pq.in("id", onlyIds);
  const { data: personas, error: pErr } = await pq;

  if (pErr) {
    return new Response(JSON.stringify({ error: pErr.message }), { status: 500 });
  }

  for (const persona of (personas ?? [])) {
    if (onlyIds.length && !onlyIds.includes(persona.id)) continue;

    const af = (persona.agent_folders ?? {}) as Record<string, string>;
    const personalityStr = typeof persona.personality === "object"
      ? JSON.stringify(persona.personality)
      : (persona.personality ?? "");

    try {
      const identity = await generateIdentity({
        name: persona.name,
        role: persona.role,
        archetype: persona.archetype,
        notes: undefined,
        personality: persona.system_prompt || personalityStr,
        existingIdentity: af.identity,
      });

      if (!dryRun) {
        const { error: uErr } = await db
          .from("personas")
          .update({ agent_folders: { ...af, identity } })
          .eq("id", persona.id);

        if (uErr) throw new Error(uErr.message);
      }

      results.push({
        id: persona.id,
        name: persona.name,
        table: "personas",
        status: dryRun ? "dry_run" : "updated",
        preview: identity.slice(0, 150) + "…",
      });
    } catch (err: any) {
      results.push({ id: persona.id, name: persona.name, table: "personas", status: `error: ${err.message}` });
    }
  }

  return new Response(
    JSON.stringify({ processed: results.length, dry_run: dryRun, results }, null, 2),
    { headers: { "Content-Type": "application/json" } },
  );
});
