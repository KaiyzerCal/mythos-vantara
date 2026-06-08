// mavis-design-engine — MAVIS Design Engine Edge Function
// PrymalAI-parity quality: 3-layer canvas ambient system, custom cursor + spotlight,
// HUD overlay, scrolling ticker, mouse-tracking cards, terminal, animated counters.
// Effect components are injected verbatim (not LLM-generated) so they always work.

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

// ═══════════════════════════════════════════════════════════════
// PRE-BUILT EFFECT COMPONENTS
// These are injected into every generated site verbatim.
// They are tested, production-ready — never LLM-generated.
// ═══════════════════════════════════════════════════════════════

// 3-layer canvas: matrix rain + ambient orbs + lightning
const TEMPLATE_CANVAS_BACKGROUND = `import { useEffect, useRef } from 'react';

export default function CanvasBackground() {
  const matrixRef = useRef<HTMLCanvasElement>(null);
  const ambRef    = useRef<HTMLCanvasElement>(null);
  const boltRef   = useRef<HTMLCanvasElement>(null);

  // ── Matrix rain ─────────────────────────────────────────────
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const c = matrixRef.current; if (!c) return;
    const ctx = c.getContext('2d')!;
    let id: number;
    const resize = () => { c.width = window.innerWidth; c.height = window.innerHeight; };
    resize(); window.addEventListener('resize', resize);
    const CHARS = 'アイウエオカキクケコ01サシスセソタチツテトナニヌ01';
    const SZ = 13;
    let cols: number[] = [];
    const init = () => { cols = Array.from({ length: Math.floor(c.width / SZ) }, () => Math.random() * -c.height); };
    init();
    const draw = () => {
      ctx.fillStyle = 'rgba(6,8,16,0.06)';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = 'rgba(0,200,255,0.32)';
      ctx.font = SZ + 'px DM Mono,monospace';
      cols.forEach((y, i) => {
        ctx.fillText(CHARS[Math.floor(Math.random() * CHARS.length)], i * SZ, y);
        cols[i] = y > c.height ? Math.random() * -300 : y + SZ;
      });
      id = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(id); window.removeEventListener('resize', resize); };
  }, []);

  // ── Ambient colour orbs ──────────────────────────────────────
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const c = ambRef.current; if (!c) return;
    const ctx = c.getContext('2d')!;
    let id: number;
    const resize = () => { c.width = window.innerWidth; c.height = window.innerHeight; };
    resize(); window.addEventListener('resize', resize);
    type Orb = { x: number; y: number; vx: number; vy: number; r: number; hue: number };
    const orbs: Orb[] = Array.from({ length: 5 }, () => ({
      x: Math.random() * window.innerWidth, y: Math.random() * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.25,    vy: (Math.random() - 0.5) * 0.25,
      r: 200 + Math.random() * 220,         hue: Math.random() > 0.55 ? 280 : 195,
    }));
    const draw = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      orbs.forEach(o => {
        o.x += o.vx; o.y += o.vy;
        if (o.x < -o.r) o.x = c.width  + o.r; else if (o.x > c.width  + o.r) o.x = -o.r;
        if (o.y < -o.r) o.y = c.height + o.r; else if (o.y > c.height + o.r) o.y = -o.r;
        const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
        g.addColorStop(0,   'hsla(' + o.hue + ',90%,60%,0.046)');
        g.addColorStop(0.5, 'hsla(' + o.hue + ',80%,50%,0.018)');
        g.addColorStop(1,   'transparent');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2); ctx.fill();
      });
      id = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(id); window.removeEventListener('resize', resize); };
  }, []);

  // ── Occasional lightning ─────────────────────────────────────
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const c = boltRef.current; if (!c) return;
    const ctx = c.getContext('2d')!;
    let id: number;
    const resize = () => { c.width = window.innerWidth; c.height = window.innerHeight; };
    resize(); window.addEventListener('resize', resize);
    let nextBolt = Date.now() + 5000 + Math.random() * 8000;
    let alpha = 0;
    let path: Array<[number, number]> = [];
    function mkBolt(x: number): Array<[number, number]> {
      const pts: Array<[number, number]> = [[x, 0]]; let cx = x, cy = 0;
      while (cy < c.height * 0.45) { cx += (Math.random() - 0.5) * 90; cy += 28 + Math.random() * 32; pts.push([cx, cy]); }
      return pts;
    }
    const draw = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      const now = Date.now();
      if (now >= nextBolt) { path = mkBolt(Math.random() * c.width); alpha = 0.7; nextBolt = now + 7000 + Math.random() * 10000; }
      if (alpha > 0 && path.length > 1) {
        ctx.beginPath(); ctx.moveTo(path[0][0], path[0][1]);
        for (let i = 1; i < path.length; i++) ctx.lineTo(path[i][0], path[i][1]);
        ctx.strokeStyle = 'rgba(0,200,255,' + alpha + ')';
        ctx.lineWidth = 1.5; ctx.shadowColor = 'rgba(0,200,255,' + alpha + ')'; ctx.shadowBlur = 10;
        ctx.stroke(); ctx.shadowBlur = 0;
        alpha = Math.max(0, alpha - 0.02);
      }
      id = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(id); window.removeEventListener('resize', resize); };
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }} aria-hidden>
      <canvas ref={matrixRef} className="absolute inset-0 w-full h-full" style={{ opacity: 0.13, mixBlendMode: 'screen' as const }} />
      <canvas ref={ambRef}    className="absolute inset-0 w-full h-full" />
      <canvas ref={boltRef}   className="absolute inset-0 w-full h-full" style={{ opacity: 0.7, mixBlendMode: 'screen' as const }} />
    </div>
  );
}
`;

