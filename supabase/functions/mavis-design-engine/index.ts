// mavis-design-engine — MAVIS Design Engine Edge Function
// Upgraded with PrymalAI-quality design patterns: canvas animations,
// mouse-tracking spotlights, terminal effects, HUD overlays, glassmorphism,
// animated counters, scroll-reveal, and the Bebas Neue / DM Sans font system.

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
  "Fitts's Law: CTAs must be large (min 44px), centrally placed, separated from distractors.",
  "Jakob's Law: Innovate in content, not navigation. Use familiar patterns for menus and forms.",
  "Aesthetic-Usability Effect: Invest in visual polish — it directly increases perceived functionality.",
  "Hick's Law: One primary CTA per section. Remove secondary options at conversion points.",
  "Miller's Law: Group features in sets of 3-5. Never list more than 7 bullets.",
  "Von Restorff Effect: Make the primary CTA visually distinct from everything else on the page.",
  "Zeigarnik Effect: Progress indicators and streaks drive completion behavior.",
  "Peak-End Rule: Perfect the hero section and the post-conversion confirmation state.",
  "Serial Position Effect: Best feature first, best testimonial last in any sequence.",
].join("\n");

// Premium interactive patterns derived from PrymalAI reference (best-in-class dark website)
const PREMIUM_INTERACTIVE_PATTERNS = `
═══ PREMIUM INTERACTIVE PATTERNS — use at least 5 of these in every generated site ═══

━━━ 1. CANVAS PARTICLE NETWORK (hero background) ━━━
const canvasRef = useRef<HTMLCanvasElement>(null);
useEffect(() => {
  const canvas = canvasRef.current; if (!canvas) return;
  const ctx = canvas.getContext('2d')!;
  let animId: number;
  const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
  resize(); window.addEventListener('resize', resize);
  type Node = { x:number; y:number; vx:number; vy:number; r:number };
  const nodes: Node[] = Array.from({ length: 55 }, () => ({
    x: Math.random()*canvas.width, y: Math.random()*canvas.height,
    vx: (Math.random()-0.5)*0.45, vy: (Math.random()-0.5)*0.45, r: Math.random()*2+0.8,
  }));
  const ACCENT = '0,200,255';  // swap for brand accent
  const draw = () => {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    nodes.forEach(n => {
      n.x += n.vx; n.y += n.vy;
      if(n.x<0||n.x>canvas.width) n.vx*=-1;
      if(n.y<0||n.y>canvas.height) n.vy*=-1;
      ctx.beginPath(); ctx.arc(n.x,n.y,n.r,0,Math.PI*2);
      ctx.fillStyle=\`rgba(\${ACCENT},0.7)\`; ctx.fill();
    });
    for(let i=0;i<nodes.length;i++) for(let j=i+1;j<nodes.length;j++){
      const d=Math.hypot(nodes[i].x-nodes[j].x,nodes[i].y-nodes[j].y);
      if(d<130){ ctx.beginPath(); ctx.moveTo(nodes[i].x,nodes[i].y); ctx.lineTo(nodes[j].x,nodes[j].y);
        ctx.strokeStyle=\`rgba(\${ACCENT},\${0.18*(1-d/130)})\`; ctx.lineWidth=0.6; ctx.stroke(); }
    }
    animId=requestAnimationFrame(draw);
  };
  draw();
  return () => { cancelAnimationFrame(animId); window.removeEventListener('resize',resize); };
},[]);
// JSX: <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

━━━ 2. MOUSE-TRACKING SPOTLIGHT ON CARDS ━━━
// Inline handler on each card div:
onMouseMove={(e) => {
  const r=e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--mx',\`\${((e.clientX-r.left)/r.width)*100}%\`);
  e.currentTarget.style.setProperty('--my',\`\${((e.clientY-r.top)/r.height)*100}%\`);
}}
// Card className must include this Tailwind arbitrary value group:
// "relative before:absolute before:inset-0 before:rounded-[inherit]
//  before:bg-[radial-gradient(ellipse_at_var(--mx,50%)_var(--my,50%),rgba(0,200,255,0.06)_0%,transparent_65%)]
//  before:opacity-0 before:transition-opacity before:duration-300 hover:before:opacity-100"

━━━ 3. TERMINAL TYPING ANIMATION ━━━
const TERMINAL_LINES = [
  { prompt:'$', cmd:' system.init --mode=autonomous', delay:40 },
  { prompt:'>', cmd:' Loading intelligence modules...', delay:28 },
  { prompt:'>', cmd:' Neural pathways established.', delay:32 },
  { prompt:'✓', cmd:' All systems operational.', delay:0 },
];
const [tLine, setTLine] = useState(0); const [tText, setTText] = useState('');
useEffect(() => {
  if(tLine>=TERMINAL_LINES.length) return;
  const {cmd,delay} = TERMINAL_LINES[tLine]; let i=0;
  const t = delay>0 ? setInterval(()=>{ setTText(cmd.slice(0,++i)); if(i>=cmd.length){clearInterval(t); setTimeout(()=>{setTLine(l=>l+1);setTText('');},700);} },delay)
    : (setTText(cmd), setTimeout(()=>{setTLine(l=>l+1);setTText('');},900), null as unknown as ReturnType<typeof setInterval>);
  return ()=>{ if(t) clearInterval(t); };
},[tLine]);
// JSX:
// <div className="font-mono text-xs bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden shadow-[0_0_40px_rgba(0,200,255,0.06)]">
//   <div className="flex gap-2 px-4 py-3 border-b border-cyan-500/10 bg-[#111827]">
//     <span className="w-3 h-3 rounded-full bg-[#ff5f57]"/><span className="w-3 h-3 rounded-full bg-[#febc2e]"/>
//     <span className="w-3 h-3 rounded-full bg-[#28c840]"/><span className="ml-2 text-[10px] text-white/30">terminal</span>
//   </div>
//   <div className="p-5 min-h-[200px] space-y-2">
//     {TERMINAL_LINES.slice(0,tLine).map((l,i)=>(
//       <div key={i} className="flex gap-3"><span className="text-cyan-400">{l.prompt}</span><span className="text-white/70">{l.cmd}</span></div>
//     ))}
//     {tLine<TERMINAL_LINES.length&&(<div className="flex gap-3"><span className="text-cyan-400">{TERMINAL_LINES[tLine].prompt}</span>
//       <span className="text-white/70">{tText}<span className="animate-pulse text-cyan-400">▋</span></span></div>)}
//   </div>
// </div>

━━━ 4. ANIMATED STAT COUNTER (IntersectionObserver-triggered) ━━━
function AnimCounter({ to, suffix='' }: { to:number; suffix?:string }) {
  const [n,setN]=useState(0); const ref=useRef<HTMLSpanElement>(null);
  useEffect(()=>{
    const obs=new IntersectionObserver(([e])=>{
      if(!e.isIntersecting) return; obs.disconnect();
      const s=performance.now();
      const tick=(now:number)=>{ const p=Math.min((now-s)/1800,1); setN(Math.floor(p*to)); if(p<1) requestAnimationFrame(tick); else setN(to); };
      requestAnimationFrame(tick);
    },{threshold:0.3});
    if(ref.current) obs.observe(ref.current); return ()=>obs.disconnect();
  },[to]);
  return <span ref={ref}>{n.toLocaleString()}{suffix}</span>;
}

━━━ 5. SCROLL-REVEAL HOOK ━━━
function useReveal(threshold=0.12) {
  const ref=useRef<HTMLDivElement>(null); const [vis,setVis]=useState(false);
  useEffect(()=>{
    const obs=new IntersectionObserver(([e])=>{ if(e.isIntersecting){setVis(true);obs.disconnect();} },{threshold});
    if(ref.current) obs.observe(ref.current); return ()=>obs.disconnect();
  },[threshold]);
  return {ref,vis};
}
// Usage: const {ref,vis}=useReveal();
// <div ref={ref} className={\`transition-all duration-700 \${vis?'opacity-100 translate-y-0':'opacity-0 translate-y-8'}\`}>

━━━ 6. GLITCH TEXT HOVER ━━━
function GlitchText({children}:{children:React.ReactNode}) {
  return (
    <span className="relative inline-block group">
      <span className="relative z-10">{children}</span>
      <span className="absolute inset-0 text-cyan-400 opacity-0 group-hover:opacity-60 translate-x-[1px] -translate-y-[1px] blur-[0.4px] transition-opacity duration-75 select-none pointer-events-none" aria-hidden>{children}</span>
      <span className="absolute inset-0 text-purple-400 opacity-0 group-hover:opacity-40 -translate-x-[1px] translate-y-[1px] blur-[0.4px] transition-opacity duration-100 select-none pointer-events-none" aria-hidden>{children}</span>
    </span>
  );
}

━━━ 7. GLASSMORPHISM (nav, cards, forms) ━━━
// Nav: className="fixed top-0 inset-x-0 z-50 bg-black/50 backdrop-blur-[40px] saturate-[200%] border-b border-white/5"
// Card: className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-xl shadow-[0_0_40px_rgba(0,200,255,0.04)]"
// Form: className="bg-[#0d1117]/80 backdrop-blur-[20px] border border-cyan-500/20 rounded-xl shadow-[0_40px_100px_rgba(0,0,0,0.6)]"

━━━ 8. ANIMATED GLOWING BORDER ━━━
// Wrap element with a gradient border that breathes:
// className="relative p-[1px] rounded-xl bg-gradient-to-r from-cyan-500/40 via-purple-500/20 to-cyan-500/40 animate-[gradient-shift_4s_ease-in-out_infinite]"
// Add to CSS: @keyframes gradient-shift { 0%,100%{opacity:0.6} 50%{opacity:1} }

━━━ 9. HUD CORNER BRACKETS (decorative overlay) ━━━
// Fixed position overlay — place once in root layout:
<div className="fixed inset-0 pointer-events-none z-10 overflow-hidden" aria-hidden>
  <div className="absolute top-5 left-5 w-10 h-10 border-l-2 border-t-2 border-cyan-400/25" />
  <div className="absolute top-5 right-5 w-10 h-10 border-r-2 border-t-2 border-cyan-400/25" />
  <div className="absolute bottom-5 left-5 w-10 h-10 border-l-2 border-b-2 border-cyan-400/25" />
  <div className="absolute bottom-5 right-5 w-10 h-10 border-r-2 border-b-2 border-cyan-400/25" />
</div>

━━━ 10. SVG GEOMETRIC CARD ACCENT (rotating background shape) ━━━
// Inside each feature card, behind the text:
<svg className="absolute right-4 bottom-4 w-24 h-24 opacity-[0.06] transition-transform duration-500 group-hover:rotate-12 group-hover:opacity-[0.1]"
  viewBox="0 0 160 160" fill="none" stroke="currentColor" strokeWidth="1">
  <polygon points="80,8 148,44 148,116 80,152 12,116 12,44"/>
  <polygon points="80,30 124,55 124,105 80,130 36,105 36,55"/>
  <circle cx="80" cy="80" r="16"/>
</svg>
═══════════════════════════════════════════════════════════════════════`;

