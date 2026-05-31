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

type SectionData =
  | { type: "hero"; headline: string; subheadline: string; cta_primary: string; cta_secondary?: string; badge?: string }
  | { type: "stats"; items: Array<{ number: string; label: string }> }
  | { type: "features"; headline: string; subheadline?: string; chip?: string; items: Array<{ icon: string; title: string; description: string }> }
  | { type: "steps"; headline: string; subheadline?: string; chip?: string; items: Array<{ title: string; description: string }> }
  | { type: "testimonials"; headline: string; chip?: string; items: Array<{ quote: string; author: string; role: string }> }
  | { type: "cta"; headline: string; subheadline: string; cta_primary: string; cta_secondary?: string }
  | { type: "pricing"; headline: string; subheadline?: string; chip?: string; plans: Array<{ name: string; price: string; period?: string; description?: string; features: string[]; highlighted?: boolean; cta?: string }> }
  | { type: "faq"; headline: string; chip?: string; items: Array<{ question: string; answer: string }> }
  | { type: "contact"; headline: string; subheadline?: string; email?: string; phone?: string; address?: string; hours?: string }
  | { type: "team"; headline: string; subheadline?: string; members: Array<{ name: string; role: string; bio: string; emoji?: string }> }
  | { type: "portfolio"; headline: string; subheadline?: string; items: Array<{ title: string; category: string; description: string }> }
  | { type: "about_hero"; headline: string; subheadline: string; body: string }
  | { type: "services"; headline: string; subheadline?: string; chip?: string; items: Array<{ title: string; description: string; price?: string; icon?: string }> }
  | { type: "values"; headline: string; subheadline?: string; items: Array<{ emoji: string; title: string; description: string }> }
  | { type: "content_block"; headline?: string; body: string; chip?: string; bg?: boolean }
  | { type: "image_text"; headline: string; body: string; image_side?: "left" | "right"; cta?: string; chip?: string };

interface PageBrief { business_name?: string; business_type?: string; style?: string }

// ---------------------------------------------------------------------------
// AI cascade helpers
// ---------------------------------------------------------------------------

async function callAI(prompt: string, maxTokens = 8192): Promise<any> {
  if (GEMINI_KEY) {
    const GEMINI_MODELS = ["gemini-2.5-flash-preview-05-20", "gemini-2.0-flash", "gemini-1.5-flash"];
    const gemBody = JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, responseMimeType: "application/json", maxOutputTokens: maxTokens },
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
      if (res.status === 429) break;
    }
  }
  if (CLAUDE_KEY) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": CLAUDE_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: maxTokens,
        system: "You are an expert web designer. Always respond with valid JSON only — no markdown, no explanation.",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const text = data.content?.[0]?.text ?? "{}";
      const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      return JSON.parse(match ? match[0] : text);
    }
  }
  if (OPENAI_KEY) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are an expert web designer. Respond with valid JSON only." },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content ?? "{}";
      return JSON.parse(text);
    }
  }
  throw new Error("All AI providers failed or have no funded keys.");
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

  return callAI(systemPrompt, 8192);
}

// ---------------------------------------------------------------------------
// AI-driven page section generation
// ---------------------------------------------------------------------------

function fallbackSections(pageType: string, content: any): SectionData[] {
  const c = content ?? {};
  const hero = c.hero ?? {};
  const cta = c.cta_section ?? {};
  const defaultCta: SectionData = {
    type: "cta",
    headline: cta.headline ?? "Ready to Get Started?",
    subheadline: cta.subtext ?? "Join us and experience the difference.",
    cta_primary: cta.cta_text ?? "Get Started Today",
  };
  switch (pageType) {
    case "home": {
      const out: SectionData[] = [
        { type: "hero", headline: hero.headline ?? "Welcome", subheadline: hero.subheadline ?? "", cta_primary: hero.cta_primary ?? "Get Started", badge: c.social_proof_bar?.text },
      ];
      if (c.stats?.length) out.push({ type: "stats", items: c.stats });
      if (c.features?.length) out.push({ type: "features", headline: c.features_title ?? "Why Choose Us", subheadline: c.features_subtitle, chip: "Features", items: c.features.map((f: any) => ({ icon: f.icon_emoji ?? "⚡", title: f.title ?? f.name, description: f.description ?? "" })) });
      if (c.how_it_works?.steps?.length) out.push({ type: "steps", headline: c.how_it_works.title ?? "How It Works", chip: "Process", items: c.how_it_works.steps.map((s: any) => ({ title: s.title, description: s.description })) });
      if (c.testimonials?.length) out.push({ type: "testimonials", headline: "What Our Clients Say", chip: "Testimonials", items: c.testimonials });
      if (c.faq?.length) out.push({ type: "faq", headline: "Frequently Asked Questions", chip: "FAQ", items: c.faq });
      out.push(defaultCta);
      return out;
    }
    case "about": {
      const out: SectionData[] = [
        { type: "about_hero", headline: c.hero_headline ?? "About Us", subheadline: c.mission ?? c.tagline ?? "", body: c.story ?? c.intro ?? "We are dedicated to excellence." },
      ];
      if (c.values?.length) out.push({ type: "values", headline: "Our Values", chip: "Values", items: c.values.map((v: any) => ({ emoji: v.icon_emoji ?? "⭐", title: v.title ?? v.name, description: v.description ?? "" })) });
      if (c.team?.length || c.team_members?.length) out.push({ type: "team", headline: "Meet the Team", chip: "Team", members: (c.team ?? c.team_members ?? []).map((m: any) => ({ name: m.name, role: m.role ?? m.title ?? "", bio: m.bio ?? "" })) });
      out.push(defaultCta);
      return out;
    }
    case "services": {
      const out: SectionData[] = [
        { type: "hero", headline: c.hero_headline ?? "Our Services", subheadline: c.intro ?? "", cta_primary: "Get a Quote" },
      ];
      if (c.services?.length ?? c.service_list?.length) out.push({ type: "services", headline: "What We Offer", chip: "Services", items: (c.services ?? c.service_list ?? []).map((s: any) => ({ icon: s.icon_emoji ?? "⚡", title: s.title ?? s.name, description: s.description ?? "", price: s.price })) });
      if (c.process_steps?.length) out.push({ type: "steps", headline: c.process_title ?? "Our Process", chip: "Process", items: c.process_steps.map((s: any) => ({ title: s.title, description: s.description })) });
      if (c.testimonials?.length) out.push({ type: "testimonials", headline: "Client Results", chip: "Testimonials", items: c.testimonials });
      out.push(defaultCta);
      return out;
    }
    case "pricing": {
      const out: SectionData[] = [
        { type: "content_block", headline: c.hero_headline ?? "Simple, Transparent Pricing", body: c.intro ?? "No hidden fees. No surprises.", chip: "Pricing" },
      ];
      if (c.plans?.length) out.push({ type: "pricing", headline: "Choose Your Plan", subheadline: c.subtitle, chip: "Plans", plans: c.plans });
      if (c.faq?.length) out.push({ type: "faq", headline: "Pricing FAQ", chip: "FAQ", items: c.faq });
      out.push(defaultCta);
      return out;
    }
    case "contact":
      return [{ type: "contact", headline: c.hero_headline ?? "Get in Touch", subheadline: c.intro, email: c.email, phone: c.phone, address: c.address, hours: c.hours }];
    case "portfolio": {
      const out: SectionData[] = [
        { type: "content_block", headline: "Our Work", body: c.intro ?? "Explore our portfolio of projects.", chip: "Portfolio" },
      ];
      if (c.projects?.length ?? c.portfolio?.length) out.push({ type: "portfolio", headline: "Featured Projects", items: (c.projects ?? c.portfolio ?? []).map((p: any) => ({ title: p.title, category: p.category ?? "Project", description: p.description ?? "" })) });
      if (c.testimonials?.length) out.push({ type: "testimonials", headline: "Client Feedback", items: c.testimonials });
      out.push(defaultCta);
      return out;
    }
    default:
      return [
        { type: "content_block", headline: c.title ?? pageType.charAt(0).toUpperCase() + pageType.slice(1), body: c.intro ?? c.description ?? "More information coming soon." },
        defaultCta,
      ];
  }
}