// Custom cursor dot + canvas tracer trail + page-wide radial spotlight
const TEMPLATE_CURSOR_FX = `import { useEffect, useRef } from 'react';

export default function CursorFX() {
  const tracerRef = useRef<HTMLCanvasElement>(null);
  const dotRef    = useRef<HTMLDivElement>(null);
  const spotRef   = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.body.style.cursor = 'none';
    const tracer = tracerRef.current;
    const dot    = dotRef.current;
    const spot   = spotRef.current;
    if (!tracer || !dot || !spot) return;

    const resize = () => { tracer.width = window.innerWidth; tracer.height = window.innerHeight; };
    resize(); window.addEventListener('resize', resize);
    const ctx = tracer.getContext('2d')!;
    type Pt = { x: number; y: number; a: number };
    const trail: Pt[] = [];
    let id: number;

    const onMove = (e: MouseEvent) => {
      const x = e.clientX, y = e.clientY;
      dot.style.left  = x + 'px'; dot.style.top  = y + 'px';
      spot.style.left = x + 'px'; spot.style.top = y + 'px';
      trail.push({ x, y, a: 1 });
      if (trail.length > 44) trail.shift();
    };

    const draw = () => {
      ctx.clearRect(0, 0, tracer.width, tracer.height);
      trail.forEach((p, i) => {
        p.a *= 0.94;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.6 * ((i + 1) / trail.length), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,200,255,' + (p.a * 0.44) + ')';
        ctx.fill();
      });
      id = requestAnimationFrame(draw);
    };

    window.addEventListener('mousemove', onMove);
    draw();
    return () => {
      document.body.style.cursor = '';
      cancelAnimationFrame(id);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <>
      <canvas ref={tracerRef} className="fixed inset-0 pointer-events-none" style={{ zIndex: 9998 }} aria-hidden />
      <div ref={dotRef} className="fixed pointer-events-none" style={{ zIndex: 9999, transform: 'translate(-50%,-50%)', top: 0, left: 0 }} aria-hidden>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'rgba(0,200,255,0.9)', boxShadow: '0 0 8px rgba(0,200,255,0.65)' }} />
      </div>
      <div ref={spotRef} className="fixed pointer-events-none" aria-hidden
        style={{ zIndex: 1, width: 700, height: 700, borderRadius: '50%', transform: 'translate(-50%,-50%)', top: 0, left: 0,
          background: 'radial-gradient(circle,rgba(0,200,255,0.022) 0%,rgba(0,200,255,0.008) 40%,transparent 70%)',
          mixBlendMode: 'screen' as const }} />
    </>
  );
}
`;

// Corner HUD brackets + rotating dashed arc + live system clock + scanline sweep
const TEMPLATE_HUD_OVERLAY = `import { useEffect, useState } from 'react';

function pad(n: number) { return n.toString().padStart(2, '0'); }

export default function HudOverlay() {
  const [angle, setAngle] = useState(0);
  const [clock, setClock] = useState('');
  const [scanY, setScanY] = useState(0);

  useEffect(() => {
    let id: number; let frame = 0;
    const tick = () => {
      frame++;
      if (frame % 2 === 0) setAngle(a => (a + 0.5) % 360);
      if (frame % 3 === 0) setScanY(y => (y >= 99 ? 0 : y + 0.07));
      if (frame % 18 === 0) {
        const d = new Date();
        setClock(pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()));
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  const BC = '2px solid rgba(0,200,255,0.22)';
  const corner = (style: React.CSSProperties) => (
    <div style={{ position: 'absolute', width: 30, height: 30, ...style }} />
  );

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 10 }} aria-hidden>
      {corner({ top: 14, left: 14,   borderLeft: BC, borderTop: BC })}
      {corner({ top: 14, right: 14,  borderRight: BC, borderTop: BC })}
      {corner({ bottom: 14, left: 14,  borderLeft: BC, borderBottom: BC })}
      {corner({ bottom: 14, right: 14, borderRight: BC, borderBottom: BC })}

      <div style={{ position: 'absolute', top: 10, right: 52, width: 44, height: 44, transform: 'rotate(' + angle + 'deg)' }}>
        <svg viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="22" cy="22" r="18" stroke="rgba(0,200,255,0.2)" strokeWidth="1" strokeDasharray="5 4" />
          <circle cx="22" cy="22" r="10" stroke="rgba(0,200,255,0.1)" strokeWidth="0.5" />
        </svg>
      </div>

      {clock && (
        <div style={{ position: 'absolute', top: 21, left: 52, fontFamily: 'DM Mono,monospace', fontSize: 9, letterSpacing: 2, color: 'rgba(238,242,247,0.18)', userSelect: 'none' }}>
          SYS:{clock}
        </div>
      )}

      <div style={{
        position: 'absolute', left: 0, right: 0, height: 1, top: scanY + 'vh',
        background: 'linear-gradient(90deg,transparent 0%,rgba(0,200,255,0.28) 30%,rgba(0,200,255,0.28) 70%,transparent 100%)',
        opacity: 0.45,
      }} />
    </div>
  );
}
`;

