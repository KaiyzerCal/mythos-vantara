// Quest payout weighting + the digestion gate. Pure functions so they can be unit-tested.
// The numbers here are starting values, meant to be tuned after a few weeks of real use.

/** Highest XP a single quest may pay, by difficulty. Stops one quest from carrying an inflated xp_reward; there is no per-day cap. */
export const XP_CEILING: Record<string, number> = { Easy: 60, Normal: 120, Hard: 250, Extreme: 500, Impossible: 1000 };

/**
 * Effective XP for a completed quest: the stated reward, held to the difficulty ceiling, scaled down when a multi-step
 * quest is completed part-way (never below half). progress_current of 0 means "not tracked", so it pays in full.
 */
export function weightedXp(
  xpReward: number, difficulty: string, progressCurrent?: unknown, progressTarget?: unknown,
): number {
  const base = Math.max(0, Math.round(Number(xpReward) || 0));
  const ceiling = XP_CEILING[difficulty] ?? XP_CEILING.Normal;
  const cur = Number(progressCurrent ?? 0);
  const tgt = Number(progressTarget ?? 1);
  const fraction = tgt > 1 && cur > 0 && cur < tgt ? Math.max(0.5, cur / tgt) : 1;
  return Math.round(Math.min(base, ceiling) * fraction);
}

/** Digestion gate: when on, a Black Sun sequence at 100% waits for an Ascension Ritual before the next one opens. */
export const DIGESTION_GATE_ENABLED = true;

export function ascensionRitualQuest(sequenceId: string, sequenceName: string) {
  return {
    title: `Ascension Ritual: ${sequenceName}`,
    description:
      `You have practised ${sequenceName} to full proficiency. Digest it: act out the role in a real situation, on purpose, ` +
      `and notice what changes. Completing this opens the next sequence.`,
    type: "side",
    difficulty: "Hard",
    xp_reward: 200,
    category: "Ascension Ritual",
    linked_skill_ids: [sequenceId],
    completion_criteria: [
      `Act out the role of ${sequenceName} in a real situation, deliberately`,
      "Write down what you did and what it changed",
      "Do it with intention, not on autopilot",
    ],
  };
}
