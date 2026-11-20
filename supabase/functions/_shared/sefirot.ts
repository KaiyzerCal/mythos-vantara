// ── Sefirot Anchor Protocol (v1) ─────────────────────────────────────────────
// The Black Sun pathway is the Sovereign Trunk; every other Beyonder pathway is an auxiliary limb of it.
//   • Convergence: whenever a quest advances an auxiliary pathway, 33% of that gain also flows to the trunk's active sequence.
//   • Anti-dilution: more than 3 non-neighbouring pathways on one quest fragments focus (-15% digestion yield).
//   • Limb saturation: an auxiliary sequence at 100% cannot unlock its next sequence by itself; it needs the trunk to reach
//     the same tier (equilibrium) or a quest that is an Ascension Ritual.
// Pure rules live here (unit-tested); the database orchestration is below and is shared by every surface through
// mavis-actions' complete_quest.

export const CONVERGENCE_RATE = 0.33;
export const FRAGMENT_THRESHOLD = 3; // more than this many distinct focus groups = fragmented
export const FRAGMENT_YIELD = 0.85;  // -15% digestion yield

export interface SefSkill {
  id: string;
  name: string;
  tier: number | null;
  proficiency: number | null;
  unlocked: boolean | null;
  parent_skill_id: string | null;
  is_sovereign_trunk?: boolean | null;
  body_mapping?: string | null;
}

/** Walk up parent links to the pathway root. Returns null if the chain is broken. */
export function pathwayRoot(id: string, byId: Map<string, SefSkill>): SefSkill | null {
  let cur = byId.get(id) ?? null;
  for (let i = 0; cur && i < 6; i++) {
    if (!cur.parent_skill_id) return cur;
    cur = byId.get(cur.parent_skill_id) ?? null;
  }
  return null;
}

export const convergenceDividend = (gain: number): number => (gain > 0 ? Math.max(1, Math.round(gain * CONVERGENCE_RATE)) : 0);

/** Pathways sharing a body mapping are neighbours (one focus group); an unmapped pathway is its own group. */
export function focusGroupCount(auxRoots: SefSkill[]): number {
  return new Set(auxRoots.map((r) => r.body_mapping || `pathway:${r.id}`)).size;
}
export const isFragmented = (auxRoots: SefSkill[]): boolean => focusGroupCount(auxRoots) > FRAGMENT_THRESHOLD;
export const applyYield = (gain: number, fragmented: boolean): number => (fragmented ? Math.max(1, Math.round(gain * FRAGMENT_YIELD)) : gain);

export function isAscensionRitual(quest: { category?: unknown; title?: unknown }): boolean {
  return /ascension[\s_-]*ritual/i.test(`${quest.category ?? ""} ${quest.title ?? ""}`);
}

/**
 * A pathway's frontier: the furthest sequence reached by an unbroken run of unlocked sequences starting at Seq.9 (tier 1).
 * Contiguous on purpose: a stray unlock further up (a hand edit) must not move where the pathway says you are.
 */
export function frontierSequence(sequences: SefSkill[]): SefSkill | null {
  const byTier = new Map<number, SefSkill>();
  for (const s of sequences) if (s.tier != null) byTier.set(s.tier, s);
  let cur: SefSkill | null = null;
  for (let t = 1; t <= 10; t++) {
    const s = byTier.get(t);
    if (!s || !s.unlocked) break;
    cur = s;
  }
  return cur;
}

/** The trunk's active sequence = its frontier. */
export function activeTrunkSequence(trunkId: string, all: SefSkill[]): SefSkill | null {
  return frontierSequence(all.filter((s) => s.parent_skill_id === trunkId));
}

/**
 * Locked Beyonder skills may bank progress (a head start from real experience) but never finish: they stop at 99% so a
 * locked sequence can never "master" itself and unlock the tiers above it out of order.
 */
export function capForLocked(after: number, unlocked: boolean | null | undefined, isBeyonder: boolean): number {
  return isBeyonder && unlocked === false ? Math.min(99, after) : after;
}

/** May a saturated (100%) auxiliary sequence at `tier` unlock its next sequence? */
export function limbMayAdvance(tier: number, trunkSequences: SefSkill[], ritual: boolean): boolean {
  if (ritual) return true;
  // Equilibrium: the trunk has completed a sequence at this tier or higher.
  return trunkSequences.some((t) => (t.tier ?? 0) >= tier && Number(t.proficiency ?? 0) >= 100);
}