// Seamless scrolling ticker strip — place immediately after Hero
const TEMPLATE_TICKER = `interface TickerProps {
  items: string[];
  accent?: string;
  durationSecs?: number;
}

export default function Ticker({ items, accent = '#00c8ff', durationSecs }: TickerProps) {
  const dur = (durationSecs ?? Math.max(22, items.length * 3.5)) + 's';
  const doubled = [...items, ...items];
  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderTop: '1px solid rgba(0,200,255,0.1)', borderBottom: '1px solid rgba(0,200,255,0.1)', background: 'rgba(0,200,255,0.018)', backdropFilter: 'blur(4px)' }}>
      <div style={{ display: 'inline-flex', gap: '2.5rem', whiteSpace: 'nowrap', padding: '10px 0', animation: 'ticker-scroll ' + dur + ' linear infinite' }}>
        {doubled.map((item, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', fontFamily: 'var(--fm,DM Mono,monospace)', fontSize: '10px', letterSpacing: '2px', textTransform: 'uppercase', color: 'rgba(238,242,247,0.28)', flexShrink: 0 }}>
            <span style={{ width: 4, height: 4, borderRadius: '50%', background: accent, display: 'inline-block', flexShrink: 0 }} />
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
`;

// CSS keyframes and base rules appended to every generated styles.css
const TEMPLATE_CSS_ADDENDUM = `
/* ── MAVIS Effect System — injected keyframes ──────────────── */
@keyframes ticker-scroll {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
@keyframes glitch-1 {
  0%,100% { clip-path: inset(0 0 98% 0); transform: none; }
  10%     { clip-path: inset(8% 0 60% 0);  transform: translate(-2px,0); }
  20%     { clip-path: inset(50% 0 30% 0); transform: translate(2px,0);  }
  30%     { clip-path: inset(80% 0 8% 0);  transform: none; }
}
@keyframes glitch-2 {
  0%,100% { clip-path: inset(0 0 98% 0); transform: none; }
  15%     { clip-path: inset(15% 0 50% 0); transform: translate(2px,0); }
  25%     { clip-path: inset(60% 0 20% 0); transform: translate(-2px,0); }
}
@keyframes grid-breathe {
  0%,100% { opacity: 0.8; }
  50%     { opacity: 1; }
}
@keyframes pulse-dot {
  0%,100% { opacity: 1; box-shadow: 0 0 6px #28c840; }
  50%     { opacity: 0.6; box-shadow: 0 0 10px #28c840; }
}
@keyframes border-glow {
  0%,100% { opacity: 0.5; }
  50%     { opacity: 1; }
}
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(24px); }
  to   { opacity: 1; transform: translateY(0); }
}
`;

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

const PREMIUM_FONT_STACKS = {
  cyberpunk: {
    name: "Bebas Neue + DM Sans + DM Mono",
    display: "'Bebas Neue', Impact, sans-serif",
    body: "'DM Sans', Inter, sans-serif",
    mono: "'DM Mono', 'JetBrains Mono', monospace",
    googleUrl: "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=DM+Mono:ital,wght@0,400;0,500;1,400&display=swap",
    tailwind: `fontFamily: { display: ['Bebas Neue','Impact','sans-serif'], sans: ['DM Sans','Inter','sans-serif'], mono: ['DM Mono','JetBrains Mono','monospace'] }`,
    headingMod: "letter-spacing: 2px; text-transform: uppercase; font-weight: 400;",
  },
  premium: {
    name: "Space Grotesk + DM Sans + JetBrains Mono",
    display: "'Space Grotesk', Inter, sans-serif",
    body: "'DM Sans', Inter, sans-serif",
    mono: "'JetBrains Mono', monospace",
    googleUrl: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=DM+Sans:wght@300;400;500;600&family=JetBrains+Mono:ital,wght@0,400;0,500;1,400&display=swap",
    tailwind: `fontFamily: { display: ['Space Grotesk','Inter','sans-serif'], sans: ['DM Sans','Inter','sans-serif'], mono: ['JetBrains Mono','monospace'] }`,
    headingMod: "letter-spacing: -0.02em; font-weight: 700;",
  },
};

