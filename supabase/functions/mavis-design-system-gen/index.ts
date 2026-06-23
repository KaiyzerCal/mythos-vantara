// mavis-design-system-gen
// Generate a complete design system spec from a natural language product description.
// Powered by the UI/UX Pro Max skill (161 reasoning rules · 161 palettes · 73 font pairings).
// Returns structured JSON: pattern, style, colors, typography, effects, anti-patterns, checklist.
// Called from the MAVIS Design Studio page.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  REASONING_RULES, COLOR_PALETTES, TYPOGRAPHY_PAIRINGS, PRODUCT_TYPES,
  type ReasoningRule, type ColorPalette, type Typography,
} from "./data.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Keyword scorer ────────────────────────────────────────────
// Simple TF-style keyword match — fast, deterministic, no AI cost.
function scoreKeywords(query: string, keywords: string): number {
  const q = query.toLowerCase();
  const kws = keywords.toLowerCase().split(",").map((k) => k.trim()).filter(Boolean);
  let score = 0;
  for (const kw of kws) {
    if (q.includes(kw)) score += kw.length > 4 ? 3 : 1; // longer keyword = higher confidence
  }
  // Also score query tokens against keywords string
  const tokens = q.replace(/[^\w\s]/g, " ").split(/\s+/).filter((t) => t.length > 2);
  for (const token of tokens) {
    if (keywords.toLowerCase().includes(token)) score += 1;
  }
  return score;
}

// ── Find best matching product type ─────────────────────────────
function findProductType(query: string): string {
  let best = PRODUCT_TYPES[0];
  let bestScore = 0;
  for (const pt of PRODUCT_TYPES) {
    const score = scoreKeywords(query, pt.keywords + " " + pt.type);
    if (score > bestScore) { bestScore = score; best = pt; }
  }
  return best.type;
}

// ── Look up reasoning rule by category ─────────────────────────
function findRule(category: string): ReasoningRule | null {
  const cat = category.toLowerCase();
  // Exact match
  let rule = REASONING_RULES.find((r) => r.category.toLowerCase() === cat);
  if (rule) return rule;
  // Partial match
  rule = REASONING_RULES.find((r) => cat.includes(r.category.toLowerCase()) || r.category.toLowerCase().includes(cat));
  if (rule) return rule;
  // Keyword match
  const tokens = cat.replace(/[^\w\s]/g, " ").split(/\s+/).filter((t) => t.length > 3);
  for (const tok of tokens) {
    rule = REASONING_RULES.find((r) => r.category.toLowerCase().includes(tok));
    if (rule) return rule;
  }
  return REASONING_RULES[0]; // fallback: SaaS (General)
}

// ── Look up color palette by product type ──────────────────────
function findColors(category: string): ColorPalette | null {
  const cat = category.toLowerCase();
  return (
    COLOR_PALETTES.find((c) => c.product.toLowerCase() === cat) ??
    COLOR_PALETTES.find((c) => cat.includes(c.product.toLowerCase())) ??
    COLOR_PALETTES[0]
  );
}

