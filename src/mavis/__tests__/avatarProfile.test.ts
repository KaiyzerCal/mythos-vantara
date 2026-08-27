// Behaviour of the identity module the pipeline runs on.
//
// avatarIdentity.test.ts checks the two copies agree; this checks the logic is
// right. It imports the Deno module directly — it has no Deno APIs and no
// remote imports precisely so a vitest run can reach it, which matters here
// because deno.land is not reachable from this environment and `deno check`
// cannot be run against the functions that import supabase-js.
import { describe, it, expect } from "vitest";
import {
  SKYFORGE, BIONEER, PRESETS, presetByKey,
  coerceRenderingStyle, coerceOverlayStyle,
  normalizeAvatarProfile, identityPromptWrapper, overlayDirective,
  visualPromptPrefix, styleVisualPrompt,
  imageProviderFor, videoProviderFor, suggestProfileForBrief,
} from "../../../supabase/functions/_shared/avatarProfile.ts";

describe("coercion refuses anything not in the vocabulary", () => {
  it("falls back rather than passing an invalid style through to the CHECK", () => {
    expect(coerceRenderingStyle("claymation")).toBe("photorealistic");
    expect(coerceRenderingStyle(null)).toBe("photorealistic");
    expect(coerceRenderingStyle("animated")).toBe("animated");
    expect(coerceOverlayStyle("sparkles")).toBe("none");
    expect(coerceOverlayStyle("tech_hud")).toBe("tech_hud");
  });

  it("honours a caller-supplied fallback", () => {
    expect(coerceRenderingStyle(undefined, "animated")).toBe("animated");
    expect(coerceOverlayStyle(undefined, "motion_analysis")).toBe("motion_analysis");
  });
});

describe("presets", () => {
  it("resolves by key and rejects an unknown one", () => {
    expect(presetByKey("avatar_skyforge_real")).toBe(SKYFORGE);
    expect(presetByKey("avatar_bioneer_animated")).toBe(BIONEER);
    expect(presetByKey("avatar_nonexistent")).toBeNull();
    expect(presetByKey(null)).toBeNull();
  });

  it("gives the two identities opposite looks", () => {
    expect(SKYFORGE.rendering_style).toBe("photorealistic");
    expect(BIONEER.rendering_style).toBe("animated");
    expect(SKYFORGE.overlay_style).toBe("tech_hud");
    expect(BIONEER.overlay_style).toBe("motion_analysis");
  });

  it("pins no provider by default", () => {
    // Pinning would defeat the cascade's fallback on provider failure.
    for (const p of PRESETS) {
      expect(imageProviderFor(p), p.key).toBeUndefined();
      expect(videoProviderFor(p), p.key).toBeUndefined();
    }
  });
});

describe("normalizeAvatarProfile", () => {
  it("returns null for no row", () => {
    expect(normalizeAvatarProfile(null)).toBeNull();
    expect(normalizeAvatarProfile(undefined)).toBeNull();
  });

  it("fills gaps from the preset named by avatar_key", () => {
    // Forging an identity and setting only a name must not silently drop the
    // rendering style and overlays that make it that identity.
    const p = normalizeAvatarProfile({
      id: "row-1", name: "Bioneer Fitness", avatar_key: "avatar_bioneer_animated",
    })!;
    expect(p.rendering_style).toBe("animated");
    expect(p.overlay_style).toBe("motion_analysis");
    expect(p.domain_tags).toEqual(BIONEER.domain_tags);
    expect(p.id).toBe("row-1");
  });

  it("lets a stored row override its preset", () => {
    const p = normalizeAvatarProfile({
      id: "row-2", avatar_key: "avatar_bioneer_animated",
      rendering_style: "photorealistic", overlay_style: "tech_hud",
    })!;
    expect(p.rendering_style).toBe("photorealistic");
    expect(p.overlay_style).toBe("tech_hud");
  });

  it("defaults a persona with no preset to the neutral look", () => {
    const p = normalizeAvatarProfile({ id: "row-3", name: "Custom" })!;
    expect(p.rendering_style).toBe("photorealistic");
    expect(p.overlay_style).toBe("none");
    expect(p.key).toBe("persona_row-3");
  });

  it("folds the legacy content_niche field into domain tags", () => {
    // Personas predating this feature only have content_niche; without this
    // they would route to nothing.
    const p = normalizeAvatarProfile({ id: "r", name: "N", content_niche: "Fitness" })!;
    expect(p.domain_tags).toEqual(["fitness"]);
  });

  it("prefers explicit domain_tags over content_niche", () => {
    const p = normalizeAvatarProfile({
      id: "r", name: "N", content_niche: "fitness", domain_tags: ["tech", "ai"],
    })!;
    expect(p.domain_tags).toEqual(["tech", "ai"]);
  });

  it("normalizes and dedupes tags", () => {
    const p = normalizeAvatarProfile({ id: "r", domain_tags: [" Tech ", "TECH", "ai", ""] })!;
    expect(p.domain_tags).toEqual(["tech", "ai"]);
  });

  it("ignores malformed asset_paths instead of throwing", () => {
    expect(normalizeAvatarProfile({ id: "r", asset_paths: "nonsense" })!.asset_paths).toEqual({});
    expect(normalizeAvatarProfile({ id: "r", asset_paths: ["a"] })!.asset_paths).toEqual({});
    expect(normalizeAvatarProfile({ id: "r", asset_paths: { base_image: 7 } })!.asset_paths).toEqual({});
  });

  it("honours a provider pin from asset_paths", () => {
    const p = normalizeAvatarProfile({
      id: "r", asset_paths: { image_provider: "flux-pro", video_provider: "veo" },
    })!;
    expect(imageProviderFor(p)).toBe("flux-pro");
    expect(videoProviderFor(p)).toBe("veo");
  });

  it("lets a forged persona's own prompt outrank the preset blurb", () => {
    const p = normalizeAvatarProfile({
      id: "r", avatar_key: "avatar_skyforge_real", system_prompt: "Only ever discusses Rust.",
    })!;
    expect(p.domain_context).toBe("Only ever discusses Rust.");
  });
});