const SUB_BRANDS: Record<string, {
  accent: string; secondary: string; bg: string; surface: string; tone: string; fontStack: string;
}> = {
  vantara:    { accent: "#C9A84C", secondary: "#6366F1", bg: "#09090E", surface: "#111118", tone: "Imperial, technical, sovereign — gold authority", fontStack: "premium" },
  skyforgeai: { accent: "#F97316", secondary: "#FBBF24", bg: "#0A0804", surface: "#12100A", tone: "Sharp, results-driven, operational — orange momentum", fontStack: "premium" },
  bioneer:    { accent: "#22C55E", secondary: "#86EFAC", bg: "#040E08", surface: "#0A1A0C", tone: "Primal, disciplined, performance-first — green vitality", fontStack: "premium" },
  navi:       { accent: "#8B5CF6", secondary: "#C4B5FD", bg: "#070514", surface: "#0E0B1E", tone: "Energetic, playful, companion-like — purple intelligence", fontStack: "premium" },
  codexos:    { accent: "#C9A84C", secondary: "#6366F1", bg: "#09090E", surface: "#111118", tone: "Mythic, architectural, ecosystem-wide — master brand", fontStack: "cyberpunk" },
  prymal:     { accent: "#00c8ff", secondary: "#7c3aed", bg: "#060810", surface: "#0d1117", tone: "Cyberpunk-elite, technical precision, unapologetically premium. Every pixel intentional. Every interaction alive.", fontStack: "cyberpunk" },
  custom:     { accent: "#C9A84C", secondary: "#6366F1", bg: "#09090E", surface: "#111118", tone: "Sovereign, precise, premium", fontStack: "cyberpunk" },
};

// ─── PROMPT BUILDERS ─────────────────────────────────────────