// ── Find typography by mood keywords ──────────────────────────
function findTypography(typographyMood: string): Typography | null {
  const mood = typographyMood.toLowerCase();
  const moodTokens = mood.split(/[\s,+]+/).filter((t) => t.length > 3);

  let best: Typography | null = null;
  let bestScore = 0;
  for (const t of TYPOGRAPHY_PAIRINGS) {
    const tMood = t.mood.toLowerCase() + " " + t.best_for.toLowerCase();
    let score = 0;
    for (const tok of moodTokens) {
      if (tMood.includes(tok)) score++;
    }
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return best ?? TYPOGRAPHY_PAIRINGS[1]; // fallback: Modern Professional
}

// ── Pre-delivery checklist (always appended) ──────────────────
const CHECKLIST = [
  "No emojis as icons — use SVG (Heroicons/Lucide)",
  "cursor-pointer on all clickable elements",
  "Hover states with smooth transitions (150–300ms)",
  "Text contrast ≥ 4.5:1 (WCAG AA)",
  "Focus states visible for keyboard navigation",
  "prefers-reduced-motion respected",
  "Responsive: 375px · 768px · 1024px · 1440px",
  "Min touch target 44×44px on mobile",
  "Lazy load images below the fold",
  "No horizontal scroll on any breakpoint",
];

// ── Format design system output ───────────────────────────────
interface DesignSystemResult {
  product_type: string;
  pattern: string;
  style: string;
  color_mood: string;
  colors: ColorPalette | null;
  typography: {
    name: string;
    heading: string;
    body: string;
    mood: string;
    css_import: string;
    tailwind_config: string;
  } | null;
  effects: string;
  anti_patterns: string[];
  checklist: string[];
  severity: string;
  stack_notes: string;
}

function generateDesignSystem(query: string, stack = "shadcn"): DesignSystemResult {
  const productType = findProductType(query);
  const rule = findRule(productType);
  const colors = findColors(productType);
  const typo = rule ? findTypography(rule.typography_mood) : null;

  const stackNotes: Record<string, string> = {
    shadcn: "Use shadcn/ui components. Configure via globals.css CSS variables matching the color palette above. Extend tailwind.config.ts with the font pairing.",
    react: "React + Tailwind. Apply color tokens as Tailwind config extensions. Use framer-motion for the specified effects.",
    nextjs: "Next.js + Tailwind. Add font via next/font/google for zero layout shift. Image optimization via next/image (WebP auto).",
    "html-tailwind": "HTML + Tailwind CDN or Vite. Define CSS variables in :root matching the palette. Use Google Fonts CSS @import.",
  };

  return {
    product_type: productType,
    pattern: rule?.pattern ?? "Hero + Features + CTA",
    style: rule?.style ?? "Minimalism",
    color_mood: rule?.color_mood ?? "Professional blue",
    colors: colors ?? null,
    typography: typo ? {
      name: typo.name,
      heading: typo.heading,
      body: typo.body,
      mood: typo.mood,
      css_import: typo.css_import,
      tailwind_config: typo.tailwind,
    } : null,
    effects: rule?.effects ?? "Subtle hover transitions (200ms)",
    anti_patterns: (rule?.anti_patterns ?? "").split("+").map((s) => s.trim()).filter(Boolean),
    checklist: CHECKLIST,
    severity: rule?.severity ?? "MEDIUM",
    stack_notes: stackNotes[stack] ?? stackNotes["shadcn"],
  };
}

// ── Main handler ──────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { query, project_name, stack } = body as {
      query?: string;
      project_name?: string;
      stack?: string;
    };

    if (!query?.trim()) {
      return new Response(
        JSON.stringify({ error: "query is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Auth (optional — allow unauthenticated calls from Design Studio within the app)
    // The MAVIS frontend sends the user's JWT; we accept either JWT or service role.
    let userId: string | null = null;
    try {
      const authHeader = req.headers.get("Authorization") ?? "";
      if (authHeader.startsWith("Bearer ")) {
        const sb = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
          { auth: { persistSession: false } },
        );
        const { data: { user } } = await sb.auth.getUser(authHeader.slice(7));
        userId = user?.id ?? null;
      }
    } catch { /* non-critical */ }

    const result = generateDesignSystem(query.trim(), stack ?? "shadcn");

    // Log usage to mavis_insights (non-blocking)
    if (userId) {
      const sbAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false } },
      );
      sbAdmin.from("mavis_insights").insert({
        user_id: userId,
        title: `Design System: ${project_name ?? result.product_type}`,
        content: `Generated design system for "${query}". Pattern: ${result.pattern}. Style: ${result.style}.`,
        category: "design_system",
        severity: "info",
        source: "design_system_gen",
      }).catch(() => {});
    }

    return new Response(
      JSON.stringify({
        ok: true,
        project_name: project_name ?? null,
        query,
        ...result,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("mavis-design-system-gen error:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
