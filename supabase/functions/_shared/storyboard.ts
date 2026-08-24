// Storyboard planning for MAVIS video productions.
//
// Pure functions only — no Deno APIs, no network, no Supabase client — so the
// planning rules can be unit-tested from vitest (see
// src/mavis/__tests__/storyboard.test.ts) even though the edge functions that
// use them run on Deno. This is where the bugs actually live: an LLM writing a
// storyboard returns plausible-looking JSON with missing fields, absurd beat
// durations, and a total runtime nowhere near what the operator asked for.
// Everything downstream (asset generation, composition, render) assumes a beat
// list that is already sane, so it gets made sane exactly once, here.

export type ProductionType = "faceless" | "avatar" | "persona_ugc";
export type VideoFormat = "9:16" | "1:1" | "16:9";
export type VisualMode = "stills" | "video";

export const PRODUCTION_TYPES: ProductionType[] = ["faceless", "avatar", "persona_ugc"];
export const VIDEO_FORMATS: VideoFormat[] = ["9:16", "1:1", "16:9"];
export const VISUAL_MODES: VisualMode[] = ["stills", "video"];

/** Render dimensions per format. Fed straight to mavis-hyperframes. */
export const FORMAT_DIMENSIONS: Record<VideoFormat, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "1:1":  { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
};

export const MAX_BEATS = 24;
export const MIN_BEAT_SECONDS = 1.5;
export const MAX_BEAT_SECONDS = 15;
export const MIN_TARGET_SECONDS = 5;
export const MAX_TARGET_SECONDS = 600;

// Narration pace used to estimate a beat's duration when the model omits one.
// ~150 wpm is a normal delivery for voiceover — slower than conversation,
// which is what makes narration intelligible over moving pictures.
export const WORDS_PER_SECOND = 2.5;

export interface RawBeat {
  narration?: unknown;
  visual_prompt?: unknown;
  on_screen_text?: unknown;
  seconds?: unknown;
}

export interface Beat {
  idx: number;
  narration: string;
  visual_prompt: string;
  on_screen_text: string;
  seconds: number;
}

export interface StoryboardPlan {
  beats: Beat[];
  total_seconds: number;
  warnings: string[];
}

export interface NormalizeOptions {
  target_seconds: number;
  production_type: ProductionType;
}

