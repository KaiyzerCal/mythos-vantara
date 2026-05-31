import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_KEY  = Deno.env.get("GEMINI_API_KEY") ?? "";
const CLAUDE_KEY  = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const OPENAI_KEY  = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SiteBrief {
  client_name?: string;
  business_name?: string;
  business_type?: string;
  description?: string;
  target_audience?: string;
  unique_value?: string;
  location?: string;
  color_scheme?: string;
  style?: string;
  pages?: string[];
}

interface SiteContent {
  site?: {
    title?: string;
    tagline?: string;
    primary_color?: string;
  };
  pages?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Gemini content generation
// ---------------------------------------------------------------------------

async function generateSiteContent(brief: SiteBrief): Promise<SiteContent> {
  const safeBusinessName = (brief.business_name ?? "").toLowerCase().replace(/\s/g, "");
  const pageList = (brief.pages ?? ["home", "about", "services", "contact"]).join(", ");

  const systemPrompt = `You are an expert web copywriter and website strategist. Generate complete, high-converting website content for a ${brief.business_type ?? "business"} business.

BUSINESS BRIEF:
Business Name: ${brief.business_name ?? ""}
Type: ${brief.business_type ?? "business"}
Description: ${brief.description ?? ""}
Target Audience: ${brief.target_audience ?? "general"}
Unique Value Proposition: ${brief.unique_value ?? ""}
Location: ${brief.location ?? ""}
Style: ${brief.style ?? "modern"}

Generate content for these pages: ${pageList}

CRITICAL RULES:
- Headlines must be powerful, specific, and benefit-driven (not generic like "Welcome to our website")
- Copy must speak directly to the target audience's pain points
- Every CTA must be action-oriented and specific
- Testimonials should feel authentic and specific (with realistic names, roles, companies)
- Features should be benefit-first, not feature-first

Return a JSON object with this EXACT structure:
{
  "site": {
    "title": "Business name or tagline for browser tab",
    "tagline": "One-line value proposition (under 60 chars)",
    "primary_color": "hex color that matches the brand (e.g. #1a56db for corporate blue)"
  },
  "pages": {
    "home": {
      "hero": {
        "headline": "Bold, specific headline (under 12 words)",
        "subheadline": "Expansion of the headline (1-2 sentences)",
        "cta_primary": "Get Started Free",
        "cta_primary_url": "#contact",
        "cta_secondary": "See How It Works",
        "cta_secondary_url": "#how-it-works",
        "hero_image_prompt": "Detailed image generation prompt for the hero background (be specific about mood, colors, style)"
      },
      "social_proof_bar": {
        "text": "Trusted by 500+ businesses",
        "logos_placeholder": ["Company A", "Company B", "Company C", "Company D", "Company E"]
      },
      "features": [
        { "icon_emoji": "⚡", "title": "Feature title (3-4 words)", "description": "Benefit-driven description (2 sentences)", "detail": "Supporting proof point" },
        { "icon_emoji": "🎯", "title": "...", "description": "...", "detail": "..." },
        { "icon_emoji": "🔒", "title": "...", "description": "...", "detail": "..." },
        { "icon_emoji": "📈", "title": "...", "description": "...", "detail": "..." },
        { "icon_emoji": "💡", "title": "...", "description": "...", "detail": "..." },
        { "icon_emoji": "🤝", "title": "...", "description": "...", "detail": "..." }
      ],
      "how_it_works": {
        "title": "How It Works",
        "steps": [
          { "number": "01", "title": "Step title", "description": "What happens in this step" },
          { "number": "02", "title": "...", "description": "..." },
          { "number": "03", "title": "...", "description": "..." }
        ]
      },
      "testimonials": [
        { "quote": "Specific, results-focused testimonial", "author": "Full Name", "role": "Job Title", "company": "Company Name", "rating": 5 },
        { "quote": "...", "author": "...", "role": "...", "company": "...", "rating": 5 },
        { "quote": "...", "author": "...", "role": "...", "company": "...", "rating": 5 }
      ],
      "stats": [
        { "number": "500+", "label": "Happy Clients" },
        { "number": "98%", "label": "Satisfaction Rate" },
        { "number": "2x", "label": "Average ROI" },
        { "number": "24/7", "label": "Support" }
      ],
      "cta_section": {
        "headline": "Ready to [specific transformation]?",
        "subtext": "Join [number] [target audience] already [achieving outcome]",
        "cta_text": "Get Started Today",
        "cta_url": "#contact",
        "secondary_text": "No credit card required · Cancel anytime"
      },
      "faq": [
        { "question": "Common question", "answer": "Detailed answer" },
        { "question": "...", "answer": "..." },
        { "question": "...", "answer": "..." },
        { "question": "...", "answer": "..." }
      ]
    },
    "about": {
      "hero_headline": "Our Story / About headline",
      "story": "Multi-paragraph company story (3-4 paragraphs, engaging narrative)",
      "mission": "Our mission statement",
      "values": [
        { "emoji": "💎", "title": "Value name", "description": "What this value means in practice" },
        { "emoji": "🚀", "title": "...", "description": "..." },
        { "emoji": "❤️", "title": "...", "description": "..." }
      ],
      "team_intro": "Brief intro to the team",
      "cta": { "headline": "Work With Us", "text": "Let's build something great together", "button": "Get In Touch" }
    },
    "services": {
      "hero_headline": "Services headline",
      "intro": "Services page introduction",
      "services": [
        {
          "icon_emoji": "🎯",
          "title": "Service name",
          "description": "Detailed service description (3-4 sentences)",
          "features": ["Feature 1", "Feature 2", "Feature 3", "Feature 4"],
          "price_from": "Starting at $X"
        }
      ],
      "process_title": "Our Process",
      "process_steps": [
        { "step": "1", "title": "Discovery", "description": "What happens" },
        { "step": "2", "title": "Strategy", "description": "..." },
        { "step": "3", "title": "Execution", "description": "..." },
        { "step": "4", "title": "Results", "description": "..." }
      ],
      "cta": { "headline": "Ready to Get Started?", "button": "Book a Free Consultation" }
    },
    "contact": {
      "hero_headline": "Get In Touch",
      "intro": "Contact page intro (inviting, removes friction)",
      "email": "hello@${safeBusinessName}.com",
      "phone": "",
      "address": "${brief.location ?? ""}",
      "hours": "Mon–Fri, 9am–6pm",
      "response_promise": "We respond within 24 hours",
      "form_headline": "Send Us a Message"
    }
  }
}`;

  // ── Tier 1: Gemini (try all models, skip on 403/404/429) ──
  if (GEMINI_KEY) {
    const GEMINI_MODELS = [
      "gemini-2.5-flash-preview-05-20",
      "gemini-2.0-flash",
      "gemini-1.5-flash",
    ];
    const gemBody = JSON.stringify({
      contents: [{ role: "user", parts: [{ text: systemPrompt }] }],
      generationConfig: { temperature: 0.8, responseMimeType: "application/json", maxOutputTokens: 8192 },
    });
    for (const model of GEMINI_MODELS) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: gemBody },
      );
      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
        return JSON.parse(text);
      }
      // 429 = rate limit (quota shared across models — skip all Gemini)
      if (res.status === 429) break;
      // 403/404 = model access issue — try next model
    }
  }

  // ── Tier 2: Claude Haiku ──────────────────────────────────
  if (CLAUDE_KEY) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": CLAUDE_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 8192,
        system: "You are an expert web copywriter. Always respond with valid JSON only — no markdown, no explanation.",
        messages: [{ role: "user", content: systemPrompt }],
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const text = data.content?.[0]?.text ?? "{}";
      const match = text.match(/\{[\s\S]*\}/);
      return JSON.parse(match ? match[0] : text);
    }
  }

  // ── Tier 3: OpenAI gpt-4o-mini ───────────────────────────
  if (OPENAI_KEY) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 8192,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are an expert web copywriter. Respond with valid JSON only." },
          { role: "user", content: systemPrompt },
        ],
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content ?? "{}";
      return JSON.parse(text);
    }
  }

  throw new Error("All AI providers failed or have no funded keys — cannot generate site content.");
}

// ---------------------------------------------------------------------------
// Gutenberg block builders
// ---------------------------------------------------------------------------

function buildGutenbergPage(
  pageType: string,
  content: any,
  heroImageUrl?: string,
  primaryColor = "#1a56db",
): string {
  switch (pageType) {
    case "home":
      return buildHomePage(content, heroImageUrl, primaryColor);
    case "about":
      return buildAboutPage(content, heroImageUrl, primaryColor);
    case "services":
      return buildServicesPage(content, heroImageUrl, primaryColor);
    case "contact":
      return buildContactPage(content, primaryColor);
    case "pricing":
      return buildPricingPage(content, primaryColor);
    case "portfolio":
      return buildPortfolioPage(content, heroImageUrl, primaryColor);
    default:
      return buildGenericPage(content, heroImageUrl, primaryColor);
  }
}

// ---------------------------------------------------------------------------
// Home page
// ---------------------------------------------------------------------------