describe("prompt shaping", () => {
  it("adds nothing at all when there is no identity", () => {
    // The neutral path must be byte-identical to the pre-feature behaviour.
    expect(identityPromptWrapper(null)).toBe("");
    expect(overlayDirective(null)).toBe("");
    expect(visualPromptPrefix(null)).toBe("");
    expect(styleVisualPrompt("a lone tree", null)).toBe("a lone tree");
  });

  it("names the identity and its territory", () => {
    const w = identityPromptWrapper(SKYFORGE);
    expect(w).toContain("SkyForge AI");
    expect(w).toContain("architecture");
    expect(w).toContain(SKYFORGE.tone);
  });

  it("asks for the overlays that identity implies", () => {
    expect(overlayDirective(SKYFORGE)).toMatch(/code snippets|diagrams|terminal/i);
    expect(overlayDirective(BIONEER)).toMatch(/joint|skeletal|biometric/i);
    expect(overlayDirective({ ...SKYFORGE, overlay_style: "none" })).toBe("");
  });

  it("tells the director what the renderer can show", () => {
    expect(identityPromptWrapper(BIONEER)).toMatch(/animated character/i);
    expect(identityPromptWrapper(SKYFORGE)).toMatch(/photorealistic human/i);
  });

  it("gives the two identities genuinely different visual prefixes", () => {
    expect(visualPromptPrefix(SKYFORGE)).toMatch(/photorealistic/i);
    expect(visualPromptPrefix(BIONEER)).toMatch(/animated|cel-shaded/i);
    expect(visualPromptPrefix(SKYFORGE)).not.toBe(visualPromptPrefix(BIONEER));
  });

  it("is idempotent, because the worker retries beats", () => {
    // Three attempts at one beat must not stack three copies of the prefix.
    const once = styleVisualPrompt("a barbell on a rack", BIONEER);
    expect(styleVisualPrompt(once, BIONEER)).toBe(once);
    expect(styleVisualPrompt(styleVisualPrompt(once, BIONEER), BIONEER)).toBe(once);
  });

  it("leaves an empty prompt empty", () => {
    // Avatar beats carry no visual_prompt; prefixing "" would send the image
    // generator a style with no subject.
    expect(styleVisualPrompt("", SKYFORGE)).toBe("");
    expect(styleVisualPrompt("   ", SKYFORGE)).toBe("");
  });
});

describe("routing a brief to an identity", () => {
  it("routes on unambiguous subject matter", () => {
    expect(suggestProfileForBrief("explain how a transformer ai architecture works")).toBe(SKYFORGE);
    expect(suggestProfileForBrief("a 30 second hip mobility movement drill")).toBe(BIONEER);
  });

  it("returns null rather than guessing on a brief that hits neither", () => {
    expect(suggestProfileForBrief("a video about medieval bread")).toBeNull();
    expect(suggestProfileForBrief("")).toBeNull();
  });

  it("returns null on a tie rather than switching brand identity", () => {
    // Silently adopting the wrong brand voice is worse than staying neutral.
    expect(suggestProfileForBrief("ai for fitness")).toBeNull();
  });

  it("matches on word boundaries, not substrings", () => {
    // "ai" inside "training" or "said" must not route a fitness brief to the
    // technical identity.
    expect(suggestProfileForBrief("said the trainer")).toBeNull();
    expect(suggestProfileForBrief("chairs and repairs")).toBeNull();
  });

  it("is case insensitive", () => {
    expect(suggestProfileForBrief("A deep dive on SOFTWARE ARCHITECTURE")).toBe(SKYFORGE);
  });
});
