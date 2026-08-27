// Client mirror of the brand identities the video pipeline produces under.
//
// The authority is supabase/functions/_shared/avatarProfile.ts — the producer
// and asset worker both read it, and the tone and overlay text there is what
// actually reaches the director prompt. This file exists because that module is
// Deno and cannot be imported from the Vite build.
//
// Two copies means drift, so avatarIdentity.test.ts reads both files and fails
// if the keys, rendering styles or overlay styles disagree. Only the fields the
// UI needs are duplicated; the prompt text is deliberately NOT copied here,
// because nothing in the client uses it and a second copy of a paragraph is a
// second thing to keep true.

export type RenderingStyle = "photorealistic" | "animated";
export type OverlayStyle = "none" | "tech_hud" | "motion_analysis";

export const RENDERING_STYLES: RenderingStyle[] = ["photorealistic", "animated"];
export const OVERLAY_STYLES: OverlayStyle[] = ["none", "tech_hud", "motion_analysis"];

export interface AvatarIdentity {
  key: string;
  name: string;
  /** The label the operator actually picks between. */
  mode: string;
  rendering_style: RenderingStyle;
  overlay_style: OverlayStyle;
  domain_tags: string[];
  /** One line, shown under the name in the selector. */
  blurb: string;
}

export const IDENTITIES: AvatarIdentity[] = [
  {
    key: "avatar_skyforge_real",
    name: "SkyForge AI",
    mode: "Tech Mode",
    rendering_style: "photorealistic",
    overlay_style: "tech_hud",
    domain_tags: ["tech", "software", "ai", "architecture", "computer-science"],
    blurb: "Photorealistic presenter. Technical deep dives, with code and system diagrams on screen.",
  },
  {
    key: "avatar_bioneer_animated",
    name: "Bioneer Fitness",
    mode: "Performance Mode",
    rendering_style: "animated",
    overlay_style: "motion_analysis",
    domain_tags: ["fitness", "health", "wellness", "movement", "performance"],
    blurb: "Stylized animated coach. Movement and wellness, with motion-analysis and biometric overlays.",
  },
];

export function identityByKey(key: string | null | undefined): AvatarIdentity | null {
  if (!key) return null;
  return IDENTITIES.find((i) => i.key === key) ?? null;
}

export const OVERLAY_LABELS: Record<OverlayStyle, string> = {
  none: "No overlays",
  tech_hud: "Code, diagrams, terminal HUD",
  motion_analysis: "Joint vectors, rep counts, biometrics",
};

export const RENDERING_LABELS: Record<RenderingStyle, string> = {
  photorealistic: "Photorealistic",
  animated: "Animated",
};