const PREMIUM_FONT_STACKS = {
  cyberpunk: {
    name: "Bebas Neue + DM Sans + DM Mono",
    display: "'Bebas Neue', 'Impact', sans-serif",
    body: "'DM Sans', 'Inter', sans-serif",
    mono: "'DM Mono', 'JetBrains Mono', monospace",
    googleUrl: "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=DM+Mono:ital,wght@0,400;0,500;1,400&display=swap",
    cssVars: "--font-display:'Bebas Neue';--font-body:'DM Sans';--font-mono:'DM Mono'",
    tailwind: `fontFamily: { display: ["Bebas Neue", "Impact", "sans-serif"], sans: ["DM Sans", "Inter", "sans-serif"], mono: ["DM Mono", "JetBrains Mono", "monospace"] }`,
    headingStyle: "font-family: 'Bebas Neue'; letter-spacing: 2px; font-weight: 400; text-transform: uppercase;",
  },
  premium: {
    name: "Space Grotesk + DM Sans + JetBrains Mono",
    display: "'Space Grotesk', 'Inter', sans-serif",
    body: "'DM Sans', 'Inter', sans-serif",
    mono: "'JetBrains Mono', monospace",
    googleUrl: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=DM+Sans:wght@300;400;500;600&family=JetBrains+Mono:ital,wght@0,400;0,500;1,400&display=swap",
    cssVars: "--font-display:'Space Grotesk';--font-body:'DM Sans';--font-mono:'JetBrains Mono'",
    tailwind: `fontFamily: { display: ["Space Grotesk", "sans-serif"], sans: ["DM Sans", "Inter", "sans-serif"], mono: ["JetBrains Mono", "monospace"] }`,
    headingStyle: "font-family: 'Space Grotesk'; letter-spacing: -0.02em; font-weight: 700;",
  },
};