async function generatePageSections(pageType: string, brief: PageBrief, content: any): Promise<SectionData[]> {
  const prompt = `You are a professional web designer. Build a "${pageType}" page for this business.

Business: "${brief.business_name ?? "Business"}" (${brief.business_type ?? "business"})
Style: ${brief.style ?? "modern"}

AVAILABLE SECTION TYPES (use ONLY these exact type strings):
hero: {type:"hero",headline,subheadline,cta_primary,cta_secondary?,badge?}
stats: {type:"stats",items:[{number,label}]}  (3-4 items)
features: {type:"features",headline,subheadline?,chip?,items:[{icon,title,description}]}  (icon=emoji, 3-6 items)
steps: {type:"steps",headline,subheadline?,chip?,items:[{title,description}]}  (3-5 steps)
testimonials: {type:"testimonials",headline,chip?,items:[{quote,author,role}]}  (3 items)
cta: {type:"cta",headline,subheadline,cta_primary,cta_secondary?}
pricing: {type:"pricing",headline,subheadline?,chip?,plans:[{name,price,period?,description?,features[],highlighted?,cta?}]}
faq: {type:"faq",headline,chip?,items:[{question,answer}]}  (4-6 items)
contact: {type:"contact",headline,subheadline?,email?,phone?,address?,hours?}
team: {type:"team",headline,subheadline?,members:[{name,role,bio,emoji?}]}  (3-6 members)
portfolio: {type:"portfolio",headline,subheadline?,items:[{title,category,description}]}
about_hero: {type:"about_hero",headline,subheadline,body}  (body = 2-3 paragraph story)
services: {type:"services",headline,subheadline?,chip?,items:[{title,description,price?,icon?}]}
values: {type:"values",headline,subheadline?,items:[{emoji,title,description}]}  (3-4 values)
content_block: {type:"content_block",headline?,body,chip?,bg?:boolean}
image_text: {type:"image_text",headline,body,image_side?:"left"|"right",cta?,chip?}

PAGE RULES:
home → hero, stats, features, (steps or image_text), testimonials, cta  [5-7 sections]
about → about_hero, (values or image_text), team, cta  [4-5 sections]
services → hero, services, steps, testimonials, cta  [5 sections]
pricing → content_block, pricing, faq, cta  [4 sections]
contact → content_block, contact, faq?  [2-3 sections]
portfolio → content_block, portfolio, testimonials, cta  [4 sections]
other → content_block, features, cta  [3 sections]

Use this existing content (fill gaps with compelling, specific copy):
${JSON.stringify(content).slice(0, 2500)}

Return ONLY: {"sections":[...]}`;

  try {
    const result = await callAI(prompt, 4096);
    const arr: SectionData[] = result.sections ?? (Array.isArray(result) ? result : []);
    if (arr.length > 0) return arr;
  } catch { /* fall through */ }
  return fallbackSections(pageType, content);
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
// Standalone HTML builder — professional, self-contained pages for download
// ---------------------------------------------------------------------------

function _hexToRgb(hex: string): string {
  const c = hex.replace("#", "");
  const f = c.length === 3 ? c.split("").map(x => x + x).join("") : c;
  const n = parseInt(f, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

function _darken(hex: string, pct: number): string {
  const c = hex.replace("#", "");
  const f = c.length === 3 ? c.split("").map(x => x + x).join("") : c;
  const ch = (s: number, e: number) => Math.max(0, Math.round(parseInt(f.slice(s, e), 16) * (1 - pct)));
  return `#${ch(0,2).toString(16).padStart(2,"0")}${ch(2,4).toString(16).padStart(2,"0")}${ch(4,6).toString(16).padStart(2,"0")}`;
}

function _css(p: string): string {
  const rgb = _hexToRgb(p);
  const dk  = _darken(p, 0.28);
  return `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{font-size:16px;scroll-behavior:smooth;-webkit-font-smoothing:antialiased}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;color:#111827;background:#fff;line-height:1.6}
img{max-width:100%;height:auto;display:block}a{color:inherit;text-decoration:none}button{font-family:inherit;cursor:pointer;border:none;background:none}
:root{--p:${p};--p-rgb:${rgb};--dk:${dk};--tx:#111827;--mu:#6B7280;--lt:#9CA3AF;--bd:#E5E7EB;--sf:#F9FAFB;--sf2:#F3F4F6;--wh:#fff;
--sh:0 1px 3px rgba(0,0,0,.1),0 1px 2px rgba(0,0,0,.06);--sh-md:0 4px 6px -1px rgba(0,0,0,.1),0 2px 4px -1px rgba(0,0,0,.06);--sh-lg:0 10px 15px -3px rgba(0,0,0,.1),0 4px 6px -2px rgba(0,0,0,.05);--sh-xl:0 20px 25px -5px rgba(0,0,0,.1),0 10px 10px -5px rgba(0,0,0,.04);--r:12px;--r-sm:8px;--r-lg:16px;--r-full:999px;--t:.2s ease}
.c{max-width:1200px;margin:0 auto;padding:0 24px}.c-sm{max-width:820px;margin:0 auto;padding:0 24px}
.s{padding:96px 0}.s-md{padding:72px 0}.s-sm{padding:56px 0}.s-bg{background:var(--sf)}.s-dk{background:#0f172a}
h1,h2,h3,h4{font-family:'Plus Jakarta Sans','Inter',sans-serif;line-height:1.15;letter-spacing:-.025em;color:var(--tx);font-weight:800}
h1{font-size:clamp(2.25rem,5vw,4rem);letter-spacing:-.035em}h2{font-size:clamp(1.75rem,3.5vw,2.75rem);font-weight:700}h3{font-size:1.25rem;font-weight:700}h4{font-size:1.0625rem;font-weight:600}
p{color:var(--mu);line-height:1.75}.lead{font-size:1.125rem;color:var(--mu)}.tc{text-align:center}
.chip{display:inline-block;font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--p);background:rgba(${rgb},.1);padding:4px 14px;border-radius:var(--r-full);margin-bottom:16px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:14px 28px;border-radius:var(--r-sm);font-weight:600;font-size:.9375rem;cursor:pointer;transition:all var(--t);border:2px solid transparent;text-decoration:none;white-space:nowrap;font-family:inherit}
.btn-p{background:var(--p);color:#fff;box-shadow:0 4px 14px -2px rgba(${rgb},.35)}
.btn-p:hover{background:var(--dk);box-shadow:0 6px 20px -2px rgba(${rgb},.45);transform:translateY(-1px)}
.btn-o{border-color:var(--bd);color:var(--tx);background:var(--wh);box-shadow:0 1px 2px rgba(0,0,0,.05)}
.btn-o:hover{border-color:var(--p);color:var(--p)}
.btn-gw{border:2px solid rgba(255,255,255,.35);color:#fff}.btn-gw:hover{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.6)}
.btn-w{background:#fff;color:var(--p);font-weight:700}.btn-w:hover{background:#f0f4ff;transform:translateY(-1px);box-shadow:var(--sh-md)}
.btn-lg{padding:17px 36px;font-size:1.0625rem;border-radius:var(--r)}.btn-full{width:100%;display:flex}
nav{position:sticky;top:0;z-index:100;background:rgba(255,255,255,.96);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--bd);box-shadow:0 1px 2px rgba(0,0,0,.05)}
.ni{display:flex;align-items:center;justify-content:space-between;height:72px}
.logo{font-family:'Plus Jakarta Sans',sans-serif;font-size:1.1875rem;font-weight:800;color:var(--tx);letter-spacing:-.03em}
.nl{display:flex;align-items:center;gap:28px}.nl a{font-size:.875rem;font-weight:500;color:var(--mu);transition:color var(--t)}.nl a:hover{color:var(--tx)}
.hero{position:relative;overflow:hidden;background:linear-gradient(135deg,var(--p) 0%,var(--dk) 100%);padding:120px 0 96px}
.h-ov{position:absolute;inset:0;background:radial-gradient(ellipse at 60% 0%,rgba(255,255,255,.13) 0%,transparent 65%)}
.h-ov2{position:absolute;inset:0;background:radial-gradient(ellipse at 20% 100%,rgba(0,0,0,.18) 0%,transparent 60%)}
.h-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.18}
.hi{position:relative;text-align:center;max-width:900px;margin:0 auto}
.hi h1{color:#fff;margin-bottom:24px}.hi .lead{color:rgba(255,255,255,.85);max-width:640px;margin:0 auto 40px}
.ha{display:flex;gap:16px;justify-content:center;flex-wrap:wrap}
.badge{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.16);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.25);border-radius:var(--r-full);padding:6px 16px;font-size:.8125rem;color:rgba(255,255,255,.92);margin-bottom:32px;font-weight:500}
.sb{background:linear-gradient(90deg,var(--p) 0%,var(--dk) 100%)}
.sg{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.si{text-align:center;padding:36px 24px;position:relative}
.si:not(:last-child)::after{content:'';position:absolute;right:0;top:25%;bottom:25%;width:1px;background:rgba(255,255,255,.18)}
.sn{font-family:'Plus Jakarta Sans',sans-serif;font-size:2.25rem;font-weight:800;color:#fff;letter-spacing:-.04em;line-height:1}
.sl{font-size:.8125rem;color:rgba(255,255,255,.7);margin-top:6px;font-weight:500}
.fg{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px}
.card{background:#fff;border:1px solid var(--bd);border-radius:var(--r-lg);padding:32px;transition:all var(--t)}
.card:hover{border-color:rgba(${rgb},.5);box-shadow:0 0 0 3px rgba(${rgb},.07),var(--sh-md);transform:translateY(-2px)}
.ci{width:52px;height:52px;border-radius:var(--r-sm);background:rgba(${rgb},.1);display:flex;align-items:center;justify-content:center;font-size:1.5rem;margin-bottom:20px}
.card h3{margin-bottom:10px}.card p{font-size:.9375rem}
.steps{display:grid;gap:40px;max-width:760px;margin:0 auto}
.step{display:flex;gap:24px;align-items:flex-start}
.snum{flex-shrink:0;width:52px;height:52px;border-radius:50%;background:var(--p);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.0625rem;font-family:'Plus Jakarta Sans',sans-serif;box-shadow:0 4px 12px -2px rgba(${rgb},.4)}
.sbody h3{margin-bottom:8px}.sbody p{font-size:.9375rem}
.tg{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px}
.tc-card{background:#fff;border:1px solid var(--bd);border-radius:var(--r-lg);padding:32px;display:flex;flex-direction:column}
.ts{color:#FBBF24;font-size:1rem;letter-spacing:3px;margin-bottom:16px}
.tq{font-style:italic;color:var(--tx);line-height:1.75;flex:1;margin-bottom:24px;font-size:.9375rem}
.ta{display:flex;align-items:center;gap:12px;padding-top:20px;border-top:1px solid var(--bd)}
.tav{width:44px;height:44px;border-radius:50%;background:rgba(${rgb},.12);display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--p);font-size:.875rem;flex-shrink:0}
.tn{font-weight:600;font-size:.9375rem;color:var(--tx)}.tr{font-size:.8125rem;color:var(--mu)}
.faq-list{max-width:760px;margin:0 auto}
.faq-item{border-bottom:1px solid var(--bd)}
.faq-q{width:100%;text-align:left;padding:20px 0;display:flex;justify-content:space-between;align-items:center;gap:16px;font-weight:600;font-size:1rem;color:var(--tx);cursor:pointer;background:none;border:none;font-family:inherit}
.faq-icon{flex-shrink:0;color:var(--mu);transition:transform var(--t);line-height:1}
.faq-a{padding:0 0 20px;display:none;color:var(--mu);font-size:.9375rem;line-height:1.75}
.faq-item.open .faq-a{display:block}.faq-item.open .faq-icon{transform:rotate(45deg);color:var(--p)}
.cta-s{position:relative;overflow:hidden;background:linear-gradient(135deg,var(--p) 0%,var(--dk) 100%);padding:96px 0;text-align:center}
.cta-s::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 50% 120%,rgba(255,255,255,.07) 0%,transparent 65%)}
.cta-in{position:relative}.cta-s h2{color:#fff;margin-bottom:16px}.cta-s .lead{color:rgba(255,255,255,.8);max-width:540px;margin:0 auto 40px}
.cta-btns{display:flex;gap:16px;justify-content:center;flex-wrap:wrap}
.pg{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px;align-items:start}
.pc{background:#fff;border:2px solid var(--bd);border-radius:var(--r-lg);padding:40px 32px;position:relative;transition:all var(--t)}
.pc.feat{border-color:var(--p);box-shadow:0 0 0 4px rgba(${rgb},.08),var(--sh-xl)}
.pbadge{position:absolute;top:-14px;left:50%;transform:translateX(-50%);background:var(--p);color:#fff;padding:4px 18px;border-radius:var(--r-full);font-size:.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;white-space:nowrap}
.pname{font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--mu);margin-bottom:8px}
.pprice{font-family:'Plus Jakarta Sans',sans-serif;font-size:3rem;font-weight:800;color:var(--tx);letter-spacing:-.04em;line-height:1.1}
.pper{font-size:.875rem;color:var(--mu);font-weight:400}
.pdesc{color:var(--mu);margin:16px 0 24px;font-size:.9375rem}
.pdiv{border:none;border-top:1px solid var(--bd);margin:24px 0}
.pfeats{list-style:none;display:grid;gap:12px;margin-bottom:32px}
.pfeats li{display:flex;align-items:flex-start;gap:10px;font-size:.9375rem;color:var(--tx)}
.pfeats li::before{content:'✓';color:var(--p);font-weight:700;flex-shrink:0;margin-top:1px}
.cg{display:grid;grid-template-columns:1.2fr 1fr;gap:64px;align-items:start}
.fg-grp{margin-bottom:20px}
.fg-grp label{display:block;font-size:.875rem;font-weight:500;color:var(--tx);margin-bottom:6px}
.fctrl{width:100%;padding:12px 16px;border:1.5px solid var(--bd);border-radius:var(--r-sm);font-size:.9375rem;font-family:inherit;color:var(--tx);background:#fff;transition:border-color var(--t),box-shadow var(--t);outline:none;line-height:1.5}
.fctrl:focus{border-color:var(--p);box-shadow:0 0 0 3px rgba(${rgb},.12)}
textarea.fctrl{min-height:140px;resize:vertical}
.cd h3{margin-bottom:8px}.cd>.lead{margin-bottom:36px}
.cdet{display:flex;align-items:flex-start;gap:16px;margin-bottom:24px}
.cico{width:48px;height:48px;border-radius:var(--r-sm);background:rgba(${rgb},.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:1.25rem}
.clbl{font-size:.8125rem;color:var(--mu);margin-bottom:2px;font-weight:500}.cval{font-weight:600;color:var(--tx)}
.team-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:32px}
.team-card{text-align:center}
.team-av{width:100px;height:100px;border-radius:50%;margin:0 auto 16px;background:rgba(${rgb},.12);display:flex;align-items:center;justify-content:center;font-size:2.25rem;font-weight:700;color:var(--p)}
.team-name{font-weight:700;margin-bottom:4px;color:var(--tx)}.team-role{font-size:.875rem;color:var(--mu)}
.vg{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:24px}
.vc{text-align:center;padding:36px 24px;border:1px solid var(--bd);border-radius:var(--r-lg);background:#fff}
.vic{font-size:2.5rem;margin-bottom:16px}.vc h3{margin-bottom:8px}
.port-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}
.port-card{background:#fff;border:1px solid var(--bd);border-radius:var(--r-lg);overflow:hidden;transition:all var(--t)}
.port-card:hover{transform:translateY(-3px);box-shadow:var(--sh-lg)}
.port-img{height:220px;background:linear-gradient(135deg,rgba(${rgb},.12) 0%,rgba(${rgb},.25) 100%);display:flex;align-items:center;justify-content:center;font-size:3rem}
.port-body{padding:24px}
.port-body h3{margin-bottom:8px}.port-body p{font-size:.875rem}
.port-tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.port-tag{font-size:.75rem;font-weight:600;padding:4px 10px;border-radius:var(--r-full);background:rgba(${rgb},.08);color:var(--p)}
footer{background:#0f172a;padding:64px 0 32px}
.footer-grid{display:grid;grid-template-columns:2fr 1fr 1fr;gap:48px;margin-bottom:48px}
.footer-logo{font-family:'Plus Jakarta Sans',sans-serif;font-size:1.125rem;font-weight:800;color:#fff;margin-bottom:12px}
.footer-brand p{font-size:.875rem;color:rgba(255,255,255,.45);max-width:280px;line-height:1.7}
.footer-col h4{color:rgba(255,255,255,.85);font-size:.8125rem;font-weight:700;margin-bottom:16px;letter-spacing:.07em;text-transform:uppercase}
.footer-links{list-style:none;display:grid;gap:10px}
.footer-links a{font-size:.875rem;color:rgba(255,255,255,.45);transition:color var(--t)}.footer-links a:hover{color:#fff}
.footer-btm{border-top:1px solid rgba(255,255,255,.08);padding-top:28px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px}
.footer-btm p{font-size:.8125rem;color:rgba(255,255,255,.3)}
@media(max-width:1024px){.cg{grid-template-columns:1fr;gap:48px}.footer-grid{grid-template-columns:1fr 1fr;gap:36px}}
@media(max-width:768px){.nl{display:none}.hero{padding:80px 0 64px}.s{padding:64px 0}.s-md{padding:52px 0}.fg{grid-template-columns:1fr}.tg{grid-template-columns:1fr}.sg{grid-template-columns:repeat(2,1fr)}.footer-grid{grid-template-columns:1fr;gap:32px}.pg{grid-template-columns:1fr}}
@media(max-width:480px){.sg{grid-template-columns:1fr}.ha{flex-direction:column;align-items:center}.cta-btns{flex-direction:column;align-items:center}h1{font-size:clamp(1.75rem,8vw,2.5rem)}}`;
}

function _nav(title: string, pages: string[]): string {
  const links = pages.map(p =>
    `<a href="${p === "home" ? "index" : p}.html">${p.charAt(0).toUpperCase() + p.slice(1)}</a>`
  ).join("");
  return `<nav><div class="c"><div class="ni">
<a href="index.html" class="logo">${title}</a>
<div class="nl">${links}</div>
<a href="contact.html" class="btn btn-p nav-cta" style="padding:10px 22px;font-size:.875rem">Get Started</a>
</div></div></nav>`;
}

function _footer(title: string, pages: string[]): string {
  const yr = new Date().getFullYear();
  const links = pages.map(p =>
    `<li><a href="${p === "home" ? "index" : p}.html">${p.charAt(0).toUpperCase() + p.slice(1)}</a></li>`
  ).join("");
  return `<footer><div class="c">
<div class="footer-grid">
<div class="footer-brand"><div class="footer-logo">${title}</div><p>Professional web presence for modern businesses.</p></div>
<div class="footer-col"><h4>Pages</h4><ul class="footer-links">${links}</ul></div>
<div class="footer-col"><h4>Contact</h4><ul class="footer-links"><li><a href="contact.html">Get in Touch</a></li></ul></div>
</div>
<div class="footer-btm"><p>© ${yr} ${title}. All rights reserved.</p><p>Built with MAVIS AI</p></div>
</div></footer>`;
}

// ── Section component renderers ──────────────────────────────────────────────

function _sHero(s: any, heroUrl?: string): string {
  return `<section class="hero">
${heroUrl ? `<img class="h-bg" src="${heroUrl}" alt="">` : ""}
<div class="h-ov"></div><div class="h-ov2"></div>
<div class="c"><div class="hi">
${s.badge ? `<div class="badge">✦ ${s.badge}</div>` : ""}
<h1>${s.headline}</h1>
<p class="lead">${s.subheadline}</p>
<div class="ha">
<a href="contact.html" class="btn btn-w btn-lg">${s.cta_primary}</a>
${s.cta_secondary ? `<a href="#" class="btn btn-gw btn-lg">${s.cta_secondary}</a>` : ""}
</div>
</div></div>
</section>`;
}

function _sStats(s: any): string {
  return `<div class="sb"><div class="c"><div class="sg">
${(s.items ?? []).slice(0,5).map((i: any) => `<div class="si"><div class="sn">${i.number}</div><div class="sl">${i.label}</div></div>`).join("")}
</div></div></div>`;
}

function _sFeatures(s: any): string {
  return `<section class="s">
<div class="c">
<div class="tc" style="margin-bottom:56px">
${s.chip ? `<span class="chip">${s.chip}</span>` : ""}
<h2>${s.headline}</h2>
${s.subheadline ? `<p class="lead" style="max-width:560px;margin:16px auto 0">${s.subheadline}</p>` : ""}
</div>
<div class="fg">
${(s.items ?? []).map((f: any) => `<div class="card"><div class="ci">${f.icon ?? "⚡"}</div><h3>${f.title}</h3><p>${f.description}</p></div>`).join("")}
</div>
</div>
</section>`;
}

function _sSteps(s: any): string {
  return `<section class="s s-bg">
<div class="c">
<div class="tc" style="margin-bottom:56px">
${s.chip ? `<span class="chip">${s.chip}</span>` : ""}
<h2>${s.headline}</h2>
${s.subheadline ? `<p class="lead" style="max-width:560px;margin:16px auto 0">${s.subheadline}</p>` : ""}
</div>
<div class="steps">
${(s.items ?? []).map((st: any, i: number) => `<div class="step">
<div class="snum">${String(i + 1).padStart(2, "0")}</div>
<div class="sbody"><h3>${st.title}</h3><p>${st.description}</p></div>
</div>`).join("")}
</div>
</div>
</section>`;
}

function _sTestimonials(s: any): string {
  return `<section class="s s-bg">
<div class="c">
<div class="tc" style="margin-bottom:56px">
${s.chip ? `<span class="chip">${s.chip}</span>` : ""}
<h2>${s.headline}</h2>
</div>
<div class="tg">
${(s.items ?? []).map((t: any) => `<div class="tc-card">
<div class="ts">★★★★★</div>
<p class="tq">"${t.quote}"</p>
<div class="ta"><div class="tav">${(t.author ?? "A").charAt(0)}</div>
<div><div class="tn">${t.author}</div><div class="tr">${t.role}</div></div>
</div>
</div>`).join("")}
</div>
</div>
</section>`;
}

function _sCta(s: any): string {
  return `<section class="cta-s">
<div class="c"><div class="cta-in">
<h2>${s.headline}</h2>
<p class="lead">${s.subheadline}</p>
<div class="cta-btns">
<a href="contact.html" class="btn btn-w btn-lg">${s.cta_primary}</a>
${s.cta_secondary ? `<a href="#" class="btn btn-gw btn-lg">${s.cta_secondary}</a>` : ""}
</div>
</div></div>
</section>`;
}

function _sPricing(s: any): string {
  return `<section class="s">
<div class="c">
<div class="tc" style="margin-bottom:56px">
${s.chip ? `<span class="chip">${s.chip}</span>` : ""}
<h2>${s.headline}</h2>
${s.subheadline ? `<p class="lead" style="max-width:560px;margin:16px auto 0">${s.subheadline}</p>` : ""}
</div>
<div class="pg">
${(s.plans ?? []).map((p: any) => `<div class="pc${p.highlighted ? " feat" : ""}">
${p.highlighted ? `<div class="pbadge">Most Popular</div>` : ""}
<div class="pname">${p.name}</div>
<div class="pprice">${p.price}<span class="pper">${p.period ? `/${p.period}` : ""}</span></div>
${p.description ? `<p class="pdesc">${p.description}</p>` : ""}
<hr class="pdiv">
<ul class="pfeats">${(p.features ?? []).map((f: string) => `<li>${f}</li>`).join("")}</ul>
<a href="contact.html" class="btn ${p.highlighted ? "btn-p" : "btn-o"} btn-full">${p.cta ?? "Get Started"}</a>
</div>`).join("")}
</div>
</div>
</section>`;
}

function _sFaq(s: any): string {
  return `<section class="s s-bg">
<div class="c">
<div class="tc" style="margin-bottom:56px">
${s.chip ? `<span class="chip">${s.chip}</span>` : ""}
<h2>${s.headline}</h2>
</div>
<div class="faq-list">
${(s.items ?? []).map((f: any, i: number) => `<div class="faq-item">
<button class="faq-q" onclick="toggleFaq(${i})"><span>${f.question}</span><span class="faq-icon">+</span></button>
<div class="faq-a" id="faq-${i}">${f.answer}</div>
</div>`).join("")}
</div>
</div>
</section>`;
}

function _sContact(s: any): string {
  return `<section class="s">
<div class="c">
<div class="cg">
<div>
<h2>${s.headline}</h2>
${s.subheadline ? `<p class="lead" style="margin-bottom:36px">${s.subheadline}</p>` : ""}
<form>
<div class="fg-grp"><label>Your Name</label><input class="fctrl" type="text" placeholder="Jane Smith"></div>
<div class="fg-grp"><label>Email Address</label><input class="fctrl" type="email" placeholder="jane@example.com"></div>
<div class="fg-grp"><label>Subject</label><input class="fctrl" type="text" placeholder="How can we help?"></div>
<div class="fg-grp"><label>Message</label><textarea class="fctrl" placeholder="Tell us about your project…"></textarea></div>
<button type="submit" class="btn btn-p btn-lg" style="width:100%">Send Message →</button>
</form>
</div>
<div class="cd">
<h3>Contact Information</h3>
<p class="lead" style="margin-bottom:36px">We're here to help and answer any questions you might have.</p>
${s.email ? `<div class="cdet"><div class="cico">✉️</div><div><div class="clbl">Email</div><div class="cval">${s.email}</div></div></div>` : ""}
${s.phone ? `<div class="cdet"><div class="cico">📞</div><div><div class="clbl">Phone</div><div class="cval">${s.phone}</div></div></div>` : ""}
${s.address ? `<div class="cdet"><div class="cico">📍</div><div><div class="clbl">Address</div><div class="cval">${s.address}</div></div></div>` : ""}
${s.hours ? `<div class="cdet"><div class="cico">🕐</div><div><div class="clbl">Hours</div><div class="cval">${s.hours}</div></div></div>` : ""}
</div>
</div>
</div>
</section>`;
}

function _sTeam(s: any): string {
  return `<section class="s">
<div class="c">
<div class="tc" style="margin-bottom:56px">
${s.chip ? `<span class="chip">${s.chip}</span>` : ""}
<h2>${s.headline}</h2>
${s.subheadline ? `<p class="lead" style="max-width:560px;margin:16px auto 0">${s.subheadline}</p>` : ""}
</div>
<div class="team-grid">
${(s.members ?? []).map((m: any) => `<div class="team-card">
<div class="team-av">${m.emoji ?? (m.name ?? "T").charAt(0)}</div>
<div class="team-name">${m.name}</div>
<div class="team-role">${m.role}</div>
${m.bio ? `<p style="margin-top:12px;font-size:.875rem">${m.bio}</p>` : ""}
</div>`).join("")}
</div>
</div>
</section>`;
}

function _sPortfolio(s: any): string {
  const emojis = ["🎨","🚀","💡","⚡","🌟","🔥","💎","🏆","🎯","🌈"];
  return `<section class="s">
<div class="c">
<div class="tc" style="margin-bottom:56px">
${s.chip ? `<span class="chip">${s.chip}</span>` : ""}
<h2>${s.headline}</h2>
${s.subheadline ? `<p class="lead" style="max-width:560px;margin:16px auto 0">${s.subheadline}</p>` : ""}
</div>
<div class="port-grid">
${(s.items ?? []).map((p: any, i: number) => `<div class="port-card">
<div class="port-img">${emojis[i % emojis.length]}</div>
<div class="port-body">
<h3>${p.title}</h3>
<p>${p.description}</p>
<div class="port-tags"><span class="port-tag">${p.category}</span></div>
</div>
</div>`).join("")}
</div>
</div>
</section>`;
}

function _sAboutHero(s: any): string {
  const paragraphs = (s.body ?? "").split("\n\n").filter(Boolean);
  return `<section class="hero" style="padding:100px 0 84px">
<div class="h-ov"></div>
<div class="c"><div class="hi">
<h1>${s.headline}</h1>
<p class="lead">${s.subheadline}</p>
</div></div>
</section>
<section class="s">
<div class="c-sm">
${paragraphs.length > 0 ? paragraphs.map((p: string) => `<p class="lead" style="margin-bottom:28px">${p}</p>`).join("") : `<p class="lead">${s.body}</p>`}
</div>
</section>`;
}

function _sServices(s: any): string {
  return `<section class="s">
<div class="c">
<div class="tc" style="margin-bottom:56px">
${s.chip ? `<span class="chip">${s.chip}</span>` : ""}
<h2>${s.headline}</h2>
${s.subheadline ? `<p class="lead" style="max-width:560px;margin:16px auto 0">${s.subheadline}</p>` : ""}
</div>
<div class="fg">
${(s.items ?? []).map((svc: any) => `<div class="card">
<div class="ci">${svc.icon ?? "⚡"}</div>
<h3>${svc.title}</h3>
<p>${svc.description}</p>
${svc.price ? `<p style="margin-top:16px;font-weight:700;color:var(--p)">${svc.price}</p>` : ""}
</div>`).join("")}
</div>
</div>
</section>`;
}

function _sValues(s: any): string {
  return `<section class="s s-bg">
<div class="c">
<div class="tc" style="margin-bottom:56px">
${s.chip ? `<span class="chip">${s.chip}</span>` : ""}
<h2>${s.headline}</h2>
${s.subheadline ? `<p class="lead" style="max-width:560px;margin:16px auto 0">${s.subheadline}</p>` : ""}
</div>
<div class="vg">
${(s.items ?? []).map((v: any) => `<div class="vc"><div class="vic">${v.emoji}</div><h3>${v.title}</h3><p>${v.description}</p></div>`).join("")}
</div>
</div>
</section>`;
}

function _sContentBlock(s: any): string {
  const bg = s.bg !== false;
  return `<section class="s${bg ? " s-bg" : ""}">
<div class="c-sm" style="text-align:center">
${s.chip ? `<span class="chip">${s.chip}</span>` : ""}
${s.headline ? `<h2 style="margin-top:12px;margin-bottom:20px">${s.headline}</h2>` : ""}
<p class="lead">${s.body}</p>
</div>
</section>`;
}

function _sImageText(s: any): string {
  const imgLeft = s.image_side === "left";
  const textBlock = `<div>
${s.chip ? `<span class="chip">${s.chip}</span>` : ""}
<h2 style="margin-top:12px;margin-bottom:16px">${s.headline}</h2>
<p class="lead">${s.body}</p>
${s.cta ? `<a href="contact.html" class="btn btn-p" style="margin-top:28px">${s.cta}</a>` : ""}
</div>`;
  const imgBlock = `<div style="background:linear-gradient(135deg,rgba(var(--p-rgb),.12) 0%,rgba(var(--p-rgb),.25) 100%);border-radius:var(--r-lg);min-height:360px;display:flex;align-items:center;justify-content:center;font-size:5rem">✨</div>`;
  return `<section class="s">
<div class="c">
<div style="display:grid;grid-template-columns:1fr 1fr;gap:64px;align-items:center">
${imgLeft ? `${imgBlock}${textBlock}` : `${textBlock}${imgBlock}`}
</div>
</div>
</section>`;
}

function renderSection(s: SectionData, heroUrl?: string): string {
  switch (s.type) {
    case "hero":          return _sHero(s, heroUrl);
    case "stats":         return _sStats(s);
    case "features":      return _sFeatures(s);
    case "steps":         return _sSteps(s);
    case "testimonials":  return _sTestimonials(s);
    case "cta":           return _sCta(s);
    case "pricing":       return _sPricing(s);
    case "faq":           return _sFaq(s);
    case "contact":       return _sContact(s);
    case "team":          return _sTeam(s);
    case "portfolio":     return _sPortfolio(s);
    case "about_hero":    return _sAboutHero(s);
    case "services":      return _sServices(s);
    case "values":        return _sValues(s);
    case "content_block": return _sContentBlock(s);
    case "image_text":    return _sImageText(s);
    default: return "";
  }
}

// ── Entry point for standalone HTML generation ───────────────────────────────

async function buildStandaloneHtml(
  pageType: string,
  content: any,
  heroImageUrl: string | undefined,
  primaryColor: string,
  siteTitle: string,
  pageList: string[],
  brief?: PageBrief,
  useAI = true,
): Promise<string> {
  const css = _css(primaryColor);
  const safeList = pageList.length > 0 ? pageList : ["home"];
  const nav = _nav(siteTitle, safeList);
  const ftr = _footer(siteTitle, safeList);
  const title = pageType === "home" ? siteTitle : `${pageType.charAt(0).toUpperCase() + pageType.slice(1)} | ${siteTitle}`;

  const sections = useAI
    ? await generatePageSections(pageType, brief ?? {}, content)
    : fallbackSections(pageType, content);

  const body = sections.map(s => renderSection(s, pageType === "home" ? heroImageUrl : undefined)).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>
${nav}
<main>${body}</main>
${ftr}
<script>
function toggleFaq(i){const a=document.getElementById('faq-'+i);a&&a.parentElement.classList.toggle('open')}
</script>
</body>
</html>`;
}

// ── LEGACY stub — kept only so _homeBody reference in old code compiles ──────

function _homeBody(c: any, heroUrl: string | undefined, p: string): string {
  const hero = c.hero ?? {};
  const feats = (c.features ?? []) as any[];
  const hiw = c.how_it_works ?? {};
  const tests = (c.testimonials ?? []) as any[];
  const stats = (c.stats ?? []) as any[];
  const cta = c.cta_section ?? {};
  const faq = (c.faq ?? []) as any[];
  const sp = c.social_proof_bar ?? {};

  return `
<section class="hero">
${heroUrl ? `<img class="h-bg" src="${heroUrl}" alt="">` : ""}
<div class="h-ov"></div><div class="h-ov2"></div>
<div class="c"><div class="hi">
${sp.text ? `<div class="badge">✓ ${sp.text}</div>` : ""}
<h1>${hero.headline ?? "Transform Your Business Today"}</h1>
<p class="lead">${hero.subheadline ?? ""}</p>
<div class="ha">
<a href="${hero.cta_primary_url ?? "#contact"}" class="btn btn-w btn-lg">${hero.cta_primary ?? "Get Started Free"}</a>
${hero.cta_secondary ? `<a href="${hero.cta_secondary_url ?? "#"}" class="btn btn-gw btn-lg">${hero.cta_secondary}</a>` : ""}
</div>
</div></div>
</section>

${stats.length > 0 ? `<div class="sb"><div class="c"><div class="sg">
${stats.map((s: any) => `<div class="si"><div class="sn">${s.number}</div><div class="sl">${s.label}</div></div>`).join("")}
</div></div></div>` : ""}

${feats.length > 0 ? `<section class="s">
<div class="c">
<div class="tc" style="margin-bottom:56px">
<span class="chip">Why Choose Us</span>
<h2 style="margin-bottom:16px">${c.features_section_title ?? "Everything You Need"}</h2>
<p class="lead" style="max-width:560px;margin:0 auto">All the tools and support to grow your business.</p>
</div>
<div class="fg">
${feats.map((f: any) => `<div class="card"><div class="ci">${f.icon_emoji ?? "⚡"}</div><h3>${f.title}</h3><p>${f.description}</p></div>`).join("")}
</div>
</div>
</section>` : ""}

${hiw.steps?.length ? `<section class="s s-bg">
<div class="c">
<div class="tc" style="margin-bottom:56px">
<span class="chip">Process</span>
<h2>${hiw.title ?? "How It Works"}</h2>
</div>
<div class="steps">
${(hiw.steps as any[]).map((s: any, i: number) => `<div class="step">
<div class="snum">${s.number ?? String(i + 1).padStart(2, "0")}</div>
<div class="sbody"><h3>${s.title}</h3><p>${s.description}</p></div>
</div>`).join("")}
</div>
</div>
</section>` : ""}

${tests.length > 0 ? `<section class="s">
<div class="c">
<div class="tc" style="margin-bottom:56px">
<span class="chip">Client Stories</span>
<h2>What Our Clients Say</h2>
</div>
<div class="tg">
${tests.slice(0, 3).map((t: any) => `<div class="tc-card">
<div class="ts">${"★".repeat(t.rating ?? 5)}</div>
<p class="tq">"${t.quote}"</p>
<div class="ta"><div class="tav">${(t.author ?? "A").charAt(0)}</div>
<div><div class="tn">${t.author}</div><div class="tr">${t.role}${t.company ? ", " + t.company : ""}</div></div>
</div></div>`).join("")}
</div>
</div>
</section>` : ""}

${faq.length > 0 ? `<section class="s s-bg">
<div class="c">
<div class="tc" style="margin-bottom:48px">
<span class="chip">FAQ</span>
<h2>Frequently Asked Questions</h2>
</div>
<div class="faq-list">
${faq.map((q: any, i: number) => `<div class="faq-item" id="faq-${i}">
<button class="faq-q" onclick="toggleFaq(${i})"><span>${q.question}</span><span class="faq-icon">+</span></button>
<div class="faq-a"><p>${q.answer}</p></div>
</div>`).join("")}
</div>
</div>
</section>` : ""}

<section class="cta-s">
<div class="c"><div class="cta-in">
<h2>${cta.headline ?? "Ready to Get Started?"}</h2>
<p class="lead">${cta.subheadline ?? "Join thousands of satisfied customers today."}</p>
<div class="cta-btns">
<a href="${cta.cta_url ?? "#contact"}" class="btn btn-w btn-lg">${cta.cta_text ?? "Get Started Today"}</a>
${cta.secondary_cta ? `<a href="#contact" class="btn btn-gw btn-lg">${cta.secondary_cta}</a>` : ""}
</div>
</div></div>
</section>`;
}

function _aboutBody(c: any, p: string): string {
  const story = c.story ?? c.mission ?? {};
  const values = (c.values ?? c.core_values ?? []) as any[];
  const team = (c.team ?? c.team_members ?? []) as any[];
  const hero = c.hero ?? {};
  return `
<section class="hero" style="padding:96px 0 80px">
<div class="h-ov"></div>
<div class="c"><div class="hi">
<h1>${hero.headline ?? c.title ?? "About Us"}</h1>
<p class="lead">${hero.subheadline ?? c.tagline ?? ""}</p>
</div></div>
</section>

${story.content ?? story.text ?? c.intro ? `<section class="s">
<div class="c-sm">
${c.mission ? `<div style="text-align:center;margin-bottom:48px"><span class="chip">Our Mission</span><h2 style="margin-bottom:16px">${c.mission_title ?? "What Drives Us"}</h2></div>` : ""}
<p class="lead" style="text-align:center;max-width:720px;margin:0 auto">${story.content ?? story.text ?? c.intro ?? ""}</p>
</div>
</section>` : ""}

${values.length > 0 ? `<section class="s s-bg">
<div class="c">
<div class="tc" style="margin-bottom:48px"><span class="chip">Our Values</span><h2>What We Stand For</h2></div>
<div class="vg">
${values.map((v: any) => `<div class="vc"><div class="vic">${v.icon_emoji ?? "⭐"}</div><h3>${v.title ?? v.name}</h3><p>${v.description ?? ""}</p></div>`).join("")}
</div>
</div>
</section>` : ""}

${team.length > 0 ? `<section class="s">
<div class="c">
<div class="tc" style="margin-bottom:48px"><span class="chip">Our Team</span><h2>Meet the Team</h2></div>
<div class="team-grid">
${team.map((m: any) => `<div class="team-card">
<div class="team-av">${(m.name ?? "T").charAt(0)}</div>
<div class="team-name">${m.name}</div>
<div class="team-role">${m.role ?? m.title ?? ""}</div>
${m.bio ? `<p style="margin-top:12px;font-size:.875rem">${m.bio}</p>` : ""}
</div>`).join("")}
</div>
</div>
</section>` : ""}

<section class="cta-s">
<div class="c"><div class="cta-in">
<h2>${c.cta_headline ?? "Ready to Work With Us?"}</h2>
<p class="lead">${c.cta_subheadline ?? "Let's build something great together."}</p>
<div class="cta-btns"><a href="contact.html" class="btn btn-w btn-lg">Get in Touch</a></div>
</div></div>
</section>`;
}

function _servicesBody(c: any, p: string): string {
  const services = (c.services ?? c.service_list ?? c.items ?? []) as any[];
  const hero = c.hero ?? {};
  const process = (c.process ?? c.how_we_work ?? {}) as any;
  return `
<section class="hero" style="padding:96px 0 80px">
<div class="h-ov"></div>
<div class="c"><div class="hi">
<h1>${hero.headline ?? c.title ?? "Our Services"}</h1>
<p class="lead">${hero.subheadline ?? c.intro ?? "Professional solutions tailored to your needs."}</p>
</div></div>
</section>

${services.length > 0 ? `<section class="s">
<div class="c">
<div class="tc" style="margin-bottom:56px">
<span class="chip">What We Offer</span>
<h2>${c.services_title ?? "Our Services"}</h2>
<p class="lead" style="max-width:560px;margin:16px auto 0">${c.services_subtitle ?? "Everything you need to succeed."}</p>
</div>
<div class="fg">
${services.map((s: any) => `<div class="card">
<div class="ci">${s.icon_emoji ?? "⚡"}</div>
<h3>${s.title ?? s.name}</h3>
<p>${s.description ?? ""}</p>
${s.price ? `<p style="margin-top:16px;font-weight:700;color:var(--p);font-size:.9375rem">${s.price}</p>` : ""}
</div>`).join("")}
</div>
</div>
</section>` : ""}

${process.steps?.length ? `<section class="s s-bg">
<div class="c">
<div class="tc" style="margin-bottom:48px"><span class="chip">How We Work</span><h2>${process.title ?? "Our Process"}</h2></div>
<div class="steps">
${(process.steps as any[]).map((s: any, i: number) => `<div class="step">
<div class="snum">${s.number ?? String(i + 1).padStart(2, "0")}</div>
<div class="sbody"><h3>${s.title}</h3><p>${s.description}</p></div>
</div>`).join("")}
</div>
</div>
</section>` : ""}

<section class="cta-s">
<div class="c"><div class="cta-in">
<h2>${c.cta_headline ?? "Ready to Get Started?"}</h2>
<p class="lead">${c.cta_subheadline ?? "Let's discuss your project today."}</p>
<div class="cta-btns"><a href="contact.html" class="btn btn-w btn-lg">Contact Us</a></div>
</div></div>
</section>`;
}

function _pricingBody(c: any, p: string): string {
  const tiers = (c.tiers ?? c.plans ?? c.pricing_tiers ?? []) as any[];
  const faq = (c.faq ?? []) as any[];
  const hero = c.hero ?? {};
  return `
<section class="hero" style="padding:80px 0 64px">
<div class="h-ov"></div>
<div class="c"><div class="hi">
<h1>${hero.headline ?? c.title ?? "Simple, Transparent Pricing"}</h1>
<p class="lead">${hero.subheadline ?? c.intro ?? "No hidden fees. No surprises."}</p>
</div></div>
</section>

<section class="s">
<div class="c">
${tiers.length > 0 ? `<div class="pg">
${tiers.map((t: any, i: number) => `<div class="pc${t.highlighted || t.featured || i === 1 ? " feat" : ""}">
${t.highlighted || t.featured || i === 1 ? `<div class="pbadge">${t.badge ?? "Most Popular"}</div>` : ""}
<div class="pname">${t.name}</div>
<div class="pprice">${t.price ?? "$0"}<span class="pper">${t.period ? " / " + t.period : ""}</span></div>
<p class="pdesc">${t.description ?? ""}</p>
<hr class="pdiv">
<ul class="pfeats">
${(t.features ?? t.includes ?? []).map((f: string) => `<li>${f}</li>`).join("")}
</ul>
<a href="contact.html" class="btn ${t.highlighted || t.featured || i === 1 ? "btn-p" : "btn-o"} btn-full">${t.cta ?? "Get Started"}</a>
</div>`).join("")}
</div>` : `<div class="tc"><p class="lead">Contact us for pricing tailored to your needs.</p><a href="contact.html" class="btn btn-p btn-lg" style="margin-top:32px">Get a Quote</a></div>`}
</div>
</section>

${faq.length > 0 ? `<section class="s s-bg">
<div class="c">
<div class="tc" style="margin-bottom:48px"><span class="chip">FAQ</span><h2>Pricing Questions</h2></div>
<div class="faq-list">
${faq.map((q: any, i: number) => `<div class="faq-item" id="faq-${i}">
<button class="faq-q" onclick="toggleFaq(${i})"><span>${q.question}</span><span class="faq-icon">+</span></button>
<div class="faq-a"><p>${q.answer}</p></div>
</div>`).join("")}
</div>
</div>
</section>` : ""}

<section class="cta-s">
<div class="c"><div class="cta-in">
<h2>Ready to Get Started?</h2>
<p class="lead">Choose a plan and start building today.</p>
<div class="cta-btns"><a href="contact.html" class="btn btn-w btn-lg">Contact Sales</a></div>
</div></div>
</section>`;
}

function _contactBody(c: any, p: string): string {
  const info = c.contact_info ?? c.info ?? {};
  const hero = c.hero ?? {};
  return `
<section class="hero" style="padding:80px 0 64px">
<div class="h-ov"></div>
<div class="c"><div class="hi">
<h1>${hero.headline ?? c.title ?? "Get In Touch"}</h1>
<p class="lead">${hero.subheadline ?? c.intro ?? "We'd love to hear from you."}</p>
</div></div>
</section>

<section class="s">
<div class="c">
<div class="cg">
<div>
<h3 style="margin-bottom:8px">Send Us a Message</h3>
<p style="margin-bottom:32px">Fill out the form below and we'll get back to you within 24 hours.</p>
<form onsubmit="event.preventDefault();this.innerHTML='<p style=\\'color:var(--p);font-weight:600;padding:20px 0\\'>Thank you! We\\'ll be in touch soon.</p>'">
<div class="fg-grp"><label>Full Name</label><input class="fctrl" type="text" placeholder="John Smith" required></div>
<div class="fg-grp"><label>Email Address</label><input class="fctrl" type="email" placeholder="john@example.com" required></div>
<div class="fg-grp"><label>Phone (Optional)</label><input class="fctrl" type="tel" placeholder="+1 (555) 000-0000"></div>
<div class="fg-grp"><label>Message</label><textarea class="fctrl" placeholder="How can we help you?" required></textarea></div>
<button type="submit" class="btn btn-p btn-full btn-lg">Send Message</button>
</form>
</div>
<div class="cd">
<h3>${c.contact_section_title ?? "Contact Information"}</h3>
<p class="lead">${c.contact_intro ?? "Reach out through any of these channels."}</p>
${info.phone ?? c.phone ? `<div class="cdet"><div class="cico">📞</div><div><div class="clbl">Phone</div><div class="cval">${info.phone ?? c.phone}</div></div></div>` : ""}
${info.email ?? c.email ? `<div class="cdet"><div class="cico">✉️</div><div><div class="clbl">Email</div><div class="cval">${info.email ?? c.email}</div></div></div>` : ""}
${info.address ?? c.address ?? c.location ? `<div class="cdet"><div class="cico">📍</div><div><div class="clbl">Address</div><div class="cval">${info.address ?? c.address ?? c.location}</div></div></div>` : ""}
${info.hours ?? c.hours ? `<div class="cdet"><div class="cico">🕐</div><div><div class="clbl">Business Hours</div><div class="cval">${info.hours ?? c.hours}</div></div></div>` : ""}
</div>
</div>
</div>
</section>`;
}

function _portfolioBody(c: any, p: string): string {
  const items = (c.projects ?? c.works ?? c.portfolio_items ?? c.items ?? []) as any[];
  const hero = c.hero ?? {};
  return `
<section class="hero" style="padding:96px 0 80px">
<div class="h-ov"></div>
<div class="c"><div class="hi">
<h1>${hero.headline ?? c.title ?? "Our Work"}</h1>
<p class="lead">${hero.subheadline ?? c.intro ?? "A selection of our finest projects."}</p>
</div></div>
</section>

<section class="s">
<div class="c">
<div class="port-grid">
${items.length > 0 ? items.map((item: any) => `<div class="port-card">
<div class="port-img">${item.icon_emoji ?? "🖼️"}</div>
<div class="port-body">
<h3>${item.title ?? item.name}</h3>
<p>${item.description ?? item.summary ?? ""}</p>
${(item.tags ?? item.technologies ?? []).length > 0 ? `<div class="port-tags">${(item.tags ?? item.technologies ?? []).map((t: string) => `<span class="port-tag">${t}</span>`).join("")}</div>` : ""}
</div></div>`).join("") : `
<div class="card"><div class="ci">🏆</div><h3>Award-Winning Project</h3><p>Delivered exceptional results for our client.</p></div>
<div class="card"><div class="ci">🚀</div><h3>Innovative Solution</h3><p>Cutting-edge design that drives real business growth.</p></div>
<div class="card"><div class="ci">💡</div><h3>Creative Campaign</h3><p>Strategy and execution that exceeded expectations.</p></div>`}
</div>
</div>
</section>

<section class="cta-s">
<div class="c"><div class="cta-in">
<h2>Let's Create Something Amazing</h2>
<p class="lead">Ready to start your project? We'd love to help.</p>
<div class="cta-btns"><a href="contact.html" class="btn btn-w btn-lg">Start Your Project</a></div>
</div></div>
</section>`;
}

function _genericBody(c: any, p: string, pageType: string): string {
  const title = c.title ?? c.hero_headline ?? pageType.charAt(0).toUpperCase() + pageType.slice(1);
  const body = c.body ?? c.intro ?? c.content ?? c.description ?? "";
  const paras = body.split(/\n\n+/).map((s: string) => s.trim()).filter(Boolean);
  const sections = (c.sections ?? []) as any[];
  return `
<section class="hero" style="padding:96px 0 80px">
<div class="h-ov"></div>
<div class="c"><div class="hi">
<h1>${title}</h1>
${c.subtitle ?? c.tagline ? `<p class="lead">${c.subtitle ?? c.tagline}</p>` : ""}
</div></div>
</section>

${paras.length > 0 || sections.length > 0 ? `<section class="s">
<div class="c-sm">
${paras.map((par: string) => `<p style="margin-bottom:24px;font-size:1.0625rem;line-height:1.8">${par}</p>`).join("")}
${sections.map((sec: any) => `<div style="margin-top:48px"><h2 style="margin-bottom:16px">${sec.title ?? ""}</h2><p>${sec.content ?? sec.description ?? ""}</p></div>`).join("")}
</div>
</section>` : ""}

<section class="cta-s">
<div class="c"><div class="cta-in">
<h2>Ready to Get Started?</h2>
<p class="lead">Contact us today to learn more.</p>
<div class="cta-btns"><a href="contact.html" class="btn btn-w btn-lg">Contact Us</a></div>
</div></div>
</section>`;
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
        const { page_type, page_content, primary_color, hero_image_url, site_title, page_list, business_type, style } = body;
        const html = await buildStandaloneHtml(
          page_type,
          page_content ?? {},
          hero_image_url,
          primary_color ?? "#1a56db",
          site_title ?? "Website",
          page_list ?? [page_type],
          { business_name: site_title, business_type, style },
          true,
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

          // Build WP Gutenberg HTML for publishing; build standalone HTML for download/storage
          const wpHtml = buildGutenbergPage(
            pageType,
            pageContent ?? siteContent.pages?.home ?? {},
            pageType === "home" ? heroImageUrl : undefined,
            primaryColor,
          );
          const standaloneHtml = await buildStandaloneHtml(
            pageType,
            pageContent ?? siteContent.pages?.home ?? {},
            pageType === "home" ? heroImageUrl : undefined,
            primaryColor,
            body.business_name ?? siteContent.site?.title ?? "Website",
            pages as string[],
            { business_name: body.business_name, business_type: body.business_type, style: body.style },
            false,
          );
          generatedHtmls[pageType] = standaloneHtml;

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
                  page_content: wpHtml.slice(0, 500),
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
                content: wpHtml,
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