function buildSystemPrompt(brief: Record<string, unknown>): string {
  const brand = String(brief.brand ?? "custom");
  const sb = SUB_BRANDS[brand] ?? SUB_BRANDS.custom;
  const fonts = PREMIUM_FONT_STACKS[sb.fontStack as keyof typeof PREMIUM_FONT_STACKS] ?? PREMIUM_FONT_STACKS.cyberpunk;
  const card = brand === "prymal" || brand === "codexos" ? "#111827" : "#16161F";

  return `You are MAVIS — Machine Autonomous Vantara Intelligence System.
Quality benchmark: PrymalAI — cinematic dark website with canvas particle networks,
mouse-tracking spotlight cards, glassmorphic nav, glitch headlines, terminal animations,
animated stat counters, and a Bebas Neue + DM Sans typography system that commands attention.
You do NOT produce generic websites. You produce sovereign digital infrastructure.

BRAND: ${brand.toUpperCase()}
BG: ${sb.bg}  |  Surface: ${sb.surface}  |  Card: ${card}
Accent: ${sb.accent}  |  Accent2: ${sb.secondary}
Display Font: ${fonts.display}
Body Font:    ${fonts.body}
Mono Font:    ${fonts.mono}
Google URL:   ${fonts.googleUrl}
Tone: ${sb.tone}

CSS CUSTOM PROPERTIES — always in styles.css :root:
  --bg:      ${sb.bg};
  --surface: ${sb.surface};
  --card:    ${card};
  --accent:  ${sb.accent};
  --accent2: ${sb.secondary};
  --text:    ${brand === "prymal" ? "#eef2f7" : "#F1F0ED"};
  --muted:   #6b7280;
  --border:  ${sb.accent}1a;
  --border2: ${sb.accent}33;
  --glow:    0 0 24px ${sb.accent}30;
  --fd: ${fonts.display};
  --fb: ${fonts.body};
  --fm: ${fonts.mono};

GRID OVERLAY — always in body::before:
  content:''; position:fixed; inset:0; pointer-events:none; z-index:0;
  background-image: linear-gradient(${sb.accent}05 1px,transparent 1px),
                    linear-gradient(90deg,${sb.accent}05 1px,transparent 1px);
  background-size:56px 56px; animation: grid-breathe 14s ease-in-out infinite;

PRE-BUILT EFFECT COMPONENTS (injected automatically — you MUST import and use them):
  import CanvasBackground from './components/effects/CanvasBackground';
  import CursorFX         from './components/effects/CursorFX';
  import HudOverlay       from './components/effects/HudOverlay';
  import Ticker           from './components/effects/Ticker';
These are already in the final file list. Your App.tsx MUST render all 4.

PERFORMANCE: Lighthouse 95+, LCP < 2.5s, CLS < 0.1, JS < 150kb gz
REDUCED MOTION: @media(prefers-reduced-motion:reduce) { *{animation-duration:.001ms!important} }

DESIGN LAWS:
${DESIGN_LAWS}

TAILWIND CONFIG (extend): theme: { extend: { ${fonts.tailwind} } }

MOUSE-TRACKING SPOTLIGHT ON CARDS — every feature/service card MUST use:
  onMouseMove={(e)=>{ const r=e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx',((e.clientX-r.left)/r.width*100)+'%');
    e.currentTarget.style.setProperty('--my',((e.clientY-r.top)/r.height*100)+'%'); }}
  className="relative group before:absolute before:inset-0 before:rounded-[inherit]
    before:bg-[radial-gradient(ellipse_at_var(--mx,50%)_var(--my,50%),rgba(0,200,255,0.07),transparent_65%)]
    before:opacity-0 before:transition-opacity before:duration-300 hover:before:opacity-100"

GLITCH TEXT — primary hero headline must use this pattern:
  <span className="relative inline-block group cursor-default select-none">
    <span className="relative z-10">{text}</span>
    <span className="absolute inset-0 text-cyan-400 opacity-0 group-hover:opacity-60
      translate-x-[1px] -translate-y-[1px] blur-[0.4px] transition-opacity duration-75
      select-none pointer-events-none" aria-hidden>{text}</span>
    <span className="absolute inset-0 text-purple-400 opacity-0 group-hover:opacity-40
      -translate-x-[1px] translate-y-[1px] blur-[0.4px] transition-opacity duration-100
      select-none pointer-events-none" aria-hidden>{text}</span>
  </span>

ANIMATED COUNTER — Stats section:
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

SCROLL-REVEAL HOOK:
  function useReveal(threshold=0.12) {
    const ref=useRef<HTMLDivElement>(null); const [vis,setVis]=useState(false);
    useEffect(()=>{
      const obs=new IntersectionObserver(([e])=>{ if(e.isIntersecting){setVis(true);obs.disconnect();} },{threshold});
      if(ref.current) obs.observe(ref.current); return ()=>obs.disconnect();
    },[threshold]);
    return {ref,vis};
  }

TERMINAL TYPING — include a terminal window with multi-line typing:
  const LINES = ['$ system.init --mode=autonomous','> Loading intelligence modules...','> Neural pathways established.','✓ All systems operational.'];

SVG GEO ACCENT — inside each feature card (group-hover:rotate, low opacity):
  <svg className="absolute right-4 bottom-4 w-24 h-24 text-current opacity-[0.06]
    transition-transform duration-500 group-hover:rotate-12 group-hover:opacity-[0.1]"
    viewBox="0 0 160 160" fill="none" stroke="currentColor" strokeWidth="1">
    <polygon points="80,8 148,44 148,116 80,152 12,116 12,44"/>
    <polygon points="80,30 124,55 124,105 80,130 36,105 36,55"/>
    <circle cx="80" cy="80" r="16"/>
  </svg>

GLASSMORPHISM:
  Nav:  fixed top-0 inset-x-0 bg-black/50 backdrop-blur-[40px] saturate-200 border-b border-white/5
  Card: bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-xl
  Form: bg-[#0d1117]/80 backdrop-blur-[20px] border border-[rgba(0,200,255,0.2)] rounded-xl

CODE REQUIREMENTS:
- TypeScript, no any[] where avoidable
- Tailwind + CSS var arbitrary values e.g. bg-[var(--accent)] text-[var(--text)]
- Framer Motion for section reveals: whileInView / initial / viewport={{ once:true }}
- Complete production code — no TODOs, no placeholders, no "// ...rest of code"
- Google Fonts @import must be the FIRST line of styles.css`;
}