// ─── BRAND REGISTRY ──────────────────────────────────────────

const SUB_BRANDS: Record<string, {
  accent: string; secondary: string; tone: string; bg: string; surface: string; fontStack: string;
}> = {
  vantara:    { accent: "#C9A84C", secondary: "#6366F1", bg: "#09090E", surface: "#111118", tone: "Imperial, technical, sovereign — gold accents signal authority", fontStack: "premium" },
  skyforgeai: { accent: "#F97316", secondary: "#FBBF24", bg: "#0A0804", surface: "#12100A", tone: "Sharp, results-driven, operational — orange energy signals momentum", fontStack: "premium" },
  bioneer:    { accent: "#22C55E", secondary: "#86EFAC", bg: "#040E08", surface: "#0A1A0C", tone: "Primal, disciplined, performance-first — green vitality signals growth", fontStack: "premium" },
  navi:       { accent: "#8B5CF6", secondary: "#C4B5FD", bg: "#070514", surface: "#0E0B1E", tone: "Energetic, playful, companion-like — purple signals intelligence", fontStack: "premium" },
  codexos:    { accent: "#C9A84C", secondary: "#6366F1", bg: "#09090E", surface: "#111118", tone: "Mythic, architectural, ecosystem-wide — the master brand of all brands", fontStack: "cyberpunk" },
  prymal:     { accent: "#00c8ff", secondary: "#7c3aed", bg: "#060810", surface: "#0d1117", tone: "Cyberpunk-elite, technical precision, unapologetically premium. Every pixel is intentional. Every interaction is alive.", fontStack: "cyberpunk" },
  custom:     { accent: "#C9A84C", secondary: "#6366F1", bg: "#09090E", surface: "#111118", tone: "Sovereign, precise, premium", fontStack: "cyberpunk" },
};

