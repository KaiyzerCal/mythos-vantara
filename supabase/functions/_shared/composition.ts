// Builds the HTML timeline a video production renders from.
//
// Pure functions only — no Deno APIs, no network — so the composition can be
// asserted against in vitest without a render service existing. That matters
// more here than elsewhere in the pipeline: the renderer is the one piece of
// infrastructure that is not stood up yet, so this module's output is checked
// by tests rather than by watching a video come out.
//
// Output follows HyperFrames' conventions, the same ones mavis-chat's existing
// render_video tool documents: a root element carrying data-composition-id /
// data-width / data-height, and timed children carrying data-start and
// data-duration in seconds.

import { FORMAT_DIMENSIONS, type VideoFormat, type VisualMode } from "./storyboard.ts";

export const DEFAULT_FPS = 30;

/** mavis-hyperframes forwards at most 20 asset URLs to the render service. */
export const MAX_DECLARED_ASSETS = 20;

export interface CompositionBeat {
  idx: number;
  narration: string;
  on_screen_text: string;
  seconds: number;
  asset_url: string | null;
  audio_url: string | null;
}

export interface CompositionInput {
  production_id: string;
  title: string;
  format: VideoFormat;
  visual_mode: VisualMode;
  beats: CompositionBeat[];
}

export interface Composition {
  html: string;
  assets: string[];
  width: number;
  height: number;
  fps: number;
  total_seconds: number;
  /** Set when there are more asset URLs than the render proxy will forward. */
  asset_overflow: number;
}

/**
 * Escape text for HTML body content.
 *
 * Narration and captions are written by a language model from an operator's
 * brief. An ampersand or an angle bracket in a caption would corrupt the
 * document, and a caption containing markup would inject elements into the
 * timeline — so nothing reaches the document unescaped.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Escape a URL for use in an attribute.
 *
 * Asset URLs come back from generation providers and are signed, so they carry
 * query strings full of ampersands — unescaped, those truncate the attribute
 * and the asset silently fails to load. javascript: and data:text/html URLs are
 * refused outright rather than escaped, since neither can be a legitimate
 * picture or soundtrack.
 */
export function escapeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\s*(javascript|vbscript):/i.test(trimmed)) return null;
  if (/^\s*data:(?!image\/|audio\/|video\/)/i.test(trimmed)) return null;
  return escapeHtml(trimmed);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Absolute start time for each beat, accumulated in order.
 *
 * Exported because this is the single most consequential calculation in the
 * module: an error here does not break the render, it desynchronises every
 * caption and voiceover from its picture for the rest of the video.
 */
export function beatTimeline(beats: CompositionBeat[]): Array<{ start: number; duration: number }> {
  let cursor = 0;
  return beats.map((b) => {
    const duration = Math.max(0.1, Number(b.seconds) || 0.1);
    const entry = { start: round3(cursor), duration: round3(duration) };
    cursor += duration;
    return entry;
  });
}

const BASE_STYLE = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #000; overflow: hidden; }
  .stage { position: relative; overflow: hidden; background: #000; }
  .scene { position: absolute; inset: 0; overflow: hidden; }
  .scene img, .scene video { width: 100%; height: 100%; object-fit: cover; display: block; }
  /* Slow push on stills so a static frame still reads as motion. */
  .scene img.kb { animation: kb var(--dur) linear both; transform-origin: center; }
  @keyframes kb { from { transform: scale(1.0); } to { transform: scale(1.08); } }
  .caption {
    position: absolute; left: 6%; right: 6%; bottom: 12%;
    text-align: center; font-weight: 700; line-height: 1.25;
    color: #fff; text-shadow: 0 2px 12px rgba(0,0,0,.75), 0 0 2px rgba(0,0,0,.9);
    font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
  }
  .blank { position: absolute; inset: 0; background: #0b0b0f; }
`.trim();

/**
 * Turn a production's finished beats into one renderable HTML document.
 *
 * Every beat becomes a timed scene; its narration becomes a timed audio
 * element starting at the same moment, so the voiceover cannot drift from the
 * picture regardless of how the renderer schedules them. A beat with no
 * generated visual — legitimate in avatar and persona productions — renders as
 * a plain ground rather than a broken image.
 */
export function buildComposition(input: CompositionInput): Composition {
  const { width, height } = FORMAT_DIMENSIONS[input.format];
  const timeline = beatTimeline(input.beats);
  const assets: string[] = [];

  // Caption size is derived from the frame so vertical and landscape output
  // read the same, rather than being tuned for one and wrong on the other.
  const captionPx = Math.round(height * 0.032);

  const parts: string[] = [];
  input.beats.forEach((beat, i) => {
    const { start, duration } = timeline[i];
    const timing = `data-start="${start}" data-duration="${duration}"`;

    const src = beat.asset_url ? escapeUrl(beat.asset_url) : null;
    let visual: string;
    if (!src) {
      visual = `<div class="blank"></div>`;
    } else if (input.visual_mode === "video") {
      visual = `<video src="${src}" muted playsinline></video>`;
      assets.push(beat.asset_url!);
    } else {
      visual = `<img class="kb" src="${src}" alt="" style="--dur:${duration}s">`;
      assets.push(beat.asset_url!);
    }

    const caption = beat.on_screen_text.trim()
      ? `<div class="caption" style="font-size:${captionPx}px">${escapeHtml(beat.on_screen_text.trim())}</div>`
      : "";

    parts.push(`  <div class="scene" ${timing}>${visual}${caption}</div>`);

    const audio = beat.audio_url ? escapeUrl(beat.audio_url) : null;
    if (audio) {
      parts.push(`  <audio src="${audio}" ${timing}></audio>`);
      assets.push(beat.audio_url!);
    }
  });

  const total = timeline.length
    ? round3(timeline[timeline.length - 1].start + timeline[timeline.length - 1].duration)
    : 0;

  const html = [
    `<style>${BASE_STYLE}</style>`,
    `<div class="stage" data-composition-id="${escapeHtml(input.production_id)}" ` +
      `data-width="${width}" data-height="${height}" data-duration="${total}" ` +
      `data-title="${escapeHtml(input.title)}" ` +
      `style="width:${width}px;height:${height}px">`,
    ...parts,
    `</div>`,
  ].join("\n");

  return {
    html,
    assets: assets.slice(0, MAX_DECLARED_ASSETS),
    asset_overflow: Math.max(0, assets.length - MAX_DECLARED_ASSETS),
    width,
    height,
    fps: DEFAULT_FPS,
    total_seconds: total,
  };
}
