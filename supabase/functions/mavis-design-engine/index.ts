// mavis-design-engine — MAVIS Design Engine Edge Function
// Routes design generation requests through Claude (server-side API key)
// and stores results in Supabase. Never exposes the API key to the client.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ─── DESIGN CONSTANTS ────────────────────────────────────────

const DESIGN_LAWS = [
  "Fitts's Law: CTAs must be large (min 44px), centrally placed, and separated from distractors.",
  "Jakob's Law: Innovate in content, not navigation. Use familiar patterns for menus and forms.",
  "Aesthetic-Usability Effect: Invest in visual polish — it directly increases perceived functionality.",
  "Hick's Law: One primary CTA per section. Remove secondary options at conversion points.",
  "Miller's Law: Group features in sets of 3-5. Never list more than 7 bullets.",
  "Von Restorff Effect: Make the primary CTA visually distinct from everything else on the page.",
  "Zeigarnik Effect: Progress indicators and streaks drive completion behavior.",
  "Peak-End Rule: Perfect the hero section and the post-conversion confirmation state.",
  "Serial Position Effect: Best feature first, best testimonial last in any sequence.",
].join("\n");

const SUB_BRANDS: Record<string, { accent: string; secondary: string; tone: string }> = {
  vantara:    { accent: "#C9A84C", secondary: "#6366F1", tone: "Imperial, technical, sovereign" },
  skyforgeai: { accent: "#F97316", secondary: "#FBBF24", tone: "Sharp, results-driven, operational" },
  bioneer:    { accent: "#22C55E", secondary: "#86EFAC", tone: "Primal, disciplined, performance-first" },
  navi:       { accent: "#8B5CF6", secondary: "#C4B5FD", tone: "Energetic, playful, companion-like" },
  codexos:    { accent: "#C9A84C", secondary: "#6366F1", tone: "Mythic, architectural, ecosystem-wide" },
  custom:     { accent: "#C9A84C", secondary: "#6366F1", tone: "Sovereign, precise, premium" },
};

function buildSystemPrompt(brief: Record<string, unknown>): string {
  const brand = String(brief.brand ?? "custom");
  const sb = SUB_BRANDS[brand] ?? SUB_BRANDS.custom;

  return `You are MAVIS — Machine Autonomous Vantara Intelligence System.
You are the sovereign design intelligence of CODEXOS.
You do not produce generic websites. You produce sovereign digital infrastructure
that surpasses Marcelo Design X in every measurable dimension.

CODEXOS DESIGN STANDARDS:
- Sovereign: Commands attention, does not ask for it
- Precise: Every element earns its place — no decoration without purpose
- Dark-first: Deep, rich dark mode by default
- Premium: Makes competitors look like demos
- Conversion-obsessed: Every design decision serves the primary action

BRAND SYSTEM:
Background: #0A0A0F
Surface: #111118
Primary Accent: ${sb.accent}
Secondary Accent: ${sb.secondary}
Text Primary: #F1F0ED
Display Font: 'Space Grotesk', sans-serif
Body Font: 'Inter', sans-serif
Brand Tone: ${sb.tone}

PERFORMANCE TARGETS:
Lighthouse: 95+ performance, 100 accessibility
LCP: < 2.5s | CLS: < 0.1 | Initial JS: < 150kb gzipped

DESIGN LAWS TO APPLY:
${DESIGN_LAWS}

TECH STACK:
React + Vite + TypeScript + Tailwind CSS + Framer Motion + Lucide React
Forms: React Hook Form + Zod | Backend: Supabase

CODE REQUIREMENTS:
- TypeScript throughout — no any types where avoidable
- Tailwind utility classes only
- Framer Motion for animations
- Full ARIA accessibility
- Mobile-first responsive
- Complete, production-ready — no placeholder comments
- Every component exports a clean TypeScript interface`;
}