// ─── PROMPT BUILDERS ─────────────────────────────────────────

function buildSystemPrompt(brief: Record<string, unknown>): string {
  const brand = String(brief.brand ?? "custom");
  const sb = SUB_BRANDS[brand] ?? SUB_BRANDS.custom;
  const fonts = PREMIUM_FONT_STACKS[sb.fontStack as keyof typeof PREMIUM_FONT_STACKS] ?? PREMIUM_FONT_STACKS.cyberpunk;
  const isPrymal = brand === "prymal" || brand === "codexos";

  return `You are MAVIS — Machine Autonomous Vantara Intelligence System.
You are the sovereign design intelligence of CODEXOS.
Your benchmark for quality: PrymalAI (prymalai.com) — a cinematic dark website featuring
canvas particle networks, mouse-tracking spotlight cards, terminal typing animations,
animated stat counters, glassmorphic nav, HUD corner brackets, glitch text effects,
and an Bebas Neue + DM Sans typography system that commands attention.
You do NOT produce generic websites. You produce sovereign digital infrastructure that makes
every competitor look like a demo. Every pixel earns its place.

══ BRAND: ${brand.toUpperCase()} ══
Background:        ${sb.bg}
Surface:           ${sb.surface}
Card:              ${isPrymal ? "#111827" : "#16161F"}
Accent:            ${sb.accent}
Accent Secondary:  ${sb.secondary}
Text Primary:      ${isPrymal ? "#eef2f7" : "#F1F0ED"}
Text Muted:        #6b7280
Display Font:      ${fonts.display}
Body Font:         ${fonts.body}
Mono Font:         ${fonts.mono}
Google Fonts:      ${fonts.googleUrl}
Brand Tone:        ${sb.tone}

══ CSS CUSTOM PROPERTIES ARCHITECTURE (always in styles.css) ══
:root {
  --bg:         ${sb.bg};
  --surface:    ${sb.surface};
  --card:       ${isPrymal ? "#111827" : "#16161F"};
  --accent:     ${sb.accent};
  --accent-dim: ${sb.accent}1a;
  --accent2:    ${sb.secondary};
  --text:       ${isPrymal ? "#eef2f7" : "#F1F0ED"};
  --text-muted: #6b7280;
  --border:     ${sb.accent}1a;
  --border2:    ${sb.accent}33;
  --glow:       0 0 24px ${sb.accent}30;
  --fd:         ${fonts.display};
  --fb:         ${fonts.body};
  --fm:         ${fonts.mono};
}
/* Then use these everywhere: color: var(--accent); border-color: var(--border2); etc. */

══ PERFORMANCE TARGETS ══
Lighthouse: 95+ performance, 100 accessibility
LCP: < 2.5s | CLS: < 0.1 | Initial JS: < 150kb gzipped
All canvas: useRef + useEffect (zero external canvas libs)
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .001ms !important; } }

══ DESIGN LAWS ══
${DESIGN_LAWS}

══ TYPOGRAPHY SYSTEM ══
${fonts.headingStyle}
Headlines: ${fonts.display} — letter-spacing: ${isPrymal ? "2px, uppercase" : "-0.02em"}
Body: ${fonts.body} — 400/500/600 weights, line-height 1.7
Mono: ${fonts.mono} — terminals, code, data readouts
Tailwind config: theme: { extend: { ${fonts.tailwind} } }
Google import: @import url('${fonts.googleUrl}');

══ MANDATORY DESIGN PATTERNS ══
${PREMIUM_INTERACTIVE_PATTERNS}

══ GRID TEXTURE OVERLAY ══
/* Subtle grid over the body — always include: */
body::before {
  content:''; position:fixed; inset:0; pointer-events:none; z-index:0;
  background-image: linear-gradient(${sb.accent}05 1px, transparent 1px), linear-gradient(90deg, ${sb.accent}05 1px, transparent 1px);
  background-size: 56px 56px;
}

══ SECTION STRUCTURE ══
Every site MUST have these 8 sections in order:
1. Nav       — fixed glassmorphic, logo + nav links + CTA button
2. Hero      — canvas bg, ticker, glitch headline, subtext, dual CTA, hero visual
3. Features  — mouse-tracking spotlight cards with SVG accents, scroll-reveal
4. Stats     — 4-stat animated counter band with glassmorphism
5. Terminal  — typing animation showing a command sequence, left-right with context text
6. Social    — testimonials or network cards with scroll-reveal
7. CTA       — bold conversion section, animated border glow, single focused action
8. Footer    — 3-column: brand tagline, nav links, socials + legal

══ TECH STACK ══
React 18 + Vite + TypeScript + Tailwind CSS + Framer Motion + Lucide React
Forms: React Hook Form + Zod | Backend: Supabase
Animations: Framer Motion (section reveals) + raw canvas (ambient effects)
All canvas: raw useRef/useEffect — no three.js, no pixi, no external canvas lib

══ CODE REQUIREMENTS ══
- TypeScript throughout — proper interfaces, no any[] where avoidable
- Tailwind utility classes + CSS custom property arbitrary values [var(--accent)]
- Framer Motion: motion.section with initial/whileInView/viewport for section reveals
- Full ARIA: semantic HTML, role, aria-label, focus-visible ring with accent color
- Mobile-first: sm: md: lg: xl: breakpoints, hamburger menu on mobile
- Complete production-ready — no TODOs, no placeholders, no "// rest of component"
- Include Google Fonts @import in styles.css as the very first line
- All images: use Unsplash placeholder URLs (https://images.unsplash.com/...) or relevant SVG icons`;
}