function asText(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asFiniteNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Round to 2dp without accumulating binary float noise across a sum. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function clampTargetSeconds(v: unknown, fallback = 45): number {
  const n = asFiniteNumber(v);
  if (n === null) return fallback;
  return Math.round(clamp(n, MIN_TARGET_SECONDS, MAX_TARGET_SECONDS));
}

export function coerceProductionType(v: unknown, fallback: ProductionType = "faceless"): ProductionType {
  const s = asText(v).toLowerCase().replace(/[\s-]+/g, "_");
  return (PRODUCTION_TYPES as string[]).includes(s) ? (s as ProductionType) : fallback;
}

export function coerceFormat(v: unknown, fallback: VideoFormat = "9:16"): VideoFormat {
  const s = asText(v);
  return (VIDEO_FORMATS as string[]).includes(s) ? (s as VideoFormat) : fallback;
}

export function coerceVisualMode(v: unknown, fallback: VisualMode = "stills"): VisualMode {
  const s = asText(v).toLowerCase();
  return (VISUAL_MODES as string[]).includes(s) ? (s as VisualMode) : fallback;
}

/**
 * In avatar and persona_ugc productions the performer IS the visual, so a beat
 * without its own visual prompt is legitimate — the composition falls back to
 * the avatar/persona footage. In a faceless production a beat with no visual is
 * a blank screen, so one gets derived from the narration rather than dropped.
 */
export function visualRequiredFor(type: ProductionType): boolean {
  return type === "faceless";
}

function deriveVisualPrompt(narration: string): string {
  // A literal reading of the line is a poor image prompt, but it is far better
  // than an empty frame, and the operator can revise any beat afterwards.
  const cleaned = narration.replace(/\s+/g, " ").trim();
  return cleaned ? `Cinematic B-roll illustrating: ${cleaned}` : "";
}

export function estimateSeconds(narration: string): number {
  const words = narration.split(/\s+/).filter(Boolean).length;
  if (words === 0) return MIN_BEAT_SECONDS;
  return clamp(words / WORDS_PER_SECOND, MIN_BEAT_SECONDS, MAX_BEAT_SECONDS);
}

/**
 * Turn whatever the model returned into a beat list that the rest of the
 * pipeline can rely on: every beat has narration or a visual, a duration inside
 * the per-beat bounds, and the whole thing lands near the requested runtime.
 *
 * Never throws on bad input — an empty beat list plus warnings is the failure
 * mode, so the caller can report something useful to the operator instead of a
 * stack trace.
 */
export function normalizeStoryboard(raw: unknown, opts: NormalizeOptions): StoryboardPlan {
  const warnings: string[] = [];
  const target = clampTargetSeconds(opts.target_seconds);
  const needsVisual = visualRequiredFor(opts.production_type);

  // The model is asked for {beats:[...]} but frequently returns a bare array.
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { beats?: unknown })?.beats)
      ? ((raw as { beats: unknown[] }).beats)
      : [];

  if (list.length === 0) {
    warnings.push("The storyboard came back with no beats.");
    return { beats: [], total_seconds: 0, warnings };
  }

  const kept: Beat[] = [];
  let dropped = 0;

  for (const entry of list) {
    if (kept.length >= MAX_BEATS) { dropped++; continue; }
    const b = (entry ?? {}) as RawBeat;

    const narration = asText(b.narration);
    let visual = asText(b.visual_prompt);
    const onScreen = asText(b.on_screen_text);

    // A beat carrying neither a line nor a picture renders as dead air.
    if (!narration && !visual) { dropped++; continue; }

    if (!visual && needsVisual) visual = deriveVisualPrompt(narration);

    const declared = asFiniteNumber(b.seconds);
    const seconds = declared === null
      ? estimateSeconds(narration)
      : clamp(declared, MIN_BEAT_SECONDS, MAX_BEAT_SECONDS);

    kept.push({
      idx: kept.length,
      narration,
      visual_prompt: visual,
      on_screen_text: onScreen,
      seconds: round2(seconds),
    });
  }

  if (dropped > 0) {
    warnings.push(
      list.length > MAX_BEATS
        ? `Kept ${kept.length} beats; dropped ${dropped} (limit is ${MAX_BEATS}, or the beat was empty).`
        : `Dropped ${dropped} empty beat${dropped === 1 ? "" : "s"}.`,
    );
  }

  if (kept.length === 0) {
    warnings.push("Every beat was empty — nothing to produce.");
    return { beats: [], total_seconds: 0, warnings };
  }

  const fitted = fitToTarget(kept, target, warnings);
  return {
    beats: fitted,
    total_seconds: round2(fitted.reduce((sum, b) => sum + b.seconds, 0)),
    warnings,
  };
}

/**
 * Scale beat durations proportionally toward the requested runtime.
 *
 * Per-beat clamping means the target is not always reachable — twelve beats can
 * never total ten seconds when no beat may run under 1.5s. Rather than
 * silently returning something far off, the shortfall is reported as a warning
 * so the operator hears about it in chat.
 */
export function fitToTarget(beats: Beat[], target: number, warnings: string[]): Beat[] {
  const raw = beats.reduce((sum, b) => sum + b.seconds, 0);
  if (raw <= 0) return beats;

  // Anything inside 10% reads as the requested length; rescaling it would only
  // add float noise to durations the model may have chosen deliberately.
  if (Math.abs(raw - target) / target <= 0.1) return beats;

  const factor = target / raw;
  const scaled = beats.map((b) => ({
    ...b,
    seconds: round2(clamp(b.seconds * factor, MIN_BEAT_SECONDS, MAX_BEAT_SECONDS)),
  }));

  const total = scaled.reduce((sum, b) => sum + b.seconds, 0);
  if (Math.abs(total - target) / target > 0.15) {
    warnings.push(
      `Runtime lands at about ${Math.round(total)}s rather than the ${target}s asked for — ` +
      `${beats.length} beats can't be stretched or compressed further without going outside ` +
      `${MIN_BEAT_SECONDS}–${MAX_BEAT_SECONDS}s per beat.`,
    );
  }
  return scaled;
}

/**
 * How many beats to ask the model for. Long-form gets proportionally fewer,
 * longer beats — a five-minute video as ninety two-second cuts is unwatchable.
 */
export function suggestBeatCount(targetSeconds: number): number {
  const t = clampTargetSeconds(targetSeconds);
  if (t <= 20) return clamp(Math.round(t / 4), 2, 5);
  if (t <= 60) return clamp(Math.round(t / 6), 4, 10);
  if (t <= 180) return clamp(Math.round(t / 9), 8, 18);
  return clamp(Math.round(t / 14), 12, MAX_BEATS);
}