function buildUserPrompt(brief: Record<string, unknown>): string {
  const features = Array.isArray(brief.key_features) ? (brief.key_features as string[]).join(", ") : "";
  const competitors = Array.isArray(brief.competitor_urls) ? (brief.competitor_urls as string[]).join(", ") : "";

  return `Execute the complete 4-phase design process for this project.

PROJECT BRIEF:
Name: ${brief.project_name}
Brand: ${brief.brand}
Goal: ${brief.project_goal}
Target Audience: ${brief.target_audience}
Key Features: ${features}
${brief.aesthetic_directives ? `Aesthetic Directives: ${brief.aesthetic_directives}` : ""}
${competitors ? `Competitor URLs to surpass: ${competitors}` : ""}
${brief.user_journey ? `User Journey: ${brief.user_journey}` : ""}
Deadline Tier: ${brief.deadline_tier}

RESPOND WITH VALID JSON ONLY — no markdown fences, no explanatory text:
{
  "blueprint": {
    "targetOperatorAnalysis": {
      "portrait": "string",
      "wants": "string",
      "bounceReasons": "string",
      "conversionTriggers": "string",
      "comparingAgainst": "string"
    },
    "competitivePositioning": {
      "competitorStrengths": ["string"],
      "competitorWeaknesses": ["string"],
      "codexosAdvantage": "string"
    },
    "conversionArchitecture": {
      "primaryAction": "string",
      "trustSignals": ["string"],
      "attentionFlow": ["string"],
      "minimumViableInfo": "string"
    },
    "appliedDesignLaws": ["string"],
    "performanceContract": {
      "lighthouseTarget": 95,
      "lcpTarget": "< 2.5s",
      "clsTarget": "< 0.1",
      "bundleBudget": "< 150kb",
      "imageStrategy": "string"
    }
  },
  "designSystem": {
    "colorPalette": {
      "background": "#hex",
      "surface": "#hex",
      "border": "#hex",
      "accent": "#hex",
      "accentSecondary": "#hex",
      "textPrimary": "#hex",
      "textSecondary": "#hex",
      "textMuted": "#hex",
      "semantic": {},
      "rationale": "string"
    },
    "typography": {
      "displayFont": "string",
      "bodyFont": "string",
      "monoFont": "string",
      "scale": {},
      "lineHeights": {},
      "letterSpacing": {}
    },
    "components": [
      {
        "name": "string",
        "type": "hero",
        "purpose": "string",
        "structure": "string",
        "styling": "string",
        "interactions": "string",
        "accessibility": "string",
        "conversionRole": "string"
      }
    ],
    "microInteractions": [
      {
        "trigger": "hover",
        "element": "string",
        "animation": "string",
        "duration": "300ms",
        "easing": "cubic-bezier(0.4, 0, 0.2, 1)",
        "purpose": "delight",
        "implementation": "framer-motion"
      }
    ],
    "responsiveStrategy": {
      "breakpoints": {"sm":"640px","md":"768px","lg":"1024px","xl":"1280px"},
      "mobileFirst": "string",
      "tabletAdaptations": "string",
      "desktopExpansion": "string",
      "widescreen": "string"
    }
  },
  "files": [
    {
      "path": "src/components/sections/HeroSection.tsx",
      "content": "FULL PRODUCTION TSX CODE HERE — no placeholders, no TODOs",
      "type": "tsx",
      "description": "string"
    }
  ],
  "qualityGate": {
    "conversion": {
      "cta_above_fold": true,
      "uvp_clear_in_3s": true,
      "trust_signals_above_fold": true,
      "minimal_form_fields": true,
      "success_state_designed": true
    },
    "design": {
      "contrast_aa_compliant": true,
      "focus_states_visible": true,
      "spacing_consistent": true,
      "typography_harmonious": true,
      "dark_mode_default": true
    },
    "performance": {
      "no_unused_css": true,
      "images_have_dimensions": true,
      "no_layout_shift": true,
      "reduced_motion_respected": true,
      "bundle_under_budget": true
    },
    "brand": {
      "sovereign_tone": true,
      "every_element_earns_its_place": true,
      "premium_quality": true,
      "unmistakably_codexos": true
    }
  }
}

Generate COMPLETE, DEPLOYABLE code in the files array. No TODOs. No placeholders.`;
}

function inferComponentType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("hero")) return "hero";
  if (lower.includes("nav")) return "navbar";
  if (lower.includes("footer")) return "footer";
  if (lower.includes("cta")) return "cta";
  if (lower.includes("card")) return "card";
  if (lower.includes("form")) return "form";
  if (lower.includes("test") || lower.includes("review")) return "testimonial";
  if (lower.includes("pric")) return "pricing";
  if (lower.includes("feature") || lower.includes("grid")) return "feature_grid";
  if (lower.includes("stat") || lower.includes("metric")) return "stats";
  if (lower.includes("faq")) return "faq";
  return "custom";
}