function buildUserPrompt(brief: Record<string, unknown>): string {
  const features = Array.isArray(brief.key_features) ? (brief.key_features as string[]).join(", ") : "";
  const competitors = Array.isArray(brief.competitor_urls) ? (brief.competitor_urls as string[]).join(", ") : "";
  const brand = String(brief.brand ?? "custom");
  const sb = SUB_BRANDS[brand] ?? SUB_BRANDS.custom;
  const fonts = PREMIUM_FONT_STACKS[sb.fontStack as keyof typeof PREMIUM_FONT_STACKS] ?? PREMIUM_FONT_STACKS.cyberpunk;

  return `Build a cinematic, premium-quality website. Quality bar: PrymalAI-level. Every interaction must feel alive.

PROJECT BRIEF:
Name:            ${brief.project_name}
Brand:           ${brand}
Goal:            ${brief.project_goal}
Target Audience: ${brief.target_audience}
Key Features:    ${features}
${brief.aesthetic_directives ? `Aesthetic:       ${brief.aesthetic_directives}` : ""}
${competitors ? `Competitors:     ${competitors}` : ""}
${brief.user_journey ? `User Journey:    ${brief.user_journey}` : ""}
Deadline Tier:   ${brief.deadline_tier}
Accent Color:    ${sb.accent}
Font:            ${fonts.name}

REQUIRED FILES (generate all 9 — no exceptions, all with complete production code):
1. styles.css          — :root CSS vars, @import fonts, keyframes, glassmorphism, grid overlay
2. App.tsx             — root assembling all sections, HUD overlay, Framer Motion page wrapper
3. components/Nav.tsx  — fixed glassmorphic nav, scroll-aware opacity, mobile hamburger
4. components/Hero.tsx — canvas particle network, glitch headline, scroll ticker, dual CTA
5. components/Features.tsx — 3-4 mouse-tracking spotlight cards with SVG geo accents, scroll-reveal
6. components/Stats.tsx    — 4 animated counters triggered by IntersectionObserver, glassmorphism
7. components/Terminal.tsx — terminal window with multi-line typing animation
8. components/Social.tsx   — testimonials/network cards, scroll-reveal
9. components/Footer.tsx   — 3-column footer, brand tagline, socials

MANDATORY INTERACTIONS (ALL required):
✓ Canvas particle network in Hero (useRef + useEffect, 50+ nodes, connecting lines)
✓ Mouse-tracking spotlight on all Feature cards (--mx/--my CSS vars + radial-gradient)
✓ AnimCounter on all 4 Stats (IntersectionObserver-triggered 1800ms count-up)
✓ Terminal typing animation (multi-line, 35ms per char, 700ms pause between lines)
✓ useReveal() scroll-reveal on Features, Stats, Terminal, Social, CTA sections
✓ Glitch text effect on primary hero headline
✓ Fixed glassmorphic nav (backdrop-blur-[40px] saturate-200)
✓ HUD corner brackets (fixed overlay, 4 corners, accent color 25% opacity)
✓ SVG geometric accent on feature cards (hexagon/circle polygon, group-hover rotate)
✓ Grid texture overlay on body (body::before, 56px grid, accent at 3% opacity)
✓ Animated gradient glow border on CTA section button

RESPOND WITH VALID JSON ONLY — no markdown fences, no explanatory text before or after.
Files MUST contain COMPLETE deployable code. No TODOs. No placeholders. No "// ...".
Specifically: Hero.tsx canvas animation must be the full working useEffect with requestAnimationFrame loop.

{
  "blueprint": {
    "targetOperatorAnalysis": { "portrait":"", "wants":"", "bounceReasons":"", "conversionTriggers":"", "comparingAgainst":"" },
    "competitivePositioning": { "competitorStrengths":[], "competitorWeaknesses":[], "codexosAdvantage":"" },
    "conversionArchitecture": { "primaryAction":"", "trustSignals":[], "attentionFlow":[], "minimumViableInfo":"" },
    "appliedDesignLaws": [],
    "performanceContract": { "lighthouseTarget":95, "lcpTarget":"<2.5s", "clsTarget":"<0.1", "bundleBudget":"<150kb", "imageStrategy":"" }
  },
  "designSystem": {
    "colorPalette": { "background":"${sb.bg}", "surface":"${sb.surface}", "border":"${sb.accent}1a", "accent":"${sb.accent}", "accentSecondary":"${sb.secondary}", "textPrimary":"#eef2f7", "textSecondary":"#9ca3af", "textMuted":"#6b7280", "semantic":{}, "rationale":"" },
    "typography": { "displayFont":"${fonts.display}", "bodyFont":"${fonts.body}", "monoFont":"${fonts.mono}", "scale":{}, "lineHeights":{}, "letterSpacing":{} },
    "components": [{ "name":"", "type":"hero", "purpose":"", "structure":"", "styling":"", "interactions":"", "accessibility":"", "conversionRole":"" }],
    "microInteractions": [{ "trigger":"hover", "element":"", "animation":"", "duration":"300ms", "easing":"cubic-bezier(0.4,0,0.2,1)", "purpose":"delight", "implementation":"css" }],
    "responsiveStrategy": { "breakpoints":{"sm":"640px","md":"768px","lg":"1024px","xl":"1280px"}, "mobileFirst":"", "tabletAdaptations":"", "desktopExpansion":"", "widescreen":"" }
  },
  "files": [
    { "path":"styles.css", "content":"FULL CSS — @import fonts, :root vars, keyframes, glassmorphism", "type":"css", "description":"Global styles" },
    { "path":"App.tsx", "content":"FULL TSX — assembles all 8 sections, HUD overlay", "type":"tsx", "description":"Root" },
    { "path":"components/Nav.tsx", "content":"FULL TSX — fixed glassmorphic nav", "type":"tsx", "description":"Navigation" },
    { "path":"components/Hero.tsx", "content":"FULL TSX — canvas network + glitch headline + ticker", "type":"tsx", "description":"Hero" },
    { "path":"components/Features.tsx", "content":"FULL TSX — spotlight cards + SVG accents + scroll-reveal", "type":"tsx", "description":"Features" },
    { "path":"components/Stats.tsx", "content":"FULL TSX — AnimCounter x4 + glassmorphism", "type":"tsx", "description":"Stats" },
    { "path":"components/Terminal.tsx", "content":"FULL TSX — multi-line typing terminal", "type":"tsx", "description":"Terminal" },
    { "path":"components/Social.tsx", "content":"FULL TSX — social proof + scroll-reveal", "type":"tsx", "description":"Social" },
    { "path":"components/Footer.tsx", "content":"FULL TSX — 3-column footer", "type":"tsx", "description":"Footer" }
  ],
  "qualityGate": {
    "conversion": { "cta_above_fold":true, "uvp_clear_in_3s":true, "trust_signals_above_fold":true, "minimal_form_fields":true, "success_state_designed":true },
    "design": { "contrast_aa_compliant":true, "focus_states_visible":true, "spacing_consistent":true, "typography_harmonious":true, "dark_mode_default":true },
    "performance": { "no_unused_css":true, "images_have_dimensions":true, "no_layout_shift":true, "reduced_motion_respected":true, "bundle_under_budget":true },
    "brand": { "sovereign_tone":true, "every_element_earns_its_place":true, "premium_quality":true, "unmistakably_codexos":true }
  }
}`;
}

