// SKILL: poster-gen
// Generate marketing posters, flyers, social graphics, and banners via MAVIS.
// Outputs an AI-generated image (Ideogram V2) + an HTML/CSS layout ready to screenshot.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const PLATFORMS_MAP: Record<string, string> = {
  story:       "instagram_story",
  stories:     "instagram_story",
  tiktok:      "tiktok",
  twitter:     "twitter_post",
  tweet:       "twitter_post",
  "x post":    "twitter_post",
  linkedin:    "linkedin_post",
  facebook:    "facebook_post",
  flyer:       "flyer_portrait",
  "a4":        "flyer_portrait",
  poster:      "poster_portrait",
  banner:      "banner",
  instagram:   "instagram_post",
};

function detectPlatform(input: string): string {
  const lower = input.toLowerCase();
  for (const [keyword, platform] of Object.entries(PLATFORMS_MAP)) {
    if (lower.includes(keyword)) return platform;
  }
  return "instagram_post";
}

const PROMPT_GUIDE = `Tell me what to design and I'll generate both an **AI image** (Ideogram V2) and a **pixel-perfect HTML layout** you can screenshot and post.

**What I can make:**
• Instagram posts (1080×1080) and stories (1080×1920)
• TikTok graphics, Twitter/X posts, LinkedIn images, Facebook posts
• Flyers (A4), portrait posters, wide banners

**Example briefs:**
_"Create an Instagram post for SkyforgeAI — headline 'Build Your AI Empire', CTA 'Join Free'. Dark purple and gold, futuristic tech aesthetic."_
_"Design a flyer for a music event called NEXUS. Saturday March 15, underground warehouse, electronic music. Black and neon green, gritty industrial style."_
_"Make a LinkedIn post banner for VANTARA. Tagline: 'Your Life. Gamified.' Clean minimal white and blue."_`;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "poster-gen", output: PROMPT_GUIDE };
  }

  const platform = detectPlatform(input);

  try {
    const { data, error } = await supabase.functions.invoke("mavis-poster-gen", {
      body: {
        brief: input.trim(),
        platform,
        user_id: ctx.userId,
      },
    });

    if (error) throw error;

    const lines: string[] = [];

    const platformLabels: Record<string, string> = {
      instagram_post:  "Instagram Post (1080×1080)",
      instagram_story: "Instagram Story (1080×1920)",
      tiktok:          "TikTok (1080×1920)",
      twitter_post:    "Twitter/X (1200×675)",
      linkedin_post:   "LinkedIn (1200×628)",
      facebook_post:   "Facebook (1200×630)",
      flyer_portrait:  "Flyer / A4 (794×1123)",
      poster_portrait: "Portrait Poster (600×900)",
      banner:          "Wide Banner (1200×400)",
    };

    lines.push(`**POSTER GENERATED — ${platformLabels[data.platform] ?? data.platform_label}**\n`);

    if (data.image_url) {
      lines.push(`**AI Image (Ideogram V2):**`);
      lines.push(data.image_url);
      lines.push("");
    }

    if (data.html_url) {
      lines.push(`**HTML Layout (open in browser → screenshot as PNG):**`);
      lines.push(data.html_url);
      lines.push("");
    } else if (data.html && !data.html_url) {
      lines.push("**HTML Layout:** Generated — save it as a `.html` file and open in any browser to screenshot.");
      lines.push("_(To get a shareable URL for the HTML, set up the `mavis-assets` Supabase Storage bucket.)_");
      lines.push("");
    }

    if (data.fields) {
      lines.push("**Design brief used:**");
      lines.push(`• Brand: ${data.fields.brand}`);
      lines.push(`• Headline: "${data.fields.headline}"`);
      if (data.fields.cta)    lines.push(`• CTA: "${data.fields.cta}"`);
      if (data.fields.style)  lines.push(`• Style: ${data.fields.style}`);
      if (data.fields.colors) lines.push(`• Colors: ${data.fields.colors}`);
    }

    if (data.image_url) {
      lines.push("\n_Ready to post via Nora: 'post this to Instagram' or 'schedule this on LinkedIn'._");
    }

    return { skillName: "poster-gen", output: lines.join("\n"), data };
  } catch (err) {
    return {
      skillName: "poster-gen",
      output: `Poster generation error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};

registerSkill({
  name: "poster-gen",
  description: "Generate marketing posters, flyers, social graphics, and banners — AI image + HTML/CSS layout",
  keywords: [
    "create a poster", "design a poster", "make a poster", "generate a poster",
    "design a flyer", "make a flyer", "create a flyer",
    "create a banner", "design a banner", "make a banner",
    "social graphic", "social media post design", "marketing graphic",
    "create marketing material", "design social post", "instagram post design",
    "promotional poster", "event flyer", "create promotion",
    "design this", "marketing poster", "poster for",
  ],
}, handler);
