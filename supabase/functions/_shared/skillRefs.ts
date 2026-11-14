// ── Skill references: ids OR exact names ──────────────────
// The chat model is shown skill NAMES, not 1,400 UUIDs, so asking it for ids made it invent them. A reference that is
// not a UUID is therefore looked up by exact (case-insensitive) name, preferring an unlocked skill when a name repeats
// (Beyonder pathways reuse names across pathway/sequence). Anything that resolves to nothing is reported back as
// `dropped` instead of vanishing.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function resolveSkillRefs(sb: any, userId: string, refs: string[]): Promise<{ valid: string[]; dropped: string[] }> {
  const wanted = Array.from(new Set(refs.map((r) => String(r).trim()).filter(Boolean)));
  const valid: string[] = [];
  const dropped: string[] = [];
  const idRefs = wanted.filter((r) => UUID_RE.test(r));
  if (idRefs.length > 0) {
    const { data } = await sb.from("skills").select("id").eq("user_id", userId).in("id", idRefs);
    const ok = new Set((data || []).map((r: any) => r.id as string));
    for (const id of idRefs) (ok.has(id) ? valid : dropped).push(id);
  }
  for (const name of wanted.filter((r) => !UUID_RE.test(r))) {
    const { data } = await sb.from("skills").select("id, unlocked").eq("user_id", userId).ilike("name", name.replace(/[%_\\]/g, (c) => `\\${c}`)).limit(10);
    const rows = (data || []) as Array<{ id: string; unlocked: boolean | null }>;
    const pick = rows.find((r) => r.unlocked) ?? rows[0];
    if (pick) { if (!valid.includes(pick.id)) valid.push(pick.id); } else dropped.push(name);
  }
  return { valid, dropped };
}

