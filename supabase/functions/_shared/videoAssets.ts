// Scheduling decisions for the video asset worker.
//
// Pure functions only — no Deno APIs, no network — so the rules that decide
// what gets generated, what gets retried, and when a production is finished can
// be unit-tested from vitest (see src/mavis/__tests__/videoAssets.test.ts).
//
// The worker itself is a thin loop around these. Keeping the decisions out of
// the loop matters because their failure modes are expensive and invisible:
// regenerating an asset that already exists costs money, a retry that never
// gives up costs money forever, and a production that never reports itself
// finished sits in the queue being re-examined every five minutes.

import type { ProductionType, VisualMode } from "./storyboard.ts";

export const MAX_BEAT_ATTEMPTS = 3;

export interface BeatRow {
  id: string;
  idx: number;
  narration: string;
  visual_prompt: string;
  seconds: number;
  asset_url: string | null;
  audio_url: string | null;
  provider: string | null;
  provider_job_id: string | null;
  status: "pending" | "generating" | "ready" | "failed" | "skipped";
  attempts: number;
}

export interface ProductionRow {
  id: string;
  production_type: ProductionType;
  visual_mode: VisualMode;
  generation_budget: number;
  generations_used: number;
}

export interface BeatNeeds {
  visual: boolean;
  audio: boolean;
}

/**
 * What this beat is still missing.
 *
 * A visual is only owed when the production has no performer to fall back on —
 * avatar and persona_ugc beats are carried by the presenter, so a beat with no
 * visual_prompt there is complete, not broken. Audio is owed whenever there is
 * a line to speak; a silent B-roll beat is legitimate and owes nothing.
 */
export function beatNeeds(beat: BeatRow, production: ProductionRow): BeatNeeds {
  const wantsVisual =
    production.production_type === "faceless"
      ? true
      : beat.visual_prompt.trim().length > 0;

  return {
    visual: wantsVisual && !beat.asset_url && beat.visual_prompt.trim().length > 0,
    audio: beat.narration.trim().length > 0 && !beat.audio_url,
  };
}

/** A beat is done when it owes nothing further. */
export function isBeatSatisfied(beat: BeatRow, production: ProductionRow): boolean {
  const needs = beatNeeds(beat, production);
  return !needs.visual && !needs.audio;
}

/** How many paid calls this beat still implies, for budget accounting. */
export function beatCost(beat: BeatRow, production: ProductionRow): number {
  const needs = beatNeeds(beat, production);
  return (needs.visual ? 1 : 0) + (needs.audio ? 1 : 0);
}

export function budgetRemaining(production: ProductionRow): number {
  return Math.max(0, production.generation_budget - production.generations_used);
}

export interface SelectOptions {
  /** Most beats to hand back for this tick — bounds wall clock, not spend. */
  limit: number;
}

/**
 * Choose which beats the worker should act on this tick.
 *
 * Ordering is by beat index so a production completes front-to-back and a
 * partial result is watchable rather than scattered. Beats already satisfied
 * are never returned — that idempotency is what stops a re-tick from paying
 * twice for the same picture.
 */
export function selectBeatsToProcess(
  beats: BeatRow[],
  production: ProductionRow,
  opts: SelectOptions,
): BeatRow[] {
  let budget = budgetRemaining(production);
  if (budget <= 0) return [];

  const eligible = beats
    .filter((b) => b.status !== "failed" && b.status !== "skipped")
    .filter((b) => b.attempts < MAX_BEAT_ATTEMPTS)
    .filter((b) => !isBeatSatisfied(b, production))
    .sort((a, b) => a.idx - b.idx);

  const picked: BeatRow[] = [];
  for (const beat of eligible) {
    if (picked.length >= opts.limit) break;
    // A beat waiting on an already-submitted provider job costs nothing more
    // to poll, so it is never held back by the budget.
    const cost = beat.provider_job_id ? 0 : beatCost(beat, production);
    if (cost > budget) continue;
    budget -= cost;
    picked.push(beat);
  }
  return picked;
}

export type ProductionStatus =
  | "storyboarded" | "generating" | "composing" | "rendering" | "ready" | "failed";

export interface StatusDecision {
  status: ProductionStatus;
  error_message: string | null;
}

/**
 * Where the production stands once this tick's writes have landed.
 *
 * "composing" means every beat that could be produced has been — it is the
 * handoff to the composition stage. A production only fails when a beat is
 * genuinely unrecoverable (out of attempts), not merely unfinished, and a
 * production that has run out of budget stops rather than looping.
 */
export function nextProductionStatus(
  beats: BeatRow[],
  production: ProductionRow,
): StatusDecision {
  if (beats.length === 0) {
    return { status: "failed", error_message: "This production has no beats." };
  }

  const failed = beats.filter((b) => b.status === "failed");
  const outstanding = beats.filter(
    (b) => b.status !== "skipped" && b.status !== "failed" && !isBeatSatisfied(b, production),
  );

  if (outstanding.length === 0) {
    // Some beats may have failed while others finished. A video missing a
    // scene is not a video, so this is a failure with a specific reason
    // rather than a partial success.
    if (failed.length > 0) {
      return {
        status: "failed",
        error_message:
          `${failed.length} of ${beats.length} scenes could not be generated ` +
          `(scene${failed.length === 1 ? "" : "s"} ${failed.map((b) => b.idx + 1).join(", ")}). ` +
          `Revise or retry ${failed.length === 1 ? "it" : "them"}, then run the production again.`,
      };
    }
    return { status: "composing", error_message: null };
  }

  const stuck = outstanding.every((b) => b.attempts >= MAX_BEAT_ATTEMPTS);
  if (stuck) {
    return {
      status: "failed",
      error_message:
        `${outstanding.length} scene${outstanding.length === 1 ? "" : "s"} gave up after ` +
        `${MAX_BEAT_ATTEMPTS} attempts. The generation provider may be unavailable or the ` +
        `prompt may be getting refused.`,
    };
  }

  if (budgetRemaining(production) <= 0) {
    return {
      status: "failed",
      error_message:
        `Generation budget spent (${production.generations_used} calls) with ` +
        `${outstanding.length} scene${outstanding.length === 1 ? "" : "s"} still unmade. ` +
        `Raise the budget to continue.`,
    };
  }

  return { status: "generating", error_message: null };
}

/**
 * Budget from beat count: one visual and one voiceover per beat, plus headroom
 * for retries. Deliberately generous enough that a normal production never hits
 * it, and tight enough that a retry loop cannot run away.
 */
export function defaultBudgetForBeats(beatCount: number): number {
  return Math.max(6, Math.ceil(beatCount * 2 * 1.5));
}

/** Storage path for a beat's generated voiceover. */
export function beatAudioPath(userId: string, productionId: string, idx: number): string {
  // The vault-media bucket's RLS keys off the first path segment being the
  // user id — see the avatars-bucket bug fixed earlier on this branch.
  return `${userId}/productions/${productionId}/beat-${String(idx).padStart(3, "0")}.mp3`;
}