function buildHomePage(content: any, heroImageUrl?: string, primaryColor = "#1a56db"): string {
  const hero = content.hero ?? {};
  const features = content.features ?? [];
  const howItWorks = content.how_it_works ?? {};
  const testimonials = content.testimonials ?? [];
  const stats = content.stats ?? [];
  const ctaSection = content.cta_section ?? {};
  const faq = content.faq ?? [];
  const socialProof = content.social_proof_bar ?? {};

  const stars = (n: number) => "⭐".repeat(Math.min(n, 5));

  const heroCoverAttrs = heroImageUrl
    ? `{"url":"${heroImageUrl}","dimRatio":60,"isDark":true,"minHeight":700,"minHeightUnit":"px","style":{"spacing":{"padding":{"top":"120px","bottom":"120px"}}}}`
    : `{"backgroundColor":"primary","isDark":true,"minHeight":700,"minHeightUnit":"px","style":{"spacing":{"padding":{"top":"120px","bottom":"120px"}}}}`;

  const heroBgStyle = heroImageUrl
    ? `background-image:url(${heroImageUrl});min-height:700px;padding-top:120px;padding-bottom:120px`
    : `background-color:${primaryColor};min-height:700px;padding-top:120px;padding-bottom:120px`;

  return `
<!-- wp:cover ${heroCoverAttrs} -->
<div class="wp-block-cover is-dark" style="${heroBgStyle}">
<div class="wp-block-cover__inner-container">
<!-- wp:group {"layout":{"type":"constrained","contentSize":"860px"},"style":{"spacing":{"padding":{"left":"20px","right":"20px"}}}} -->
<div class="wp-block-group" style="padding-left:20px;padding-right:20px">
<!-- wp:heading {"level":1,"textColor":"white","textAlign":"center","style":{"typography":{"fontSize":"clamp(2.5rem,5vw,4rem)","fontWeight":"800","lineHeight":"1.1"},"spacing":{"margin":{"bottom":"24px"}}}} -->
<h1 class="wp-block-heading has-white-color has-text-color has-text-align-center" style="font-size:clamp(2.5rem,5vw,4rem);font-weight:800;line-height:1.1;margin-bottom:24px">${hero.headline ?? "Transform Your Business"}</h1>
<!-- /wp:heading -->
<!-- wp:paragraph {"textColor":"white","textAlign":"center","style":{"typography":{"fontSize":"1.25rem"},"spacing":{"margin":{"bottom":"40px"}}}} -->
<p class="has-white-color has-text-color has-text-align-center" style="font-size:1.25rem;margin-bottom:40px">${hero.subheadline ?? ""}</p>
<!-- /wp:paragraph -->
<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"},"style":{"spacing":{"blockGap":"16px"}}} -->
<div class="wp-block-buttons">
<!-- wp:button {"backgroundColor":"white","textColor":"primary","style":{"border":{"radius":"8px"},"typography":{"fontWeight":"700"},"spacing":{"padding":{"top":"16px","bottom":"16px","left":"32px","right":"32px"}}}} -->
<div class="wp-block-button"><a class="wp-block-button__link has-primary-color has-white-background-color has-text-color has-background" href="${hero.cta_primary_url ?? "#contact"}" style="border-radius:8px;font-weight:700;padding:16px 32px">${hero.cta_primary ?? "Get Started Free"}</a></div>
<!-- /wp:button -->
${hero.cta_secondary ? `<!-- wp:button {"style":{"border":{"radius":"8px","width":"2px","color":"white"},"spacing":{"padding":{"top":"14px","bottom":"14px","left":"30px","right":"30px"}}}} -->
<div class="wp-block-button is-style-outline"><a class="wp-block-button__link" href="${hero.cta_secondary_url ?? "#"}" style="border-radius:8px;border:2px solid white;padding:14px 30px;color:white">${hero.cta_secondary}</a></div>
<!-- /wp:button -->` : ""}
</div>
<!-- /wp:buttons -->
${socialProof.text ? `<!-- wp:paragraph {"textAlign":"center","textColor":"white","style":{"typography":{"fontSize":"0.875rem"},"spacing":{"margin":{"top":"24px"}}}} -->
<p class="has-white-color has-text-color has-text-align-center" style="font-size:0.875rem;margin-top:24px;opacity:0.8">✓ ${socialProof.text}</p>
<!-- /wp:paragraph -->` : ""}
</div>
<!-- /wp:group -->
</div>
</div>
<!-- /wp:cover -->

${stats.length > 0 ? `
<!-- wp:group {"style":{"color":{"background":"${primaryColor}"},"spacing":{"padding":{"top":"48px","bottom":"48px"}}},"layout":{"type":"constrained","contentSize":"1100px"}} -->
<div class="wp-block-group" style="background-color:${primaryColor};padding-top:48px;padding-bottom:48px">
<!-- wp:columns {"style":{"spacing":{"blockGap":"0px"}}} -->
<div class="wp-block-columns">
${stats.map((s: any) => `<!-- wp:column {"style":{"spacing":{"padding":{"left":"20px","right":"20px"}}}} -->
<div class="wp-block-column" style="padding-left:20px;padding-right:20px">
<!-- wp:heading {"level":2,"textColor":"white","textAlign":"center","style":{"typography":{"fontSize":"2.5rem","fontWeight":"800"}}} -->
<h2 class="wp-block-heading has-white-color has-text-color has-text-align-center" style="font-size:2.5rem;font-weight:800">${s.number}</h2>
<!-- /wp:heading -->
<!-- wp:paragraph {"textColor":"white","textAlign":"center","style":{"typography":{"fontSize":"0.875rem"}}} -->
<p class="has-white-color has-text-color has-text-align-center" style="font-size:0.875rem;opacity:0.85">${s.label}</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:column -->`).join("\n")}
</div>
<!-- /wp:columns -->
</div>
<!-- /wp:group -->` : ""}

<!-- wp:group {"style":{"spacing":{"padding":{"top":"80px","bottom":"80px"}}},"layout":{"type":"constrained","contentSize":"1100px"}} -->
<div class="wp-block-group" style="padding-top:80px;padding-bottom:80px">
<!-- wp:heading {"level":2,"textAlign":"center","style":{"typography":{"fontSize":"2.25rem","fontWeight":"700"},"spacing":{"margin":{"bottom":"16px"}}}} -->
<h2 class="wp-block-heading has-text-align-center" style="font-size:2.25rem;font-weight:700;margin-bottom:16px">Everything You Need to Succeed</h2>
<!-- /wp:heading -->
<!-- wp:paragraph {"textAlign":"center","textColor":"secondary","style":{"spacing":{"margin":{"bottom":"56px"}}}} -->
<p class="has-secondary-color has-text-color has-text-align-center" style="margin-bottom:56px">All the tools and support to grow your business, in one place.</p>
<!-- /wp:paragraph -->
<!-- wp:columns {"isStackedOnMobile":true,"style":{"spacing":{"blockGap":"24px"}}} -->
<div class="wp-block-columns is-layout-flex">
${features.slice(0, 3).map((f: any) => `<!-- wp:column -->
<div class="wp-block-column">
<!-- wp:group {"style":{"border":{"radius":"12px","width":"1px","color":"#e5e7eb"},"spacing":{"padding":{"all":"32px"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group" style="border-radius:12px;border:1px solid #e5e7eb;padding:32px">
<!-- wp:paragraph {"style":{"typography":{"fontSize":"2rem"},"spacing":{"margin":{"bottom":"16px"}}}} -->
<p style="font-size:2rem;margin-bottom:16px">${f.icon_emoji}</p>
<!-- /wp:paragraph -->
<!-- wp:heading {"level":3,"style":{"typography":{"fontSize":"1.25rem","fontWeight":"600"},"spacing":{"margin":{"bottom":"12px"}}}} -->
<h3 class="wp-block-heading" style="font-size:1.25rem;font-weight:600;margin-bottom:12px">${f.title}</h3>
<!-- /wp:heading -->
<!-- wp:paragraph {"textColor":"secondary"} -->
<p class="has-secondary-color has-text-color">${f.description}</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:group -->
</div>
<!-- /wp:column -->`).join("\n")}
</div>
<!-- /wp:columns -->
${features.length > 3 ? `<!-- wp:columns {"isStackedOnMobile":true,"style":{"spacing":{"blockGap":"24px","margin":{"top":"24px"}}}} -->
<div class="wp-block-columns is-layout-flex">
${features.slice(3, 6).map((f: any) => `<!-- wp:column -->
<div class="wp-block-column">
<!-- wp:group {"style":{"border":{"radius":"12px","width":"1px","color":"#e5e7eb"},"spacing":{"padding":{"all":"32px"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group" style="border-radius:12px;border:1px solid #e5e7eb;padding:32px">
<!-- wp:paragraph {"style":{"typography":{"fontSize":"2rem"},"spacing":{"margin":{"bottom":"16px"}}}} -->
<p style="font-size:2rem;margin-bottom:16px">${f.icon_emoji}</p>
<!-- /wp:paragraph -->
<!-- wp:heading {"level":3,"style":{"typography":{"fontSize":"1.25rem","fontWeight":"600"},"spacing":{"margin":{"bottom":"12px"}}}} -->
<h3 class="wp-block-heading" style="font-size:1.25rem;font-weight:600;margin-bottom:12px">${f.title}</h3>
<!-- /wp:heading -->
<!-- wp:paragraph {"textColor":"secondary"} -->
<p class="has-secondary-color has-text-color">${f.description}</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:group -->
</div>
<!-- /wp:column -->`).join("\n")}
</div>
<!-- /wp:columns -->` : ""}
</div>
<!-- /wp:group -->

${howItWorks.steps?.length ? `
<!-- wp:group {"style":{"color":{"background":"#f9fafb"},"spacing":{"padding":{"top":"80px","bottom":"80px"}}},"layout":{"type":"constrained","contentSize":"900px"}} -->
<div class="wp-block-group" style="background-color:#f9fafb;padding-top:80px;padding-bottom:80px">
<!-- wp:heading {"level":2,"textAlign":"center","style":{"typography":{"fontSize":"2.25rem","fontWeight":"700"},"spacing":{"margin":{"bottom":"56px"}}}} -->
<h2 class="wp-block-heading has-text-align-center" style="font-size:2.25rem;font-weight:700;margin-bottom:56px">${howItWorks.title ?? "How It Works"}</h2>
<!-- /wp:heading -->
${howItWorks.steps.map((step: any, i: number) => `
<!-- wp:group {"style":{"spacing":{"margin":{"bottom":"48px"}}},"layout":{"type":"flex","flexWrap":"nowrap","verticalAlignment":"top"}} -->
<div class="wp-block-group" style="margin-bottom:48px;display:flex;align-items:flex-start;gap:24px">
<!-- wp:group {"style":{"border":{"radius":"50%"},"color":{"background":"${primaryColor}"},"spacing":{"padding":{"all":"0px"}}}} -->
<div class="wp-block-group" style="width:56px;height:56px;min-height:56px;border-radius:50%;background-color:${primaryColor};display:flex;align-items:center;justify-content:center;flex-shrink:0">
<!-- wp:heading {"level":3,"textColor":"white","textAlign":"center","style":{"typography":{"fontSize":"1.25rem","fontWeight":"800"}}} -->
<h3 class="wp-block-heading has-white-color has-text-color has-text-align-center" style="font-size:1.25rem;font-weight:800">${step.number ?? String(i + 1).padStart(2, "0")}</h3>
<!-- /wp:heading -->
</div>
<!-- /wp:group -->
<!-- wp:group {"layout":{"type":"constrained"}} -->
<div class="wp-block-group" style="flex:1">
<!-- wp:heading {"level":3,"style":{"typography":{"fontSize":"1.25rem","fontWeight":"600"},"spacing":{"margin":{"bottom":"8px"}}}} -->
<h3 class="wp-block-heading" style="font-size:1.25rem;font-weight:600;margin-bottom:8px">${step.title}</h3>
<!-- /wp:heading -->
<!-- wp:paragraph {"textColor":"secondary"} -->
<p class="has-secondary-color has-text-color">${step.description}</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:group -->
</div>
<!-- /wp:group -->`).join("\n")}
</div>
<!-- /wp:group -->` : ""}

${testimonials.length > 0 ? `
<!-- wp:group {"style":{"spacing":{"padding":{"top":"80px","bottom":"80px"}}},"layout":{"type":"constrained","contentSize":"1100px"}} -->
<div class="wp-block-group" style="padding-top:80px;padding-bottom:80px">
<!-- wp:heading {"level":2,"textAlign":"center","style":{"typography":{"fontSize":"2.25rem","fontWeight":"700"},"spacing":{"margin":{"bottom":"16px"}}}} -->
<h2 class="wp-block-heading has-text-align-center" style="font-size:2.25rem;font-weight:700;margin-bottom:16px">What Our Clients Say</h2>
<!-- /wp:heading -->
<!-- wp:paragraph {"textAlign":"center","textColor":"secondary","style":{"spacing":{"margin":{"bottom":"56px"}}}} -->
<p class="has-secondary-color has-text-color has-text-align-center" style="margin-bottom:56px">Real results from real clients</p>
<!-- /wp:paragraph -->
<!-- wp:columns {"isStackedOnMobile":true,"style":{"spacing":{"blockGap":"24px"}}} -->
<div class="wp-block-columns is-layout-flex">
${testimonials.slice(0, 3).map((t: any) => `<!-- wp:column -->
<div class="wp-block-column">
<!-- wp:group {"style":{"border":{"radius":"12px","width":"1px","color":"#e5e7eb"},"spacing":{"padding":{"all":"32px"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group" style="border-radius:12px;border:1px solid #e5e7eb;padding:32px;height:100%">
<!-- wp:paragraph {"style":{"typography":{"fontSize":"1.25rem"},"spacing":{"margin":{"bottom":"16px"}}}} -->
<p style="font-size:1.25rem;margin-bottom:16px">${stars(t.rating ?? 5)}</p>
<!-- /wp:paragraph -->
<!-- wp:paragraph {"style":{"typography":{"fontStyle":"italic","fontSize":"1rem"},"spacing":{"margin":{"bottom":"24px"}}}} -->
<p style="font-style:italic;font-size:1rem;margin-bottom:24px">"${t.quote}"</p>
<!-- /wp:paragraph -->
<!-- wp:separator {"backgroundColor":"light-gray","style":{"spacing":{"margin":{"bottom":"24px"}}}} -->
<hr class="wp-block-separator has-light-gray-background-color has-background" style="margin-bottom:24px"/>
<!-- /wp:separator -->
<!-- wp:paragraph {"style":{"typography":{"fontWeight":"600","fontSize":"0.875rem"}}} -->
<p style="font-weight:600;font-size:0.875rem">${t.author} · <span style="font-weight:400;color:#6b7280">${t.role}${t.company ? `, ${t.company}` : ""}</span></p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:group -->
</div>
<!-- /wp:column -->`).join("\n")}
</div>
<!-- /wp:columns -->
</div>
<!-- /wp:group -->` : ""}

${faq.length > 0 ? `
<!-- wp:group {"style":{"color":{"background":"#f9fafb"},"spacing":{"padding":{"top":"80px","bottom":"80px"}}},"layout":{"type":"constrained","contentSize":"800px"}} -->
<div class="wp-block-group" style="background-color:#f9fafb;padding-top:80px;padding-bottom:80px">
<!-- wp:heading {"level":2,"textAlign":"center","style":{"typography":{"fontSize":"2.25rem","fontWeight":"700"},"spacing":{"margin":{"bottom":"48px"}}}} -->
<h2 class="wp-block-heading has-text-align-center" style="font-size:2.25rem;font-weight:700;margin-bottom:48px">Frequently Asked Questions</h2>
<!-- /wp:heading -->
${faq.map((q: any) => `
<!-- wp:details -->
<details class="wp-block-details" style="border-bottom:1px solid #e5e7eb;padding:20px 0">
<summary style="font-weight:600;cursor:pointer;font-size:1rem">${q.question}</summary>
<!-- wp:paragraph -->
<p>${q.answer}</p>
<!-- /wp:paragraph -->
</details>
<!-- /wp:details -->`).join("\n")}
</div>
<!-- /wp:group -->` : ""}

<!-- wp:group {"style":{"color":{"background":"${primaryColor}"},"spacing":{"padding":{"top":"96px","bottom":"96px"}}},"layout":{"type":"constrained","contentSize":"700px"}} -->
<div class="wp-block-group" style="background-color:${primaryColor};padding-top:96px;padding-bottom:96px">
<!-- wp:heading {"level":2,"textColor":"white","textAlign":"center","style":{"typography":{"fontSize":"2.5rem","fontWeight":"800"},"spacing":{"margin":{"bottom":"16px"}}}} -->
<h2 class="wp-block-heading has-white-color has-text-color has-text-align-center" style="font-size:2.5rem;font-weight:800;margin-bottom:16px">${ctaSection.headline ?? "Ready to Get Started?"}</h2>
<!-- /wp:heading -->
<!-- wp:paragraph {"textColor":"white","textAlign":"center","style":{"typography":{"fontSize":"1.125rem"},"spacing":{"margin":{"bottom":"40px"}}}} -->
<p class="has-white-color has-text-color has-text-align-center" style="font-size:1.125rem;opacity:0.9;margin-bottom:40px">${ctaSection.subtext ?? ""}</p>
<!-- /wp:paragraph -->
<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"},"style":{"spacing":{"blockGap":"16px"}}} -->
<div class="wp-block-buttons">
<!-- wp:button {"backgroundColor":"white","textColor":"primary","style":{"border":{"radius":"8px"},"typography":{"fontWeight":"700"},"spacing":{"padding":{"top":"16px","bottom":"16px","left":"40px","right":"40px"}}}} -->
<div class="wp-block-button"><a class="wp-block-button__link has-primary-color has-white-background-color has-text-color has-background" href="${ctaSection.cta_url ?? "#contact"}" style="border-radius:8px;font-weight:700;padding:16px 40px">${ctaSection.cta_text ?? "Get Started Today"}</a></div>
<!-- /wp:button -->
</div>
<!-- /wp:buttons -->
${ctaSection.secondary_text ? `<!-- wp:paragraph {"textColor":"white","textAlign":"center","style":{"typography":{"fontSize":"0.875rem"},"spacing":{"margin":{"top":"16px"}}}} -->
<p class="has-white-color has-text-color has-text-align-center" style="font-size:0.875rem;opacity:0.7;margin-top:16px">${ctaSection.secondary_text}</p>
<!-- /wp:paragraph -->` : ""}
</div>
<!-- /wp:group -->
`;
}

// ---------------------------------------------------------------------------
// About page
// ---------------------------------------------------------------------------

function buildAboutPage(content: any, _heroImageUrl?: string, primaryColor = "#1a56db"): string {
  const heroHeadline = content.hero_headline ?? "Our Story";
  const story: string = content.story ?? "";
  const mission: string = content.mission ?? "";
  const values: any[] = content.values ?? [];
  const teamIntro: string = content.team_intro ?? "";
  const cta = content.cta ?? {};

  // Split story into paragraphs
  const storyParagraphs = story
    .split(/\n\n+/)
    .map((p: string) => p.trim())
    .filter(Boolean);

  return `
<!-- wp:cover {"isDark":true,"minHeight":420,"minHeightUnit":"px","style":{"color":{"background":"${primaryColor}"},"spacing":{"padding":{"top":"96px","bottom":"96px"}}}} -->
<div class="wp-block-cover is-dark" style="background-color:${primaryColor};min-height:420px;padding-top:96px;padding-bottom:96px">
<div class="wp-block-cover__inner-container">
<!-- wp:group {"layout":{"type":"constrained","contentSize":"760px"}} -->
<div class="wp-block-group">
<!-- wp:heading {"level":1,"textColor":"white","textAlign":"center","style":{"typography":{"fontSize":"clamp(2.25rem,4vw,3.5rem)","fontWeight":"800","lineHeight":"1.15"}}} -->
<h1 class="wp-block-heading has-white-color has-text-color has-text-align-center" style="font-size:clamp(2.25rem,4vw,3.5rem);font-weight:800;line-height:1.15">${heroHeadline}</h1>
<!-- /wp:heading -->
${mission ? `<!-- wp:paragraph {"textColor":"white","textAlign":"center","style":{"typography":{"fontSize":"1.2rem"},"spacing":{"margin":{"top":"24px"}}}} -->
<p class="has-white-color has-text-color has-text-align-center" style="font-size:1.2rem;margin-top:24px;opacity:0.9">${mission}</p>
<!-- /wp:paragraph -->` : ""}
</div>
<!-- /wp:group -->
</div>
</div>
<!-- /wp:cover -->

<!-- wp:group {"style":{"spacing":{"padding":{"top":"80px","bottom":"80px"}}},"layout":{"type":"constrained","contentSize":"820px"}} -->
<div class="wp-block-group" style="padding-top:80px;padding-bottom:80px">
<!-- wp:heading {"level":2,"textAlign":"center","style":{"typography":{"fontSize":"2rem","fontWeight":"700"},"spacing":{"margin":{"bottom":"40px"}}}} -->
<h2 class="wp-block-heading has-text-align-center" style="font-size:2rem;font-weight:700;margin-bottom:40px">Who We Are</h2>
<!-- /wp:heading -->
${storyParagraphs.map((para: string) => `<!-- wp:paragraph {"style":{"typography":{"fontSize":"1.0625rem","lineHeight":"1.8"},"spacing":{"margin":{"bottom":"24px"}}}} -->
<p style="font-size:1.0625rem;line-height:1.8;margin-bottom:24px">${para}</p>
<!-- /wp:paragraph -->`).join("\n")}
</div>
<!-- /wp:group -->

${values.length > 0 ? `
<!-- wp:group {"style":{"color":{"background":"#f9fafb"},"spacing":{"padding":{"top":"80px","bottom":"80px"}}},"layout":{"type":"constrained","contentSize":"1100px"}} -->
<div class="wp-block-group" style="background-color:#f9fafb;padding-top:80px;padding-bottom:80px">
<!-- wp:heading {"level":2,"textAlign":"center","style":{"typography":{"fontSize":"2.25rem","fontWeight":"700"},"spacing":{"margin":{"bottom":"56px"}}}} -->
<h2 class="wp-block-heading has-text-align-center" style="font-size:2.25rem;font-weight:700;margin-bottom:56px">Our Values</h2>
<!-- /wp:heading -->
<!-- wp:columns {"isStackedOnMobile":true,"style":{"spacing":{"blockGap":"24px"}}} -->
<div class="wp-block-columns is-layout-flex">
${values.map((v: any) => `<!-- wp:column -->
<div class="wp-block-column">
<!-- wp:group {"style":{"border":{"radius":"16px"},"color":{"background":"#ffffff"},"spacing":{"padding":{"all":"36px"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group" style="border-radius:16px;background-color:#ffffff;padding:36px;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
<!-- wp:paragraph {"style":{"typography":{"fontSize":"2.5rem"},"spacing":{"margin":{"bottom":"16px"}}}} -->
<p style="font-size:2.5rem;margin-bottom:16px">${v.emoji}</p>
<!-- /wp:paragraph -->
<!-- wp:heading {"level":3,"style":{"typography":{"fontSize":"1.25rem","fontWeight":"700"},"spacing":{"margin":{"bottom":"12px"}}}} -->
<h3 class="wp-block-heading" style="font-size:1.25rem;font-weight:700;margin-bottom:12px">${v.title}</h3>
<!-- /wp:heading -->
<!-- wp:paragraph {"textColor":"secondary"} -->
<p class="has-secondary-color has-text-color">${v.description}</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:group -->
</div>
<!-- /wp:column -->`).join("\n")}
</div>
<!-- /wp:columns -->
</div>
<!-- /wp:group -->` : ""}

${teamIntro ? `
<!-- wp:group {"style":{"spacing":{"padding":{"top":"80px","bottom":"80px"}}},"layout":{"type":"constrained","contentSize":"820px"}} -->
<div class="wp-block-group" style="padding-top:80px;padding-bottom:80px">
<!-- wp:heading {"level":2,"textAlign":"center","style":{"typography":{"fontSize":"2.25rem","fontWeight":"700"},"spacing":{"margin":{"bottom":"24px"}}}} -->
<h2 class="wp-block-heading has-text-align-center" style="font-size:2.25rem;font-weight:700;margin-bottom:24px">Meet the Team</h2>
<!-- /wp:heading -->
<!-- wp:paragraph {"textAlign":"center","textColor":"secondary","style":{"typography":{"fontSize":"1.0625rem","lineHeight":"1.8"}}} -->
<p class="has-secondary-color has-text-color has-text-align-center" style="font-size:1.0625rem;line-height:1.8">${teamIntro}</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:group -->` : ""}

<!-- wp:group {"style":{"color":{"background":"${primaryColor}"},"spacing":{"padding":{"top":"80px","bottom":"80px"}}},"layout":{"type":"constrained","contentSize":"700px"}} -->
<div class="wp-block-group" style="background-color:${primaryColor};padding-top:80px;padding-bottom:80px">
<!-- wp:heading {"level":2,"textColor":"white","textAlign":"center","style":{"typography":{"fontSize":"2.25rem","fontWeight":"800"},"spacing":{"margin":{"bottom":"16px"}}}} -->
<h2 class="wp-block-heading has-white-color has-text-color has-text-align-center" style="font-size:2.25rem;font-weight:800;margin-bottom:16px">${cta.headline ?? "Work With Us"}</h2>
<!-- /wp:heading -->
<!-- wp:paragraph {"textColor":"white","textAlign":"center","style":{"typography":{"fontSize":"1.125rem"},"spacing":{"margin":{"bottom":"32px"}}}} -->
<p class="has-white-color has-text-color has-text-align-center" style="font-size:1.125rem;opacity:0.9;margin-bottom:32px">${cta.text ?? "Let's build something great together"}</p>
<!-- /wp:paragraph -->
<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} -->
<div class="wp-block-buttons">
<!-- wp:button {"backgroundColor":"white","style":{"border":{"radius":"8px"},"typography":{"fontWeight":"700"},"spacing":{"padding":{"top":"16px","bottom":"16px","left":"36px","right":"36px"}}}} -->
<div class="wp-block-button"><a class="wp-block-button__link has-white-background-color has-background" href="/contact" style="border-radius:8px;font-weight:700;padding:16px 36px;color:${primaryColor}">${cta.button ?? "Get In Touch"}</a></div>
<!-- /wp:button -->
</div>
<!-- /wp:buttons -->
</div>
<!-- /wp:group -->
`;
}

// ---------------------------------------------------------------------------
// Services page
// ---------------------------------------------------------------------------

function buildServicesPage(content: any, _heroImageUrl?: string, primaryColor = "#1a56db"): string {
  const heroHeadline: string = content.hero_headline ?? "Our Services";
  const intro: string = content.intro ?? "";
  const services: any[] = content.services ?? [];
  const processTitle: string = content.process_title ?? "Our Process";
  const processSteps: any[] = content.process_steps ?? [];
  const cta = content.cta ?? {};

  return `
<!-- wp:cover {"isDark":true,"minHeight":380,"minHeightUnit":"px","style":{"color":{"background":"${primaryColor}"},"spacing":{"padding":{"top":"96px","bottom":"96px"}}}} -->
<div class="wp-block-cover is-dark" style="background-color:${primaryColor};min-height:380px;padding-top:96px;padding-bottom:96px">
<div class="wp-block-cover__inner-container">
<!-- wp:group {"layout":{"type":"constrained","contentSize":"760px"}} -->
<div class="wp-block-group">
<!-- wp:heading {"level":1,"textColor":"white","textAlign":"center","style":{"typography":{"fontSize":"clamp(2.25rem,4vw,3.5rem)","fontWeight":"800","lineHeight":"1.15"}}} -->
<h1 class="wp-block-heading has-white-color has-text-color has-text-align-center" style="font-size:clamp(2.25rem,4vw,3.5rem);font-weight:800;line-height:1.15">${heroHeadline}</h1>
<!-- /wp:heading -->
${intro ? `<!-- wp:paragraph {"textColor":"white","textAlign":"center","style":{"typography":{"fontSize":"1.2rem"},"spacing":{"margin":{"top":"24px"}}}} -->
<p class="has-white-color has-text-color has-text-align-center" style="font-size:1.2rem;margin-top:24px;opacity:0.9">${intro}</p>
<!-- /wp:paragraph -->` : ""}
</div>
<!-- /wp:group -->
</div>
</div>
<!-- /wp:cover -->

<!-- wp:group {"style":{"spacing":{"padding":{"top":"80px","bottom":"80px"}}},"layout":{"type":"constrained","contentSize":"1100px"}} -->
<div class="wp-block-group" style="padding-top:80px;padding-bottom:80px">
<!-- wp:heading {"level":2,"textAlign":"center","style":{"typography":{"fontSize":"2.25rem","fontWeight":"700"},"spacing":{"margin":{"bottom":"56px"}}}} -->
<h2 class="wp-block-heading has-text-align-center" style="font-size:2.25rem;font-weight:700;margin-bottom:56px">What We Offer</h2>
<!-- /wp:heading -->
${services.map((svc: any) => `
<!-- wp:group {"style":{"border":{"radius":"16px","width":"1px","color":"#e5e7eb"},"spacing":{"padding":{"all":"48px"},"margin":{"bottom":"32px"}}},"layout":{"type":"flex","flexWrap":"nowrap","verticalAlignment":"top"}} -->
<div class="wp-block-group" style="border-radius:16px;border:1px solid #e5e7eb;padding:48px;margin-bottom:32px;display:flex;align-items:flex-start;gap:32px;flex-wrap:wrap">
<!-- wp:group {"style":{"spacing":{"padding":{"all":"0px"}}},"layout":{"type":"constrained","contentSize":"56px"}} -->
<div class="wp-block-group" style="flex-shrink:0">
<!-- wp:paragraph {"style":{"typography":{"fontSize":"3rem"}}} -->
<p style="font-size:3rem">${svc.icon_emoji ?? "🎯"}</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:group -->
<!-- wp:group {"layout":{"type":"constrained"},"style":{"spacing":{"padding":{"all":"0px"}}}} -->
<div class="wp-block-group" style="flex:1;min-width:260px">
<!-- wp:heading {"level":3,"style":{"typography":{"fontSize":"1.5rem","fontWeight":"700"},"spacing":{"margin":{"bottom":"8px"}}}} -->
<h3 class="wp-block-heading" style="font-size:1.5rem;font-weight:700;margin-bottom:8px">${svc.title}</h3>
<!-- /wp:heading -->
${svc.price_from ? `<!-- wp:paragraph {"style":{"typography":{"fontSize":"0.875rem","fontWeight":"600"},"color":{"text":"${primaryColor}"},"spacing":{"margin":{"bottom":"16px"}}}} -->
<p style="font-size:0.875rem;font-weight:600;color:${primaryColor};margin-bottom:16px">${svc.price_from}</p>
<!-- /wp:paragraph -->` : ""}
<!-- wp:paragraph {"textColor":"secondary","style":{"typography":{"lineHeight":"1.75"},"spacing":{"margin":{"bottom":"24px"}}}} -->
<p class="has-secondary-color has-text-color" style="line-height:1.75;margin-bottom:24px">${svc.description}</p>
<!-- /wp:paragraph -->
${svc.features?.length ? `<!-- wp:list {"style":{"spacing":{"margin":{"bottom":"0px"}}}} -->
<ul class="wp-block-list" style="margin-bottom:0">
${(svc.features as string[]).map((feat: string) => `<!-- wp:list-item -->
<li>${feat}</li>
<!-- /wp:list-item -->`).join("\n")}
</ul>
<!-- /wp:list -->` : ""}
</div>
<!-- /wp:group -->
</div>
<!-- /wp:group -->`).join("\n")}
</div>
<!-- /wp:group -->

${processSteps.length > 0 ? `
<!-- wp:group {"style":{"color":{"background":"#f9fafb"},"spacing":{"padding":{"top":"80px","bottom":"80px"}}},"layout":{"type":"constrained","contentSize":"900px"}} -->
<div class="wp-block-group" style="background-color:#f9fafb;padding-top:80px;padding-bottom:80px">
<!-- wp:heading {"level":2,"textAlign":"center","style":{"typography":{"fontSize":"2.25rem","fontWeight":"700"},"spacing":{"margin":{"bottom":"56px"}}}} -->
<h2 class="wp-block-heading has-text-align-center" style="font-size:2.25rem;font-weight:700;margin-bottom:56px">${processTitle}</h2>
<!-- /wp:heading -->
<!-- wp:columns {"isStackedOnMobile":true,"style":{"spacing":{"blockGap":"24px"}}} -->
<div class="wp-block-columns is-layout-flex">
${processSteps.map((ps: any) => `<!-- wp:column -->
<div class="wp-block-column">
<!-- wp:group {"style":{"border":{"radius":"12px"},"color":{"background":"#ffffff"},"spacing":{"padding":{"all":"32px"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group" style="border-radius:12px;background-color:#ffffff;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.07)">
<!-- wp:paragraph {"style":{"typography":{"fontSize":"2rem","fontWeight":"800","color":"${primaryColor}"},"spacing":{"margin":{"bottom":"16px"}}}} -->
<p style="font-size:2rem;font-weight:800;color:${primaryColor};margin-bottom:16px">${ps.step}</p>
<!-- /wp:paragraph -->
<!-- wp:heading {"level":3,"style":{"typography":{"fontSize":"1.125rem","fontWeight":"700"},"spacing":{"margin":{"bottom":"12px"}}}} -->
<h3 class="wp-block-heading" style="font-size:1.125rem;font-weight:700;margin-bottom:12px">${ps.title}</h3>
<!-- /wp:heading -->
<!-- wp:paragraph {"textColor":"secondary"} -->
<p class="has-secondary-color has-text-color">${ps.description}</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:group -->
</div>
<!-- /wp:column -->`).join("\n")}
</div>
<!-- /wp:columns -->
</div>
<!-- /wp:group -->` : ""}

<!-- wp:group {"style":{"color":{"background":"${primaryColor}"},"spacing":{"padding":{"top":"80px","bottom":"80px"}}},"layout":{"type":"constrained","contentSize":"700px"}} -->
<div class="wp-block-group" style="background-color:${primaryColor};padding-top:80px;padding-bottom:80px">
<!-- wp:heading {"level":2,"textColor":"white","textAlign":"center","style":{"typography":{"fontSize":"2.25rem","fontWeight":"800"},"spacing":{"margin":{"bottom":"32px"}}}} -->
<h2 class="wp-block-heading has-white-color has-text-color has-text-align-center" style="font-size:2.25rem;font-weight:800;margin-bottom:32px">${cta.headline ?? "Ready to Get Started?"}</h2>
<!-- /wp:heading -->
<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} -->
<div class="wp-block-buttons">
<!-- wp:button {"backgroundColor":"white","style":{"border":{"radius":"8px"},"typography":{"fontWeight":"700"},"spacing":{"padding":{"top":"16px","bottom":"16px","left":"36px","right":"36px"}}}} -->
<div class="wp-block-button"><a class="wp-block-button__link has-white-background-color has-background" href="/contact" style="border-radius:8px;font-weight:700;padding:16px 36px;color:${primaryColor}">${cta.button ?? "Book a Free Consultation"}</a></div>
<!-- /wp:button -->
</div>
<!-- /wp:buttons -->
</div>
<!-- /wp:group -->
`;
}

// ---------------------------------------------------------------------------
// Contact page
// ---------------------------------------------------------------------------

function buildContactPage(content: any, primaryColor = "#1a56db"): string {
  const heroHeadline: string = content.hero_headline ?? "Get In Touch";
  const intro: string = content.intro ?? "We'd love to hear from you. Send us a message and we'll respond as soon as possible.";
  const email: string = content.email ?? "";
  const phone: string = content.phone ?? "";
  const address: string = content.address ?? "";
  const hours: string = content.hours ?? "Mon–Fri, 9am–6pm";
  const responsePromise: string = content.response_promise ?? "We respond within 24 hours";
  const formHeadline: string = content.form_headline ?? "Send Us a Message";

  return `
<!-- wp:cover {"isDark":true,"minHeight":340,"minHeightUnit":"px","style":{"color":{"background":"${primaryColor}"},"spacing":{"padding":{"top":"80px","bottom":"80px"}}}} -->
<div class="wp-block-cover is-dark" style="background-color:${primaryColor};min-height:340px;padding-top:80px;padding-bottom:80px">
<div class="wp-block-cover__inner-container">
<!-- wp:group {"layout":{"type":"constrained","contentSize":"700px"}} -->
<div class="wp-block-group">
<!-- wp:heading {"level":1,"textColor":"white","textAlign":"center","style":{"typography":{"fontSize":"clamp(2.25rem,4vw,3.5rem)","fontWeight":"800"}}} -->
<h1 class="wp-block-heading has-white-color has-text-color has-text-align-center" style="font-size:clamp(2.25rem,4vw,3.5rem);font-weight:800">${heroHeadline}</h1>
<!-- /wp:heading -->
<!-- wp:paragraph {"textColor":"white","textAlign":"center","style":{"typography":{"fontSize":"1.125rem"},"spacing":{"margin":{"top":"20px"}}}} -->
<p class="has-white-color has-text-color has-text-align-center" style="font-size:1.125rem;margin-top:20px;opacity:0.9">${intro}</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:group -->
</div>
</div>
<!-- /wp:cover -->

<!-- wp:group {"style":{"spacing":{"padding":{"top":"80px","bottom":"80px"}}},"layout":{"type":"constrained","contentSize":"1100px"}} -->
<div class="wp-block-group" style="padding-top:80px;padding-bottom:80px">
<!-- wp:columns {"isStackedOnMobile":true,"style":{"spacing":{"blockGap":"64px"}}} -->
<div class="wp-block-columns is-layout-flex">

<!-- Contact info column -->
<!-- wp:column {"width":"38%"} -->
<div class="wp-block-column" style="flex-basis:38%">
<!-- wp:heading {"level":2,"style":{"typography":{"fontSize":"1.75rem","fontWeight":"700"},"spacing":{"margin":{"bottom":"32px"}}}} -->
<h2 class="wp-block-heading" style="font-size:1.75rem;font-weight:700;margin-bottom:32px">Contact Information</h2>
<!-- /wp:heading -->

${email ? `<!-- wp:group {"style":{"spacing":{"padding":{"bottom":"24px"},"margin":{"bottom":"24px"}},"border":{"bottom":{"color":"#e5e7eb","width":"1px"}}},"layout":{"type":"flex","flexWrap":"nowrap","verticalAlignment":"top"}} -->
<div class="wp-block-group" style="padding-bottom:24px;margin-bottom:24px;border-bottom:1px solid #e5e7eb;display:flex;align-items:flex-start;gap:16px">
<!-- wp:paragraph {"style":{"typography":{"fontSize":"1.5rem"}}} -->
<p style="font-size:1.5rem;flex-shrink:0">✉️</p>
<!-- /wp:paragraph -->
<!-- wp:group {"layout":{"type":"constrained"}} -->
<div class="wp-block-group" style="flex:1">
<!-- wp:paragraph {"style":{"typography":{"fontWeight":"600","fontSize":"0.875rem","textTransform":"uppercase","letterSpacing":"0.05em"},"spacing":{"margin":{"bottom":"4px"}}}} -->
<p style="font-weight:600;font-size:0.875rem;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Email</p>
<!-- /wp:paragraph -->
<!-- wp:paragraph -->
<p><a href="mailto:${email}" style="color:${primaryColor};text-decoration:none">${email}</a></p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:group -->
</div>
<!-- /wp:group -->` : ""}

${phone ? `<!-- wp:group {"style":{"spacing":{"padding":{"bottom":"24px"},"margin":{"bottom":"24px"}},"border":{"bottom":{"color":"#e5e7eb","width":"1px"}}},"layout":{"type":"flex","flexWrap":"nowrap","verticalAlignment":"top"}} -->
<div class="wp-block-group" style="padding-bottom:24px;margin-bottom:24px;border-bottom:1px solid #e5e7eb;display:flex;align-items:flex-start;gap:16px">
<!-- wp:paragraph {"style":{"typography":{"fontSize":"1.5rem"}}} -->
<p style="font-size:1.5rem;flex-shrink:0">📞</p>
<!-- /wp:paragraph -->
<!-- wp:group {"layout":{"type":"constrained"}} -->
<div class="wp-block-group" style="flex:1">
<!-- wp:paragraph {"style":{"typography":{"fontWeight":"600","fontSize":"0.875rem","textTransform":"uppercase","letterSpacing":"0.05em"},"spacing":{"margin":{"bottom":"4px"}}}} -->
<p style="font-weight:600;font-size:0.875rem;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Phone</p>
<!-- /wp:paragraph -->
<!-- wp:paragraph -->
<p><a href="tel:${phone}" style="color:${primaryColor};text-decoration:none">${phone}</a></p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:group -->
</div>
<!-- /wp:group -->` : ""}

${address ? `<!-- wp:group {"style":{"spacing":{"padding":{"bottom":"24px"},"margin":{"bottom":"24px"}},"border":{"bottom":{"color":"#e5e7eb","width":"1px"}}},"layout":{"type":"flex","flexWrap":"nowrap","verticalAlignment":"top"}} -->
<div class="wp-block-group" style="padding-bottom:24px;margin-bottom:24px;border-bottom:1px solid #e5e7eb;display:flex;align-items:flex-start;gap:16px">
<!-- wp:paragraph {"style":{"typography":{"fontSize":"1.5rem"}}} -->
<p style="font-size:1.5rem;flex-shrink:0">📍</p>
<!-- /wp:paragraph -->
<!-- wp:group {"layout":{"type":"constrained"}} -->
<div class="wp-block-group" style="flex:1">
<!-- wp:paragraph {"style":{"typography":{"fontWeight":"600","fontSize":"0.875rem","textTransform":"uppercase","letterSpacing":"0.05em"},"spacing":{"margin":{"bottom":"4px"}}}} -->
<p style="font-weight:600;font-size:0.875rem;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Location</p>
<!-- /wp:paragraph -->
<!-- wp:paragraph -->
<p>${address}</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:group -->
</div>
<!-- /wp:group -->` : ""}

<!-- wp:group {"style":{"spacing":{"padding":{"bottom":"0px"}}},"layout":{"type":"flex","flexWrap":"nowrap","verticalAlignment":"top"}} -->
<div class="wp-block-group" style="display:flex;align-items:flex-start;gap:16px">
<!-- wp:paragraph {"style":{"typography":{"fontSize":"1.5rem"}}} -->
<p style="font-size:1.5rem;flex-shrink:0">🕐</p>
<!-- /wp:paragraph -->
<!-- wp:group {"layout":{"type":"constrained"}} -->
<div class="wp-block-group" style="flex:1">
<!-- wp:paragraph {"style":{"typography":{"fontWeight":"600","fontSize":"0.875rem","textTransform":"uppercase","letterSpacing":"0.05em"},"spacing":{"margin":{"bottom":"4px"}}}} -->
<p style="font-weight:600;font-size:0.875rem;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Hours</p>
<!-- /wp:paragraph -->
<!-- wp:paragraph -->
<p>${hours}</p>
<!-- /wp:paragraph -->
<!-- wp:paragraph {"style":{"typography":{"fontSize":"0.875rem","color":"${primaryColor}","fontWeight":"600"},"spacing":{"margin":{"top":"8px"}}}} -->
<p style="font-size:0.875rem;color:${primaryColor};font-weight:600;margin-top:8px">✓ ${responsePromise}</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:group -->
</div>
<!-- /wp:group -->
</div>
<!-- /wp:column -->

<!-- Contact form column -->
<!-- wp:column {"width":"62%"} -->
<div class="wp-block-column" style="flex-basis:62%">
<!-- wp:group {"style":{"border":{"radius":"16px","width":"1px","color":"#e5e7eb"},"spacing":{"padding":{"all":"48px"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group" style="border-radius:16px;border:1px solid #e5e7eb;padding:48px;box-shadow:0 4px 16px rgba(0,0,0,0.06)">
<!-- wp:heading {"level":2,"style":{"typography":{"fontSize":"1.75rem","fontWeight":"700"},"spacing":{"margin":{"bottom":"32px"}}}} -->
<h2 class="wp-block-heading" style="font-size:1.75rem;font-weight:700;margin-bottom:32px">${formHeadline}</h2>
<!-- /wp:heading -->

<!-- wp:html -->
<form action="#" method="POST" style="display:flex;flex-direction:column;gap:20px">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
    <div>
      <label for="contact-name" style="display:block;font-size:0.875rem;font-weight:600;margin-bottom:6px;color:#374151">Full Name *</label>
      <input type="text" id="contact-name" name="name" required placeholder="Jane Smith"
        style="width:100%;padding:12px 16px;border:1px solid #d1d5db;border-radius:8px;font-size:1rem;outline:none;box-sizing:border-box;transition:border-color 0.2s"
        onfocus="this.style.borderColor='${primaryColor}'" onblur="this.style.borderColor='#d1d5db'">
    </div>
    <div>
      <label for="contact-email" style="display:block;font-size:0.875rem;font-weight:600;margin-bottom:6px;color:#374151">Email Address *</label>
      <input type="email" id="contact-email" name="email" required placeholder="jane@company.com"
        style="width:100%;padding:12px 16px;border:1px solid #d1d5db;border-radius:8px;font-size:1rem;outline:none;box-sizing:border-box;transition:border-color 0.2s"
        onfocus="this.style.borderColor='${primaryColor}'" onblur="this.style.borderColor='#d1d5db'">
    </div>
  </div>
  <div>
    <label for="contact-phone" style="display:block;font-size:0.875rem;font-weight:600;margin-bottom:6px;color:#374151">Phone Number</label>
    <input type="tel" id="contact-phone" name="phone" placeholder="+1 (555) 000-0000"
      style="width:100%;padding:12px 16px;border:1px solid #d1d5db;border-radius:8px;font-size:1rem;outline:none;box-sizing:border-box;transition:border-color 0.2s"
      onfocus="this.style.borderColor='${primaryColor}'" onblur="this.style.borderColor='#d1d5db'">
  </div>
  <div>
    <label for="contact-subject" style="display:block;font-size:0.875rem;font-weight:600;margin-bottom:6px;color:#374151">Subject *</label>
    <input type="text" id="contact-subject" name="subject" required placeholder="How can we help you?"
      style="width:100%;padding:12px 16px;border:1px solid #d1d5db;border-radius:8px;font-size:1rem;outline:none;box-sizing:border-box;transition:border-color 0.2s"
      onfocus="this.style.borderColor='${primaryColor}'" onblur="this.style.borderColor='#d1d5db'">
  </div>
  <div>
    <label for="contact-message" style="display:block;font-size:0.875rem;font-weight:600;margin-bottom:6px;color:#374151">Message *</label>
    <textarea id="contact-message" name="message" required rows="6" placeholder="Tell us about your project or question..."
      style="width:100%;padding:12px 16px;border:1px solid #d1d5db;border-radius:8px;font-size:1rem;outline:none;box-sizing:border-box;resize:vertical;font-family:inherit;transition:border-color 0.2s"
      onfocus="this.style.borderColor='${primaryColor}'" onblur="this.style.borderColor='#d1d5db'"></textarea>
  </div>
  <div>
    <button type="submit"
      style="display:inline-flex;align-items:center;justify-content:center;padding:14px 36px;background-color:${primaryColor};color:#ffffff;font-weight:700;font-size:1rem;border:none;border-radius:8px;cursor:pointer;transition:opacity 0.2s;width:100%"
      onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
      Send Message →
    </button>
  </div>
</form>
<!-- /wp:html -->

</div>
<!-- /wp:group -->
</div>
<!-- /wp:column -->

</div>
<!-- /wp:columns -->
</div>
<!-- /wp:group -->
`;
}

// ---------------------------------------------------------------------------
// Pricing page
// ---------------------------------------------------------------------------

function buildPricingPage(content: any, primaryColor = "#1a56db"): string {
  const heroHeadline: string = content.hero_headline ?? "Simple, Transparent Pricing";
  const intro: string = content.intro ?? "Choose the plan that works best for you.";
  const plans: any[] = content.plans ?? [];
  const faq: any[] = content.faq ?? [];

  return `
<!-- wp:cover {"isDark":true,"minHeight":340,"minHeightUnit":"px","style":{"color":{"background":"${primaryColor}"},"spacing":{"padding":{"top":"80px","bottom":"80px"}}}} -->
<div class="wp-block-cover is-dark" style="background-color:${primaryColor};min-height:340px;padding-top:80px;padding-bottom:80px">
<div class="wp-block-cover__inner-container">
<!-- wp:group {"layout":{"type":"constrained","contentSize":"700px"}} -->
<div class="wp-block-group">
<!-- wp:heading {"level":1,"textColor":"white","textAlign":"center","style":{"typography":{"fontSize":"clamp(2.25rem,4vw,3.5rem)","fontWeight":"800"}}} -->
<h1 class="wp-block-heading has-white-color has-text-color has-text-align-center" style="font-size:clamp(2.25rem,4vw,3.5rem);font-weight:800">${heroHeadline}</h1>
<!-- /wp:heading -->
${intro ? `<!-- wp:paragraph {"textColor":"white","textAlign":"center","style":{"typography":{"fontSize":"1.2rem"},"spacing":{"margin":{"top":"20px"}}}} -->
<p class="has-white-color has-text-color has-text-align-center" style="font-size:1.2rem;margin-top:20px;opacity:0.9">${intro}</p>
<!-- /wp:paragraph -->` : ""}
</div>
<!-- /wp:group -->
</div>
</div>
<!-- /wp:cover -->

<!-- wp:group {"style":{"spacing":{"padding":{"top":"80px","bottom":"80px"}}},"layout":{"type":"constrained","contentSize":"1100px"}} -->
<div class="wp-block-group" style="padding-top:80px;padding-bottom:80px">
<!-- wp:columns {"isStackedOnMobile":true,"style":{"spacing":{"blockGap":"24px"}}} -->
<div class="wp-block-columns is-layout-flex">
${plans.map((plan: any) => `<!-- wp:column -->
<div class="wp-block-column">
<!-- wp:group {"style":{"border":{"radius":"16px","width":plan.featured ? "2px" : "1px","color":plan.featured ? "${primaryColor}" : "#e5e7eb"},"color":{"background":plan.featured ? "${primaryColor}" : "#ffffff"},"spacing":{"padding":{"all":"40px"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group" style="border-radius:16px;border:${plan.featured ? `2px solid ${primaryColor}` : "1px solid #e5e7eb"};background-color:${plan.featured ? primaryColor : "#ffffff"};padding:40px;box-shadow:${plan.featured ? `0 8px 32px rgba(0,0,0,0.15)` : "0 1px 4px rgba(0,0,0,0.06)"}">
${plan.featured ? `<!-- wp:paragraph {"textAlign":"center","style":{"typography":{"fontWeight":"700","fontSize":"0.75rem","textTransform":"uppercase","letterSpacing":"0.1em"},"color":{"text":"#ffffff"},"spacing":{"margin":{"bottom":"16px"}}}} -->
<p style="font-weight:700;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.1em;color:#ffffff;text-align:center;margin-bottom:16px">Most Popular</p>
<!-- /wp:paragraph -->` : ""}
<!-- wp:heading {"level":3,"textAlign":"center","style":{"typography":{"fontSize":"1.5rem","fontWeight":"700"},"spacing":{"margin":{"bottom":"8px"}}}${plan.featured ? ',"textColor":"white"' : ""}} -->
<h3 class="wp-block-heading has-text-align-center${plan.featured ? " has-white-color has-text-color" : ""}" style="font-size:1.5rem;font-weight:700;margin-bottom:8px">${plan.name}</h3>
<!-- /wp:heading -->
<!-- wp:paragraph {"textAlign":"center","style":{"typography":{"fontSize":"2.5rem","fontWeight":"800"},"spacing":{"margin":{"bottom":"4px"}}}${plan.featured ? ',"textColor":"white"' : ""}} -->
<p class="has-text-align-center${plan.featured ? " has-white-color has-text-color" : ""}" style="font-size:2.5rem;font-weight:800;margin-bottom:4px">${plan.price}</p>
<!-- /wp:paragraph -->
${plan.period ? `<!-- wp:paragraph {"textAlign":"center","style":{"typography":{"fontSize":"0.875rem"},"spacing":{"margin":{"bottom":"32px"}}}${plan.featured ? ',"textColor":"white"' : ',"textColor":"secondary"'}} -->
<p class="has-text-align-center${plan.featured ? " has-white-color has-text-color" : " has-secondary-color has-text-color"}" style="font-size:0.875rem;margin-bottom:32px">${plan.period}</p>
<!-- /wp:paragraph -->` : ""}
<!-- wp:separator {"style":{"spacing":{"margin":{"bottom":"32px"}}}${plan.featured ? ',"backgroundColor":"white"' : ""}} -->
<hr class="wp-block-separator${plan.featured ? " has-white-background-color has-background" : ""}" style="margin-bottom:32px;opacity:0.3"/>
<!-- /wp:separator -->
${plan.features?.length ? `<!-- wp:list {"style":{"spacing":{"margin":{"bottom":"32px"}}}} -->
<ul class="wp-block-list" style="margin-bottom:32px">
${(plan.features as string[]).map((feat: string) => `<!-- wp:list-item -->
<li${plan.featured ? ' style="color:#ffffff"' : ""}>${feat}</li>
<!-- /wp:list-item -->`).join("\n")}
</ul>
<!-- /wp:list -->` : ""}
<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} -->
<div class="wp-block-buttons">
<!-- wp:button {"style":{"border":{"radius":"8px"},"typography":{"fontWeight":"700"},"spacing":{"padding":{"top":"14px","bottom":"14px","left":"32px","right":"32px"}}}${plan.featured ? ',"backgroundColor":"white"' : ""}} -->
<div class="wp-block-button"><a class="wp-block-button__link${plan.featured ? " has-white-background-color has-background" : ""}" href="/contact" style="border-radius:8px;font-weight:700;padding:14px 32px;${plan.featured ? `color:${primaryColor}` : `background-color:${primaryColor};color:#ffffff`}">${plan.cta ?? "Get Started"}</a></div>
<!-- /wp:button -->
</div>
<!-- /wp:buttons -->
</div>
<!-- /wp:group -->
</div>
<!-- /wp:column -->`).join("\n")}
</div>
<!-- /wp:columns -->
</div>
<!-- /wp:group -->

${faq.length > 0 ? `
<!-- wp:group {"style":{"color":{"background":"#f9fafb"},"spacing":{"padding":{"top":"80px","bottom":"80px"}}},"layout":{"type":"constrained","contentSize":"800px"}} -->
<div class="wp-block-group" style="background-color:#f9fafb;padding-top:80px;padding-bottom:80px">
<!-- wp:heading {"level":2,"textAlign":"center","style":{"typography":{"fontSize":"2.25rem","fontWeight":"700"},"spacing":{"margin":{"bottom":"48px"}}}} -->
<h2 class="wp-block-heading has-text-align-center" style="font-size:2.25rem;font-weight:700;margin-bottom:48px">Pricing Questions</h2>
<!-- /wp:heading -->
${faq.map((q: any) => `
<!-- wp:details -->
<details class="wp-block-details" style="border-bottom:1px solid #e5e7eb;padding:20px 0">
<summary style="font-weight:600;cursor:pointer;font-size:1rem">${q.question}</summary>
<!-- wp:paragraph -->
<p>${q.answer}</p>
<!-- /wp:paragraph -->
</details>
<!-- /wp:details -->`).join("\n")}
</div>
<!-- /wp:group -->` : ""}
`;
}

// ---------------------------------------------------------------------------
// Portfolio page
// ---------------------------------------------------------------------------

function buildPortfolioPage(content: any, _heroImageUrl?: string, primaryColor = "#1a56db"): string {
  const heroHeadline: string = content.hero_headline ?? "Our Work";
  const intro: string = content.intro ?? "Explore our portfolio of successful projects.";
  const items: any[] = content.items ?? content.portfolio ?? [];

  return `
<!-- wp:cover {"isDark":true,"minHeight":340,"minHeightUnit":"px","style":{"color":{"background":"${primaryColor}"},"spacing":{"padding":{"top":"80px","bottom":"80px"}}}} -->
<div class="wp-block-cover is-dark" style="background-color:${primaryColor};min-height:340px;padding-top:80px;padding-bottom:80px">
<div class="wp-block-cover__inner-container">
<!-- wp:group {"layout":{"type":"constrained","contentSize":"700px"}} -->
<div class="wp-block-group">
<!-- wp:heading {"level":1,"textColor":"white","textAlign":"center","style":{"typography":{"fontSize":"clamp(2.25rem,4vw,3.5rem)","fontWeight":"800"}}} -->
<h1 class="wp-block-heading has-white-color has-text-color has-text-align-center" style="font-size:clamp(2.25rem,4vw,3.5rem);font-weight:800">${heroHeadline}</h1>
<!-- /wp:heading -->
${intro ? `<!-- wp:paragraph {"textColor":"white","textAlign":"center","style":{"typography":{"fontSize":"1.2rem"},"spacing":{"margin":{"top":"20px"}}}} -->
<p class="has-white-color has-text-color has-text-align-center" style="font-size:1.2rem;margin-top:20px;opacity:0.9">${intro}</p>
<!-- /wp:paragraph -->` : ""}
</div>
<!-- /wp:group -->
</div>
</div>
<!-- /wp:cover -->

<!-- wp:group {"style":{"spacing":{"padding":{"top":"80px","bottom":"80px"}}},"layout":{"type":"constrained","contentSize":"1100px"}} -->
<div class="wp-block-group" style="padding-top:80px;padding-bottom:80px">
<!-- wp:columns {"isStackedOnMobile":true,"style":{"spacing":{"blockGap":"32px"}}} -->
<div class="wp-block-columns is-layout-flex" style="flex-wrap:wrap">
${items.slice(0, 6).map((item: any) => `<!-- wp:column {"width":"33.333%"} -->
<div class="wp-block-column" style="flex-basis:33.333%">
<!-- wp:group {"style":{"border":{"radius":"12px"},"color":{"background":"#f9fafb"},"spacing":{"padding":{"all":"0px"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group" style="border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
${item.image ? `<!-- wp:image {"sizeSlug":"large","style":{"spacing":{"margin":{"bottom":"0px"}}}} -->
<figure class="wp-block-image size-large" style="margin-bottom:0"><img src="${item.image}" alt="${item.title ?? ""}" style="width:100%;height:220px;object-fit:cover;display:block"/></figure>
<!-- /wp:image -->` : `<!-- wp:group {"style":{"color":{"background":"${primaryColor}"},"dimensions":{"minHeight":"220px"},"spacing":{"padding":{"all":"32px"}}}} -->
<div class="wp-block-group" style="background-color:${primaryColor};min-height:220px;padding:32px;display:flex;align-items:center;justify-content:center">
<!-- wp:paragraph {"textColor":"white","textAlign":"center","style":{"typography":{"fontSize":"3rem"}}} -->
<p class="has-white-color has-text-color has-text-align-center" style="font-size:3rem">${item.icon_emoji ?? "🎨"}</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:group -->`}
<!-- wp:group {"style":{"spacing":{"padding":{"all":"24px"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group" style="padding:24px">
${item.category ? `<!-- wp:paragraph {"style":{"typography":{"fontSize":"0.75rem","fontWeight":"700","textTransform":"uppercase","letterSpacing":"0.08em","color":"${primaryColor}"},"spacing":{"margin":{"bottom":"8px"}}}} -->
<p style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:${primaryColor};margin-bottom:8px">${item.category}</p>
<!-- /wp:paragraph -->` : ""}
<!-- wp:heading {"level":3,"style":{"typography":{"fontSize":"1.125rem","fontWeight":"700"},"spacing":{"margin":{"bottom":"8px"}}}} -->
<h3 class="wp-block-heading" style="font-size:1.125rem;font-weight:700;margin-bottom:8px">${item.title ?? "Project"}</h3>
<!-- /wp:heading -->
<!-- wp:paragraph {"textColor":"secondary","style":{"typography":{"fontSize":"0.9375rem"}}} -->
<p class="has-secondary-color has-text-color" style="font-size:0.9375rem">${item.description ?? ""}</p>
<!-- /wp:paragraph -->
${item.link ? `<!-- wp:paragraph {"style":{"spacing":{"margin":{"top":"16px"}}}} -->
<p style="margin-top:16px"><a href="${item.link}" style="color:${primaryColor};font-weight:600;font-size:0.875rem;text-decoration:none">View Project →</a></p>
<!-- /wp:paragraph -->` : ""}
</div>
<!-- /wp:group -->
</div>
<!-- /wp:group -->
</div>
<!-- /wp:column -->`).join("\n")}
</div>
<!-- /wp:columns -->
</div>
<!-- /wp:group -->

<!-- wp:group {"style":{"color":{"background":"${primaryColor}"},"spacing":{"padding":{"top":"80px","bottom":"80px"}}},"layout":{"type":"constrained","contentSize":"700px"}} -->
<div class="wp-block-group" style="background-color:${primaryColor};padding-top:80px;padding-bottom:80px">
<!-- wp:heading {"level":2,"textColor":"white","textAlign":"center","style":{"typography":{"fontSize":"2.25rem","fontWeight":"800"},"spacing":{"margin":{"bottom":"16px"}}}} -->
<h2 class="wp-block-heading has-white-color has-text-color has-text-align-center" style="font-size:2.25rem;font-weight:800;margin-bottom:16px">Ready to Start Your Project?</h2>
<!-- /wp:heading -->
<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"},"style":{"spacing":{"margin":{"top":"32px"}}}} -->
<div class="wp-block-buttons" style="margin-top:32px">
<!-- wp:button {"backgroundColor":"white","style":{"border":{"radius":"8px"},"typography":{"fontWeight":"700"},"spacing":{"padding":{"top":"16px","bottom":"16px","left":"36px","right":"36px"}}}} -->
<div class="wp-block-button"><a class="wp-block-button__link has-white-background-color has-background" href="/contact" style="border-radius:8px;font-weight:700;padding:16px 36px;color:${primaryColor}">Let's Talk</a></div>
<!-- /wp:button -->
</div>
<!-- /wp:buttons -->
</div>
<!-- /wp:group -->
`;
}

// ---------------------------------------------------------------------------
// Generic page fallback
// ---------------------------------------------------------------------------

function buildGenericPage(content: any, _heroImageUrl?: string, primaryColor = "#1a56db"): string {
  const title: string = content.title ?? content.hero_headline ?? "Page";
  const body: string = content.body ?? content.intro ?? content.content ?? "";
  const paragraphs = body
    .split(/\n\n+/)
    .map((p: string) => p.trim())
    .filter(Boolean);

  return `
<!-- wp:cover {"isDark":true,"minHeight":340,"minHeightUnit":"px","style":{"color":{"background":"${primaryColor}"},"spacing":{"padding":{"top":"80px","bottom":"80px"}}}} -->
<div class="wp-block-cover is-dark" style="background-color:${primaryColor};min-height:340px;padding-top:80px;padding-bottom:80px">
<div class="wp-block-cover__inner-container">
<!-- wp:heading {"level":1,"textColor":"white","textAlign":"center","style":{"typography":{"fontSize":"clamp(2.25rem,4vw,3.5rem)","fontWeight":"800"}}} -->
<h1 class="wp-block-heading has-white-color has-text-color has-text-align-center" style="font-size:clamp(2.25rem,4vw,3.5rem);font-weight:800">${title}</h1>
<!-- /wp:heading -->
</div>
</div>
<!-- /wp:cover -->

<!-- wp:group {"style":{"spacing":{"padding":{"top":"80px","bottom":"80px"}}},"layout":{"type":"constrained","contentSize":"820px"}} -->
<div class="wp-block-group" style="padding-top:80px;padding-bottom:80px">
${paragraphs.map((para: string) => `<!-- wp:paragraph {"style":{"typography":{"fontSize":"1.0625rem","lineHeight":"1.8"},"spacing":{"margin":{"bottom":"24px"}}}} -->
<p style="font-size:1.0625rem;line-height:1.8;margin-bottom:24px">${para}</p>
<!-- /wp:paragraph -->`).join("\n")}
</div>
<!-- /wp:group -->
`;
}

// ---------------------------------------------------------------------------
// Main serve handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      // -----------------------------------------------------------------------
      case "plan_site": {
        const content = await generateSiteContent(body as SiteBrief);
        return new Response(JSON.stringify({ success: true, content }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // -----------------------------------------------------------------------
      case "generate_page": {
        const { page_type, page_content, primary_color, hero_image_url } = body;
        const html = buildGutenbergPage(
          page_type,
          page_content,
          hero_image_url,
          primary_color,
        );
        return new Response(
          JSON.stringify({ success: true, html, page_type }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // -----------------------------------------------------------------------
      case "get_templates": {
        return new Response(
          JSON.stringify({
            page_types: ["home", "about", "services", "contact", "pricing", "portfolio", "blog"],
            styles: ["modern", "corporate", "creative", "minimal", "bold", "elegant"],
            color_schemes: ["blue", "green", "purple", "orange", "red", "monochrome"],
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // -----------------------------------------------------------------------
      case "generate_site": {
        const {
          wp_site_url,
          wp_username,
          wp_app_password,
          access_token,    // WP.com OAuth — alternative to username/password
          wpcom_blog_id,   // WP.com OAuth — blog numeric ID
          pages = ["home", "about", "services", "contact"],
          user_id,
          project_id,
        } = body;

        // 1. Generate all content with Gemini
        const siteContent = await generateSiteContent(body as SiteBrief);
        const primaryColor = siteContent.site?.primary_color ?? "#1a56db";

        // 2. Generate hero image (best-effort)
        let heroImageUrl: string | undefined;
        const heroImagePrompt = siteContent.pages?.home?.hero?.hero_image_prompt;
        if (heroImagePrompt) {
          try {
            const imgRes = await fetch(
              `${SUPABASE_URL}/functions/v1/mavis-image-gen`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: req.headers.get("Authorization") ?? "",
                },
                body: JSON.stringify({
                  prompt: heroImagePrompt,
                  aspect_ratio: "16:9",
                }),
              },
            );
            if (imgRes.ok) {
              const imgData = await imgRes.json();
              heroImageUrl = imgData.url;
            }
          } catch {
            // hero image is optional — continue without it
          }
        }

        // 3. Build + publish each page
        const publishedPages: Array<{
          type: string;
          wp_id: number;
          url: string;
          slug: string;
        }> = [];
        const generatedHtmls: Record<string, string> = {};

        for (const pageType of (pages as string[])) {
          const pageContent = siteContent.pages?.[pageType];
          if (!pageContent && pageType !== "home") continue;

          const gutenbergHtml = buildGutenbergPage(
            pageType,
            pageContent ?? siteContent.pages?.home ?? {},
            pageType === "home" ? heroImageUrl : undefined,
            primaryColor,
          );
          generatedHtmls[pageType] = gutenbergHtml;

          // 3a. Generate SEO meta (best-effort)
          let metaTitle = "";
          let metaDesc = "";
          try {
            const seoRes = await fetch(
              `${SUPABASE_URL}/functions/v1/mavis-seo-engine`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: req.headers.get("Authorization") ?? "",
                },
                body: JSON.stringify({
                  action: "generate_meta",
                  page_title: `${pageType.charAt(0).toUpperCase() + pageType.slice(1)} - ${body.business_name}`,
                  page_content: gutenbergHtml.slice(0, 500),
                  business_name: body.business_name,
                  business_type: body.business_type,
                }),
              },
            );
            if (seoRes.ok) {
              const seoData = await seoRes.json();
              metaTitle = seoData.meta_title ?? "";
              metaDesc = seoData.meta_description ?? "";
            }
          } catch {
            // SEO meta is optional
          }

          // 3b. Publish page to WordPress / WordPress.com (best-effort)
          const hasAppPw  = wp_site_url && wp_username && wp_app_password;
          const hasOAuth  = access_token && wpcom_blog_id;
          if (hasAppPw || hasOAuth) {
            try {
              const wpPayload: Record<string, unknown> = {
                action: "create_page",
                title: pageType === "home"
                  ? (body.business_name ?? siteContent.site?.title ?? "Home")
                  : `${pageType.charAt(0).toUpperCase() + pageType.slice(1)} - ${body.business_name}`,
                content: gutenbergHtml,
                status: "publish",
                slug: pageType === "home" ? "home" : pageType,
                meta: {
                  _yoast_wpseo_title: metaTitle,
                  _yoast_wpseo_metadesc: metaDesc,
                },
              };
              if (hasOAuth) {
                wpPayload.access_token  = access_token;
                wpPayload.wpcom_blog_id = wpcom_blog_id;
              } else {
                wpPayload.site_url    = wp_site_url;
                wpPayload.username    = wp_username;
                wpPayload.app_password = wp_app_password;
              }

              const wpRes = await fetch(
                `${SUPABASE_URL}/functions/v1/mavis-wordpress`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: req.headers.get("Authorization") ?? "",
                  },
                  body: JSON.stringify(wpPayload),
                },
              );
              if (wpRes.ok) {
                const wpData = await wpRes.json();
                publishedPages.push({
                  type: pageType,
                  wp_id: wpData.data?.id ?? wpData.id,
                  url: wpData.data?.link ?? wpData.link,
                  slug: pageType,
                });
              }
            } catch (e) {
              console.warn(`Failed to publish ${pageType}:`, e);
            }
          }
        }

        // 4. Set homepage + site identity in WordPress (best-effort)
        const homePage = publishedPages.find((p) => p.type === "home");
        const wpAuthPayload = access_token && wpcom_blog_id
          ? { access_token, wpcom_blog_id }
          : { site_url: wp_site_url, username: wp_username, app_password: wp_app_password };

        if (homePage && (wp_site_url || wpcom_blog_id)) {
          const wpHeaders = { "Content-Type": "application/json", Authorization: req.headers.get("Authorization") ?? "" };

          await fetch(`${SUPABASE_URL}/functions/v1/mavis-wordpress`, {
            method: "POST", headers: wpHeaders,
            body: JSON.stringify({ action: "set_homepage", ...wpAuthPayload, home_page_id: homePage.wp_id }),
          }).catch(() => {});

          await fetch(`${SUPABASE_URL}/functions/v1/mavis-wordpress`, {
            method: "POST", headers: wpHeaders,
            body: JSON.stringify({
              action: "set_site_identity", ...wpAuthPayload,
              title: body.business_name ?? siteContent.site?.title ?? "",
              description: siteContent.site?.tagline ?? "",
            }),
          }).catch(() => {});
        }

        // 5. Persist results to Supabase
        if (project_id && user_id) {
          const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

          // Upsert every generated page, including HTML; merge WP data if available
          const wpByType = Object.fromEntries(publishedPages.map((p) => [p.type, p]));
          for (const [pageType, html] of Object.entries(generatedHtmls)) {
            const wp = wpByType[pageType];
            await sb.from("website_pages").upsert({
              project_id,
              user_id,
              page_type: pageType,
              slug: pageType,
              gutenberg_html: html,
              ...(wp ? {
                wp_page_id: wp.wp_id,
                wp_url: wp.url,
                status: "published",
                published_at: new Date().toISOString(),
              } : {
                status: "generated",
              }),
            }, { onConflict: "project_id,page_type" });
          }

          const totalPages = Object.keys(generatedHtmls).length;
          await sb
            .from("website_projects")
            .update({
              status: publishedPages.length > 0 ? "published" : "generated",
              pages_count: totalPages,
              published_at: publishedPages.length > 0 ? new Date().toISOString() : null,
            })
            .eq("id", project_id);
        }

        return new Response(
          JSON.stringify({
            success: true,
            pages_published: publishedPages.length,
            pages_generated: Object.keys(generatedHtmls).length,
            pages: publishedPages,
            site_content: siteContent,
            hero_image_url: heroImageUrl,
            preview_url: homePage?.url ?? wp_site_url,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // -----------------------------------------------------------------------
      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
    }
  } catch (err: any) {
    console.error("mavis-web-builder error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