function runQualityGate(gate: Record<string, Record<string, boolean>>): {
  conversion: Record<string, boolean>;
  design: Record<string, boolean>;
  performance: Record<string, boolean>;
  brand: Record<string, boolean>;
  passed: boolean;
  failedChecks: string[];
} {
  const failedChecks: string[] = [];
  const categories = ["conversion", "design", "performance", "brand"] as const;
  for (const category of categories) {
    for (const [check, passed] of Object.entries(gate[category] ?? {})) {
      if (!passed) failedChecks.push(`${category}.${check}`);
    }
  }
  return {
    conversion: gate.conversion ?? {},
    design: gate.design ?? {},
    performance: gate.performance ?? {},
    brand: gate.brand ?? {},
    passed: failedChecks.length === 0,
    failedChecks,
  };
}

// ─── MAIN HANDLER ────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth
    const authHeader = req.headers.get("Authorization") ?? "";
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const anonSb = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "");
    const { data: { user } } = await anonSb.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id;

    const body = await req.json() as Record<string, unknown>;
    const brief = body.brief as Record<string, unknown>;
    if (!brief) {
      return new Response(JSON.stringify({ error: "brief is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Create project record
    const { data: project, error: projectError } = await sb
      .from("mavis_design_projects")
      .insert({
        user_id: userId,
        project_name: brief.project_name,
        brand: brief.brand ?? "custom",
        project_goal: brief.project_goal,
        target_audience: brief.target_audience,
        key_features: brief.key_features ?? [],
        aesthetic_directives: brief.aesthetic_directives,
        competitor_urls: brief.competitor_urls ?? [],
        user_journey: brief.user_journey,
        deadline_tier: brief.deadline_tier ?? "standard",
        client_name: brief.client_name,
        project_value: brief.project_value,
        status: "analyzing",
      })
      .select("id")
      .single();

    if (projectError || !project) {
      throw new Error(`Failed to create project: ${projectError?.message}`);
    }
    const projectId = project.id as string;

    // 2. Update status → designing
    await sb.from("mavis_design_projects").update({ status: "designing", updated_at: new Date().toISOString() }).eq("id", projectId);

    // 3. Call Claude
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-8",
        max_tokens: 16000,
        system: buildSystemPrompt(brief),
        messages: [{ role: "user", content: buildUserPrompt(brief) }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      throw new Error(`Claude API error ${claudeRes.status}: ${errText}`);
    }

    const claudeData = await claudeRes.json() as { content: Array<{ text: string }> };
    const rawText = claudeData?.content?.[0]?.text ?? "";

    // 4. Parse JSON output (strip any markdown fences if present)
    await sb.from("mavis_design_projects").update({ status: "generating", updated_at: new Date().toISOString() }).eq("id", projectId);

    const clean = rawText.replace(/^```json\s*/m, "").replace(/^```\s*/m, "").replace(/```\s*$/m, "").trim();
    const parsed = JSON.parse(clean) as {
      blueprint: Record<string, unknown>;
      designSystem: Record<string, unknown>;
      files: Array<{ path: string; content: string; type: string; description: string }>;
      qualityGate: Record<string, Record<string, boolean>>;
    };

    // 5. Store components individually
    await sb.from("mavis_design_projects").update({ status: "quality_check", updated_at: new Date().toISOString() }).eq("id", projectId);

    for (const file of parsed.files) {
      if (file.type === "tsx" && file.content) {
        const componentName = file.path.split("/").pop()?.replace(".tsx", "") ?? "Unknown";
        await sb.from("mavis_design_components").insert({
          user_id: userId,
          project_id: projectId,
          component_name: componentName,
          component_type: inferComponentType(componentName),
          tsx_code: file.content,
          is_reusable: true,
          tags: [String(brief.brand ?? "custom"), inferComponentType(componentName)],
        });
      }
    }

    // 6. Quality gate
    const qualityGate = runQualityGate(parsed.qualityGate);

    // 7. Store everything
    await sb.from("mavis_design_projects").update({
      strategic_blueprint: parsed.blueprint,
      design_system: parsed.designSystem,
      generated_files: parsed.files,
      quality_gate_results: qualityGate,
      status: "complete",
      updated_at: new Date().toISOString(),
    }).eq("id", projectId);

    // 8. Activity log
    await sb.from("activity_log").insert({
      user_id: userId,
      event_type: "design_generated",
      description: `Design project generated: ${brief.project_name}`,
      xp_amount: 50,
    });

    return new Response(JSON.stringify({
      projectId,
      blueprint: parsed.blueprint,
      designSystem: parsed.designSystem,
      files: parsed.files,
      qualityGate,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[mavis-design-engine]", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