function buildUserPrompt(brief: Record<string, unknown>): string {
  const features = Array.isArray(brief.key_features) ? (brief.key_features as string[]).join(", ") : "";
  const competitors = Array.isArray(brief.competitor_urls) ? (brief.competitor_urls as string[]).join(", ") : "";
  const brand = String(brief.brand ?? "custom");
  const sb = SUB_BRANDS[brand] ?? SUB_BRANDS.custom;
  const fonts = PREMIUM_FONT_STACKS[sb.fontStack as keyof typeof PREMIUM_FONT_STACKS] ?? PREMIUM_FONT_STACKS.cyberpunk;

  return `Build a cinematic, PrymalAI-quality website. Quality bar: every interaction feels alive.

PROJECT:
  Name:     ${brief.project_name}
  Brand:    ${brand}  |  Accent: ${sb.accent}  |  Font: ${fonts.name}
  Goal:     ${brief.project_goal}
  Audience: ${brief.target_audience}
  Features: ${features}
${brief.aesthetic_directives ? "  Aesthetic: " + brief.aesthetic_directives : ""}
${competitors ? "  Competitors: " + competitors : ""}
${brief.user_journey ? "  Journey: " + brief.user_journey : ""}
  Tier:     ${brief.deadline_tier}

THE FOLLOWING 4 FILES ARE PRE-BUILT AND WILL BE INJECTED AUTOMATICALLY.
DO NOT generate them — they already exist:
  components/effects/CanvasBackground.tsx  (3-layer canvas: matrix rain + orbs + lightning)
  components/effects/CursorFX.tsx          (custom cursor dot + canvas tracer + page spotlight)
  components/effects/HudOverlay.tsx        (HUD corner brackets + rotating arc + live clock + scanline)
  components/effects/Ticker.tsx            (seamless scrolling ticker strip)

YOU MUST GENERATE EXACTLY THESE 9 FILES (complete production code, no TODOs):
  1. styles.css            — @import fonts (FIRST LINE), :root vars, keyframes, grid overlay
  2. App.tsx               — imports + renders ALL 4 effect components + all 8 sections
  3. components/Nav.tsx    — fixed glassmorphic nav, logo, links, CTA, mobile hamburger
  4. components/Hero.tsx   — canvas particle network (useRef+useEffect), GlitchText headline, dual CTA
  5. components/Features.tsx — 3-4 mouse-tracking spotlight cards, SVG geo accents, scroll-reveal
  6. components/Stats.tsx  — 4 AnimCounter stats, glassmorphism band, IntersectionObserver
  7. components/Terminal.tsx — terminal window, multi-line typing animation, blinking cursor
  8. components/Social.tsx — testimonials or social proof, scroll-reveal
  9. components/Footer.tsx — 3-column: brand tagline + nav links + socials/legal

MANDATORY ITEMS IN App.tsx:
  import CanvasBackground from './components/effects/CanvasBackground';
  import CursorFX         from './components/effects/CursorFX';
  import HudOverlay       from './components/effects/HudOverlay';
  import Ticker           from './components/effects/Ticker';

  return (
    <>
      <CanvasBackground />
      <CursorFX />
      <HudOverlay />
      <Nav />
      <main>
        <section id="hero"><Hero /></section>
        <Ticker items={[/* 6-8 brand/service keywords */]} />
        <Features />
        <Stats />
        <Terminal />
        <Social />
        <section id="cta">{/* conversion CTA section with animated border glow */}</section>
      </main>
      <Footer />
    </>
  );

MANDATORY IN Hero.tsx — full canvas particle network (copy this pattern exactly):
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!; let id: number;
    const resize = () => { canvas.width=canvas.offsetWidth; canvas.height=canvas.offsetHeight; };
    resize(); window.addEventListener('resize', resize);
    type Node = { x:number;y:number;vx:number;vy:number;r:number };
    const nodes: Node[] = Array.from({length:55},()=>({ x:Math.random()*canvas.width, y:Math.random()*canvas.height, vx:(Math.random()-0.5)*0.45, vy:(Math.random()-0.5)*0.45, r:Math.random()*2+0.8 }));
    const draw = () => {
      ctx.clearRect(0,0,canvas.width,canvas.height);
      nodes.forEach(n=>{ n.x+=n.vx; n.y+=n.vy; if(n.x<0||n.x>canvas.width)n.vx*=-1; if(n.y<0||n.y>canvas.height)n.vy*=-1;
        ctx.beginPath(); ctx.arc(n.x,n.y,n.r,0,Math.PI*2); ctx.fillStyle='rgba(0,200,255,0.7)'; ctx.fill(); });
      for(let i=0;i<nodes.length;i++) for(let j=i+1;j<nodes.length;j++){
        const d=Math.hypot(nodes[i].x-nodes[j].x,nodes[i].y-nodes[j].y);
        if(d<130){ ctx.beginPath(); ctx.moveTo(nodes[i].x,nodes[i].y); ctx.lineTo(nodes[j].x,nodes[j].y);
          ctx.strokeStyle='rgba(0,200,255,'+(0.18*(1-d/130))+')'; ctx.lineWidth=0.6; ctx.stroke(); }}
      id=requestAnimationFrame(draw);
    };
    draw();
    return ()=>{ cancelAnimationFrame(id); window.removeEventListener('resize',resize); };
  },[]);
  // JSX: <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

RESPOND WITH VALID JSON ONLY — no markdown fences, no text before or after.
All 9 files must have COMPLETE deployable code.

Return this JSON structure:
{
  "blueprint": {
    "targetOperatorAnalysis": { "portrait":"", "wants":"", "bounceReasons":"", "conversionTriggers":"", "comparingAgainst":"" },
    "competitivePositioning": { "competitorStrengths":[], "competitorWeaknesses":[], "codexosAdvantage":"" },
    "conversionArchitecture": { "primaryAction":"", "trustSignals":[], "attentionFlow":[], "minimumViableInfo":"" },
    "appliedDesignLaws":[],
    "performanceContract":{ "lighthouseTarget":95, "lcpTarget":"<2.5s", "clsTarget":"<0.1", "bundleBudget":"<150kb", "imageStrategy":"" }
  },
  "designSystem": {
    "colorPalette":{ "background":"${sb.bg}", "surface":"${sb.surface}", "border":"${sb.accent}1a", "accent":"${sb.accent}", "accentSecondary":"${sb.secondary}", "textPrimary":"#eef2f7", "textSecondary":"#9ca3af", "textMuted":"#6b7280", "semantic":{}, "rationale":"" },
    "typography":{ "displayFont":"${fonts.display}", "bodyFont":"${fonts.body}", "monoFont":"${fonts.mono}", "scale":{}, "lineHeights":{}, "letterSpacing":{} },
    "components":[{ "name":"", "type":"hero", "purpose":"", "structure":"", "styling":"", "interactions":"", "accessibility":"", "conversionRole":"" }],
    "microInteractions":[{ "trigger":"hover", "element":"", "animation":"", "duration":"300ms", "easing":"cubic-bezier(0.4,0,0.2,1)", "purpose":"delight", "implementation":"css" }],
    "responsiveStrategy":{ "breakpoints":{"sm":"640px","md":"768px","lg":"1024px","xl":"1280px"}, "mobileFirst":"", "tabletAdaptations":"", "desktopExpansion":"", "widescreen":"" }
  },
  "files":[
    { "path":"styles.css",            "content":"FULL CSS", "type":"css", "description":"Global styles" },
    { "path":"App.tsx",               "content":"FULL TSX — imports all 4 effect components", "type":"tsx", "description":"Root" },
    { "path":"components/Nav.tsx",    "content":"FULL TSX", "type":"tsx", "description":"Nav" },
    { "path":"components/Hero.tsx",   "content":"FULL TSX — canvas network + glitch text", "type":"tsx", "description":"Hero" },
    { "path":"components/Features.tsx","content":"FULL TSX — spotlight cards + SVG accents", "type":"tsx", "description":"Features" },
    { "path":"components/Stats.tsx",  "content":"FULL TSX — AnimCounter x4", "type":"tsx", "description":"Stats" },
    { "path":"components/Terminal.tsx","content":"FULL TSX — typing animation", "type":"tsx", "description":"Terminal" },
    { "path":"components/Social.tsx", "content":"FULL TSX — testimonials", "type":"tsx", "description":"Social" },
    { "path":"components/Footer.tsx", "content":"FULL TSX — 3-col footer", "type":"tsx", "description":"Footer" }
  ],
  "qualityGate":{
    "conversion":{ "cta_above_fold":true, "uvp_clear_in_3s":true, "trust_signals_above_fold":true, "minimal_form_fields":true, "success_state_designed":true },
    "design":{ "contrast_aa_compliant":true, "focus_states_visible":true, "spacing_consistent":true, "typography_harmonious":true, "dark_mode_default":true },
    "performance":{ "no_unused_css":true, "images_have_dimensions":true, "no_layout_shift":true, "reduced_motion_respected":true, "bundle_under_budget":true },
    "brand":{ "sovereign_tone":true, "every_element_earns_its_place":true, "premium_quality":true, "unmistakably_codexos":true }
  }
}`;
}