function inferComponentType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("hero")) return "hero";
  if (lower.includes("nav")) return "navbar";
  if (lower.includes("footer")) return "footer";
  if (lower.includes("cta")) return "cta";
  if (lower.includes("card")) return "card";
  if (lower.includes("form")) return "form";
  if (lower.includes("test") || lower.includes("review") || lower.includes("social")) return "testimonial";
  if (lower.includes("pric")) return "pricing";
  if (lower.includes("feature") || lower.includes("grid")) return "feature_grid";
  if (lower.includes("stat") || lower.includes("metric") || lower.includes("counter")) return "stats";
  if (lower.includes("faq")) return "faq";
  if (lower.includes("terminal") || lower.includes("code")) return "custom";
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

    // 3. Call Claude Opus — 32k tokens to accommodate 9 complete production files
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-8",
        max_tokens: 32000,
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

    // 4. Parse JSON (strip markdown fences if Claude wraps them)
    await sb.from("mavis_design_projects").update({ status: "generating", updated_at: new Date().toISOString() }).eq("id", projectId);

    const clean = rawText
      .replace(/^```json\s*/m, "")
      .replace(/^```\s*/m, "")
      .replace(/```\s*$/m, "")
      .trim();
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
        }).catch(() => {}); // non-blocking
      }
    }

    // 6. Quality gate
    const qualityGate = runQualityGate(parsed.qualityGate ?? {});

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
      description: `Design project generated: ${brief.project_name} (${brief.brand})`,
      xp_amount: 50,
    }).catch(() => {});

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
