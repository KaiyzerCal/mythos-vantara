// Brand identity for a production: who is presenting, in what visual register,
// and with what overlays.
//
// Two identities drive this, and they pull in opposite directions:
//
//   SkyForge / CodexOS — a photorealistic presenter for technical material.
//     Authoritative, precise, code and architecture on screen.
//   Bioneer Fitness    — a stylized animated coach for movement and wellness.
//     Energetic, kinetic, motion-analysis and biometric overlays.
//
// Everything here is pure: no network, no Deno APIs, no database. The producer
// and the asset worker both need these decisions, and neither environment can
// be integration-tested from the dev container, so the logic lives somewhere a
// plain vitest run can reach it. Same reasoning as storyboard.ts.
//
// On where this is stored: these fields extend the existing `personas` table
// rather than living in a new AvatarConfig table. personas already carries
// voice_id, voice_settings, voice_style, system_prompt, archetype and
// content_niche — a parallel table would have duplicated all of it and left two
// places to disagree about who a persona is.

export type RenderingStyle = "photorealistic" | "animated";
export type OverlayStyle = "none" | "tech_hud" | "motion_analysis";

export const RENDERING_STYLES: RenderingStyle[] = ["photorealistic", "animated"];
export const OVERLAY_STYLES: OverlayStyle[] = ["none", "tech_hud", "motion_analysis"];

/**
 * Visual assets and provider overrides for one identity.
 *
 * The provider fields are deliberately optional. Every image and video model in
 * the cascade is general-purpose — none is documented as "the animated one" —
 * so the honest default is to leave routing on auto and let the style prefix in
 * the prompt do the work. These exist so a provider that demonstrably suits one
 * identity can be pinned without a code change, not because a hardcoded mapping
 * would be correct today.
 */
export interface AssetPaths {
  /** Reference frame for the presenter — a face for photoreal, a character sheet for animated. */
  base_image?: string;
  /** Seed clip for motion continuity across beats. */
  video_seed?: string;
  /** Motion-graphics template applied over beats (lower thirds, HUD frame). */
  motion_template?: string;
  /** Explicit cascade override; undefined means auto. */
  image_provider?: string;
  video_provider?: string;
}

export interface AvatarProfile {
  /** personas.id, or null for a preset the operator has not forged yet. */
  id: string | null;
  /** Stable slug. Survives renames, which is what the UI and tools key on. */
  key: string;
  name: string;
  rendering_style: RenderingStyle;
  overlay_style: OverlayStyle;
  domain_tags: string[];
  asset_paths: AssetPaths;
  voice_id: string | null;
  voice_settings: Record<string, unknown>;
  /** One line of register, spliced into the director prompt. */
  tone: string;
  /** What this identity is an authority on, and who is listening. */
  domain_context: string;
}

export function coerceRenderingStyle(v: unknown, fallback: RenderingStyle = "photorealistic"): RenderingStyle {
  return RENDERING_STYLES.includes(v as RenderingStyle) ? (v as RenderingStyle) : fallback;
}

export function coerceOverlayStyle(v: unknown, fallback: OverlayStyle = "none"): OverlayStyle {
  return OVERLAY_STYLES.includes(v as OverlayStyle) ? (v as OverlayStyle) : fallback;
}

function coerceTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const t of v) {
    const s = String(t ?? "").trim().toLowerCase();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

function coerceAssetPaths(v: unknown): AssetPaths {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const src = v as Record<string, unknown>;
  const out: AssetPaths = {};
  for (const k of ["base_image", "video_seed", "motion_template", "image_provider", "video_provider"] as const) {
    const s = typeof src[k] === "string" ? (src[k] as string).trim() : "";
    if (s) out[k] = s;
  }
  return out;
}

// ── The two shipped identities ──────────────────────────────────────────────
//
// Presets, not seeded rows. Writing rows into someone's personas table on
// migration would invent data in their account; a preset is instantiated when
// they pick it, and until then costs nothing.

export const SKYFORGE: AvatarProfile = {
  id: null,
  key: "avatar_skyforge_real",
  name: "SkyForge AI",
  rendering_style: "photorealistic",
  overlay_style: "tech_hud",
  domain_tags: ["tech", "software", "ai", "architecture", "computer-science"],
  asset_paths: {},
  voice_id: null,
  voice_settings: {},
  tone:
    "Professional and authoritative. Precise technical language used correctly, never as decoration. " +
    "Explains the mechanism, not just the outcome. No hype, no superlatives, no salesmanship.",
  domain_context:
    "Technical deep dives: computer science, AI architecture, systems design, software demos. " +
    "The audience is technical and will notice a hand-wave, so name the actual components and trade-offs.",
};

export const BIONEER: AvatarProfile = {
  id: null,
  key: "avatar_bioneer_animated",
  name: "Bioneer Fitness",
  rendering_style: "animated",
  overlay_style: "motion_analysis",
  domain_tags: ["fitness", "health", "wellness", "movement", "performance"],
  asset_paths: {},
  voice_id: null,
  voice_settings: {},
  tone:
    "Energetic, motivational and approachable. Second person, active voice, short punchy lines that carry momentum. " +
    "Coaching a person through a movement, not lecturing them about it.",
  domain_context:
    "Health, wellness, kinetic movement and human performance. " +
    "Cue the body concretely — which joint, which direction, what it should feel like — rather than describing exercise in the abstract.",
};

export const PRESETS: AvatarProfile[] = [SKYFORGE, BIONEER];

export function presetByKey(key: unknown): AvatarProfile | null {
  const k = String(key ?? "").trim();
  return PRESETS.find((p) => p.key === k) ?? null;
}

/**
 * Build a profile from a `personas` row.
 *
 * Falls back to the preset named by `avatar_key` for anything the row leaves
 * unset, so forging "SkyForge AI" and filling in only a voice still yields the
 * full identity rather than a half-configured one.
 */
export function normalizeAvatarProfile(row: Record<string, unknown> | null | undefined): AvatarProfile | null {
  if (!row) return null;
  const base = presetByKey(row.avatar_key);

  const tags = coerceTags(row.domain_tags);
  const niche = String(row.content_niche ?? "").trim().toLowerCase();

  return {
    id: row.id ? String(row.id) : null,
    key: String(row.avatar_key ?? "").trim() || `persona_${String(row.id ?? "unknown")}`,
    name: String(row.name ?? base?.name ?? "Presenter"),
    rendering_style: coerceRenderingStyle(row.rendering_style, base?.rendering_style ?? "photorealistic"),
    overlay_style: coerceOverlayStyle(row.overlay_style, base?.overlay_style ?? "none"),
    // content_niche is the pre-existing single-value field; fold it in so an
    // older persona that only set that still routes by domain.
    domain_tags: tags.length > 0 ? tags : (niche ? [niche] : base?.domain_tags ?? []),
    asset_paths: { ...(base?.asset_paths ?? {}), ...coerceAssetPaths(row.asset_paths) },
    voice_id: row.voice_id ? String(row.voice_id) : base?.voice_id ?? null,
    voice_settings:
      row.voice_settings && typeof row.voice_settings === "object" && !Array.isArray(row.voice_settings)
        ? (row.voice_settings as Record<string, unknown>)
        : base?.voice_settings ?? {},
    // A forged persona's own system_prompt is the operator's words about who
    // this is, so it outranks the preset's generic domain paragraph.
    tone: String(row.voice_style ?? "").trim() || base?.tone || "",
    domain_context: String(row.system_prompt ?? "").trim() || base?.domain_context || "",
  };
}

// ── Prompt shaping ──────────────────────────────────────────────────────────

/**
 * Identity fragment for the storyboard director prompt: who is speaking, about
 * what, in what register. Appended to the shared director rules, so it is
 * additive — an empty profile changes nothing about the existing behaviour.
 */
export function identityPromptWrapper(profile: AvatarProfile | null): string {
  if (!profile) return "";
  const lines: string[] = [`\nIDENTITY — ${profile.name}\n`];
  if (profile.domain_context) lines.push(`- Subject matter: ${profile.domain_context}\n`);
  if (profile.tone) lines.push(`- Register: ${profile.tone}\n`);
  if (profile.domain_tags.length > 0) {
    lines.push(`- Stay inside this territory: ${profile.domain_tags.join(", ")}.\n`);
  }
  lines.push(
    profile.rendering_style === "animated"
      ? "- The presenter is an animated character, so narration can reference motion and gesture freely; " +
        "the renderer can show it.\n"
      : "- The presenter is a photorealistic human, so keep narration to what a person could plausibly say " +
        "to camera in one take.\n",
  );
  const overlay = overlayDirective(profile);
  if (overlay) lines.push(overlay);
  return lines.join("");
}

/**
 * What to put on screen over the presenter. This is a director instruction, not
 * a render step — it steers on_screen_text and visual_prompt so the overlays a
 * beat asks for are ones the pipeline can actually produce.
 */
export function overlayDirective(profile: AvatarProfile | null): string {
  switch (profile?.overlay_style) {
    case "tech_hud":
      return (
        "- Overlays: code snippets, system diagrams and terminal output are expected. " +
        "When a beat is carried by something written down, put the exact text in on_screen_text " +
        "and keep narration to what the text does not already say.\n"
      );
    case "motion_analysis":
      return (
        "- Overlays: motion-analysis graphics — joint and skeletal vectors, rep counters, biometric callouts. " +
        "When a beat is about a movement, name the joint or plane in on_screen_text so the overlay has an anchor.\n"
      );
    default:
      return "";
  }
}

/**
 * Style prefix prepended to every beat's image or clip prompt.
 *
 * This, rather than provider routing, is what actually separates the two looks:
 * the models in the cascade are all general-purpose, and a prompt that says
 * "photorealistic, shot on a full-frame camera" gets a photorealistic frame out
 * of any of them.
 */
export function visualPromptPrefix(profile: AvatarProfile | null): string {
  if (!profile) return "";
  if (profile.rendering_style === "animated") {
    return (
      "Stylized 3D animated character render, clean cel-shaded lighting, bold readable silhouette, " +
      "vibrant saturated palette, motion-graphics friendly negative space. "
    );
  }
  return (
    "Photorealistic, shot on a full-frame camera with a fast prime lens, natural skin texture, " +
    "controlled studio key light, shallow depth of field. "
  );
}

/** Apply the identity's visual register to one beat prompt. */
export function styleVisualPrompt(prompt: string, profile: AvatarProfile | null): string {
  const body = prompt.trim();
  if (!body) return body;
  const prefix = visualPromptPrefix(profile);
  // Idempotent: the worker retries beats, and a beat re-prompted three times
  // must not accumulate three copies of the prefix.
  return prefix && !body.startsWith(prefix.trim()) ? prefix + body : body;
}

// ── Provider routing ────────────────────────────────────────────────────────

/**
 * Which image provider to ask for, or undefined for the automatic cascade.
 *
 * Undefined is the default on purpose. Pinning a provider per style would be a
 * guess dressed as a decision — the cascade already falls back on failure, and
 * an explicit pin defeats that. A profile that has evidence for a particular
 * model sets asset_paths.image_provider and this honours it.
 */
export function imageProviderFor(profile: AvatarProfile | null): string | undefined {
  return profile?.asset_paths.image_provider || undefined;
}

export function videoProviderFor(profile: AvatarProfile | null): string | undefined {
  return profile?.asset_paths.video_provider || undefined;
}

/**
 * Pick the identity a brief belongs to, by domain-tag hit count.
 *
 * Returns null on a tie or no hits rather than guessing — the caller then keeps
 * whatever the operator explicitly chose, which is the safer default than
 * silently switching brand identity on an ambiguous brief.
 */
export function suggestProfileForBrief(
  brief: string,
  profiles: AvatarProfile[] = PRESETS,
): AvatarProfile | null {
  const text = ` ${brief.toLowerCase()} `;
  let best: AvatarProfile | null = null;
  let bestScore = 0;
  let tied = false;

  for (const p of profiles) {
    let score = 0;
    for (const tag of p.domain_tags) {
      // Word-boundary match: "ai" must not fire on "training" or "said".
      if (new RegExp(`(^|[^a-z0-9])${tag.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}([^a-z0-9]|$)`).test(text)) {
        score++;
      }
    }
    if (score > bestScore) {
      best = p;
      bestScore = score;
      tied = false;
    } else if (score === bestScore && score > 0) {
      tied = true;
    }
  }
  return bestScore > 0 && !tied ? best : null;
}