function inferComponentType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("hero"))                                  return "hero";
  if (lower.includes("nav"))                                   return "navbar";
  if (lower.includes("footer"))                                return "footer";
  if (lower.includes("cta"))                                   return "cta";
  if (lower.includes("card"))                                  return "card";
  if (lower.includes("form"))                                  return "form";
  if (lower.includes("test")||lower.includes("social")||lower.includes("review")) return "testimonial";
  if (lower.includes("pric"))                                  return "pricing";
  if (lower.includes("feature")||lower.includes("grid"))       return "feature_grid";
  if (lower.includes("stat")||lower.includes("counter"))       return "stats";
  if (lower.includes("faq"))                                   return "faq";
  return "custom";
}

function runQualityGate(gate: Record<string, Record<string, boolean>>) {
  const failedChecks: string[] = [];
  for (const cat of ["conversion", "design", "performance", "brand"] as const) {
    for (const [check, passed] of Object.entries(gate[cat] ?? {})) {
      if (!passed) failedChecks.push(`${cat}.${check}`);
    }
  }
  return {
    conversion:  gate.conversion  ?? {},
    design:      gate.design      ?? {},
    performance: gate.performance ?? {},
    brand:       gate.brand       ?? {},
    passed:      failedChecks.length === 0,
    failedChecks,
  };
}