export interface SefirotPlan {
  trunk: SefSkill | null;
  byId: Map<string, SefSkill>;
  all: SefSkill[];
  auxRoots: SefSkill[];      // distinct non-trunk pathways touched by the linked skills
  fragmented: boolean;
  lockedLinked: SefSkill[];  // linked Beyonder skills that are still locked
}

const COLS = "id, name, tier, proficiency, unlocked, parent_skill_id, is_sovereign_trunk, body_mapping";

/** Read the Beyonder tree once and work out which pathways a quest's linked skills touch. Never throws. */
export async function planSefirot(sb: any, userId: string, skillIds: string[]): Promise<SefirotPlan | null> {
  try {
    if (skillIds.length === 0) return null;
    // Most quests link no Beyonder skill at all; a one-row-per-link check avoids reading the whole ~1,100-row tree for them.
    const { data: linked } = await sb.from("skills").select("category").eq("user_id", userId).in("id", skillIds);
    if (!(linked ?? []).some((r: any) => r.category === "Beyonder")) return null;
    const { data } = await sb.from("skills").select(COLS).eq("user_id", userId).eq("category", "Beyonder").limit(2000);
    const all = (data ?? []) as SefSkill[];
    const trunk = all.find((s) => s.is_sovereign_trunk && !s.parent_skill_id) ?? null;
    if (!trunk) return null;
    const byId = new Map(all.map((s) => [s.id, s]));
    const roots = new Map<string, SefSkill>();
    for (const id of skillIds) {
      const root = pathwayRoot(id, byId);
      if (root && root.id !== trunk.id) roots.set(root.id, root);
    }
    const auxRoots = [...roots.values()];
    const lockedLinked = skillIds.map((id) => byId.get(id)).filter((x): x is SefSkill => !!x && x.unlocked === false);
    return { trunk, byId, all, auxRoots, fragmented: isFragmented(auxRoots), lockedLinked };
  } catch (e) {
    console.warn("[sefirot] plan failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** True when this mastered skill is an auxiliary sequence that must wait at the gate. */
export function isGatedLimbSequence(skill: SefSkill, plan: SefirotPlan | null): boolean {
  if (!plan || !plan.trunk) return false;
  const inPlan = plan.byId.get(skill.id);
  if (!inPlan || !inPlan.parent_skill_id) return false;          // a pathway root, not a sequence
  const parent = plan.byId.get(inPlan.parent_skill_id);
  if (!parent || parent.parent_skill_id) return false;            // abilities (grandchildren) are not gated
  return parent.id !== plan.trunk.id;                              // direct child of an auxiliary root
}

/**
 * Pay the convergence dividend into the trunk's active sequence. `gains` is the proficiency each auxiliary pathway
 * just earned. Returns what happened so the caller can report it. Never throws.
 */
export async function payConvergence(
  sb: any, userId: string, plan: SefirotPlan | null, gains: Map<string, number>,
  log: (type: string, text: string) => Promise<void>,
): Promise<{ dividend: number; into: string | null; reachedHundred: SefSkill | null }> {
  const none: { dividend: number; into: string | null; reachedHundred: SefSkill | null } = { dividend: 0, into: null, reachedHundred: null };
  try {
    if (!plan || !plan.trunk || gains.size === 0) return none;
    const active = activeTrunkSequence(plan.trunk.id, plan.all);
    if (!active) return none;
    let dividend = 0;
    for (const g of gains.values()) dividend += convergenceDividend(g);
    const before = Number(active.proficiency ?? 0);
    const after = Math.min(100, before + dividend);
    if (after === before) return none;
    const { error } = await sb.from("skills").update({ proficiency: after, updated_at: new Date().toISOString() }).eq("id", active.id).eq("user_id", userId);
    if (error) throw error;
    active.proficiency = after;
    const from = plan.auxRoots.map((r) => r.name.replace(/_/g, " ")).join(", ");
    await log("skill_up", `Sovereign convergence: ${active.name} ${before}% -> ${after}% (+${after - before} from ${from})`);
    return { dividend: after - before, into: active.name, reachedHundred: after >= 100 ? active : null };
  } catch (e) {
    console.warn("[sefirot] convergence failed:", e instanceof Error ? e.message : e);
    return none;
  }
}

/** When the trunk completes a sequence, release auxiliary sequences waiting at that tier or below. Never throws. */
export async function releaseSaturatedLimbs(
  sb: any, userId: string, plan: SefirotPlan | null, trunkSeq: SefSkill,
  log: (type: string, text: string) => Promise<void>,
): Promise<string[]> {
  const released: string[] = [];
  try {
    if (!plan || !plan.trunk) return released;
    const waiting = plan.all.filter((s) => isGatedLimbSequence(s, plan) && Number(s.proficiency ?? 0) >= 100 && (s.tier ?? 0) <= (trunkSeq.tier ?? 0));
    for (const w of waiting) {
      const { data: next } = await sb.from("skills").select("id, name").eq("user_id", userId).eq("unlocked", false).contains("prerequisites", [w.id]);
      for (const u of next ?? []) {
        await sb.from("skills").update({ unlocked: true, updated_at: new Date().toISOString() }).eq("id", u.id).eq("user_id", userId);
        await log("skill_created", `${u.name} unlocked (${w.name} released by ${trunkSeq.name} equilibrium)`);
        released.push(u.name);
      }
    }
  } catch (e) {
    console.warn("[sefirot] release failed:", e instanceof Error ? e.message : e);
  }
  return released;
}

export function lockedLinkNote(plan: SefirotPlan | null): string | null {
  if (!plan || plan.lockedLinked.length === 0) return null;
  const names = plan.lockedLinked.map((s) => s.name).join(", ");
  const current = plan.auxRoots.map((r) => {
    const f = frontierSequence(plan.all.filter((s) => s.parent_skill_id === r.id));
    return f ? `${r.name.replace(/_/g, " ")}: ${f.name}` : null;
  }).filter(Boolean).join("; ");
  return `Locked sequence linked (${names}). Locked sequences can only bank progress up to 99% and do not advance your position. Link the current sequence instead${current ? ` (${current})` : ""}.`;
}

/** Create/update-time check so warnings are shown when the quest is written, not only when it completes. */
export async function dilutionWarning(sb: any, userId: string, skillIds: string[], known?: SefirotPlan | null): Promise<string | null> {
  const plan = known !== undefined ? known : await planSefirot(sb, userId, skillIds);
  if (!plan) return null;
  const parts: string[] = [];
  if (plan.fragmented) {
    parts.push(`Dilution warning: this quest touches ${focusGroupCount(plan.auxRoots)} unrelated pathways (${plan.auxRoots.map((r) => r.name.replace(/_/g, " ")).join(", ")}). More than ${FRAGMENT_THRESHOLD} costs "Fragmented Focus: -15% Digestion Yield" on completion. Link the Black Sun sequence plus 1-2 auxiliary limbs.`);
  }
  const locked = lockedLinkNote(plan);
  if (locked) parts.push(locked);
  return parts.length ? parts.join(" ") : null;
}

/** Pure: which skill should be added as the primary axis, if any? Only when an auxiliary limb is linked and no trunk skill is. */
export function primaryAxisToAdd(skillIds: string[], plan: SefirotPlan | null): SefSkill | null {
  if (!plan || !plan.trunk || plan.auxRoots.length === 0) return null;
  if (skillIds.some((id) => pathwayRoot(id, plan.byId)?.id === plan.trunk!.id)) return null; // a trunk skill is already linked
  return activeTrunkSequence(plan.trunk.id, plan.all);
}

/**
 * Anchor the quest to the Black Sun: when it is linked to an auxiliary limb but not to the trunk, add the trunk's current
 * sequence so it earns full proficiency plus the convergence dividend. Never throws; returns the ids unchanged on any problem.
 */
export async function withPrimaryAxis(sb: any, userId: string, skillIds: string[], known?: SefirotPlan | null): Promise<{ ids: string[]; added: string | null }> {
  try {
    const plan = known !== undefined ? known : await planSefirot(sb, userId, skillIds);
    const primary = primaryAxisToAdd(skillIds, plan);
    if (!primary) return { ids: skillIds, added: null };
    return { ids: [...skillIds, primary.id], added: primary.name };
  } catch {
    return { ids: skillIds, added: null };
  }
}