// ─── MAIN HANDLER ────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const sb         = createClient(SUPABASE_URL, SERVICE_KEY);
    const anonSb     = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "");
    const { data: { user } } = await anonSb.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id;

    const body  = await req.json() as Record<string, unknown>;
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
        project_name:         brief.project_name,
        brand:                brief.brand ?? "custom",
        project_goal:         brief.project_goal,
        target_audience:      brief.target_audience,
        key_features:         brief.key_features ?? [],
        aesthetic_directives: brief.aesthetic_directives,
        competitor_urls:      brief.competitor_urls ?? [],
        user_journey:         brief.user_journey,
        deadline_tier:        brief.deadline_tier ?? "standard",
        client_name:          brief.client_name,
        project_value:        brief.project_value,
        status:               "analyzing",
      })
      .select("id")
      .single();

    if (projectError || !project) throw new Error(`Failed to create project: ${projectError?.message}`);
    const projectId = project.id as string;

    await sb.from("mavis_design_projects")
      .update({ status: "designing", updated_at: new Date().toISOString() })
      .eq("id", projectId);

    // 2. Call Claude Opus — 32k tokens for 9 complete production files
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      "claude-opus-4-8",
        max_tokens: 32000,
        system:     buildSystemPrompt(brief),
        messages:   [{ role: "user", content: buildUserPrompt(brief) }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      throw new Error(`Claude API error ${claudeRes.status}: ${errText}`);
    }

    const claudeData = await claudeRes.json() as { content: Array<{ text: string }> };
    const rawText    = claudeData?.content?.[0]?.text ?? "";

    await sb.from("mavis_design_projects")
      .update({ status: "generating", updated_at: new Date().toISOString() })
      .eq("id", projectId);

    // 3. Parse JSON output (strip markdown fences if present)
    const clean  = rawText.replace(/^```json\s*/m, "").replace(/^```\s*/m, "").replace(/```\s*$/m, "").trim();
    const parsed = JSON.parse(clean) as {
      blueprint:   Record<string, unknown>;
      designSystem: Record<string, unknown>;
      files:       Array<{ path: string; content: string; type: string; description: string }>;
      qualityGate: Record<string, Record<string, boolean>>;
    };

    // 4. Inject pre-built effect components (guaranteed-working — not LLM-generated)
    //    These always appear in the final file list regardless of what Claude returned.
    const effectFiles = [
      { path: "components/effects/CanvasBackground.tsx", content: TEMPLATE_CANVAS_BACKGROUND, type: "tsx", description: "3-layer canvas ambient: matrix rain, orbs, lightning" },
      { path: "components/effects/CursorFX.tsx",         content: TEMPLATE_CURSOR_FX,         type: "tsx", description: "Custom cursor dot + canvas tracer trail + page spotlight" },
      { path: "components/effects/HudOverlay.tsx",       content: TEMPLATE_HUD_OVERLAY,       type: "tsx", description: "HUD corner brackets, rotating arc, live clock, scanline" },
      { path: "components/effects/Ticker.tsx",           content: TEMPLATE_TICKER,            type: "tsx", description: "Seamless horizontal scrolling ticker" },
    ];

    // Remove any effect files Claude may have attempted to generate (ours are authoritative)
    const effectPaths = new Set(effectFiles.map(f => f.path));
    const cleanedFiles = parsed.files.filter(f => !effectPaths.has(f.path));

    // Append CSS keyframes to styles.css
    const styleFile = cleanedFiles.find(f => f.path === "styles.css" || f.path === "/styles.css");
    if (styleFile) {
      styleFile.content = styleFile.content.trimEnd() + "\n" + TEMPLATE_CSS_ADDENDUM;
    }

    const allFiles = [...cleanedFiles, ...effectFiles];

    // 5. Store components individually (non-blocking)
    await sb.from("mavis_design_projects")
      .update({ status: "quality_check", updated_at: new Date().toISOString() })
      .eq("id", projectId);

    for (const file of allFiles) {
      if (file.type === "tsx" && file.content) {
        const componentName = file.path.split("/").pop()?.replace(".tsx", "") ?? "Unknown";
        await sb.from("mavis_design_components").insert({
          user_id:        userId,
          project_id:     projectId,
          component_name: componentName,
          component_type: inferComponentType(componentName),
          tsx_code:       file.content,
          is_reusable:    true,
          tags:           [String(brief.brand ?? "custom"), inferComponentType(componentName)],
        }).catch(() => {});
      }
    }

    const qualityGate = runQualityGate(parsed.qualityGate ?? {});

    // 6. Save to DB
    await sb.from("mavis_design_projects").update({
      strategic_blueprint:  parsed.blueprint,
      design_system:        parsed.designSystem,
      generated_files:      allFiles,
      quality_gate_results: qualityGate,
      status:               "complete",
      updated_at:           new Date().toISOString(),
    }).eq("id", projectId);

    await sb.from("activity_log").insert({
      user_id:    userId,
      event_type: "design_generated",
      description: `Design project generated: ${brief.project_name} (${brief.brand})`,
      xp_amount:  50,
    }).catch(() => {});

    return new Response(JSON.stringify({
      projectId,
      blueprint:    parsed.blueprint,
      designSystem: parsed.designSystem,
      files:        allFiles,
      qualityGate,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[mavis-design-engine]", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
