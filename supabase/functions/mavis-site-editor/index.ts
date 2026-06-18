// mavis-site-editor — edit any uploaded HTML/HTM website file
// Supports: targeted edits, tier upgrades (Tier 1→2→3), widget injection, content changes.
// For Tier 3 upgrades, pre-built vanilla JS effect blocks are injected (not LLM-generated).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL") ?? "";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── VANILLA JS EFFECT TEMPLATES ───────────────────────────────
// These are injected as-is before </body> for Tier 3 upgrades.
// Written in plain JS so they work in any HTML file with no build step.

const VANILLA_ORBS = `<script>(function(){
var c=document.createElement('canvas');
c.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;';
document.body.insertBefore(c,document.body.firstChild);
var ctx=c.getContext('2d');
function sz(){c.width=innerWidth;c.height=innerHeight;}
addEventListener('resize',sz);sz();
var O=[{fx:.2,fy:.3,r:320,h:195,vx:.25,vy:.18},{fx:.8,fy:.7,r:280,h:280,vx:-.2,vy:.22},{fx:.5,fy:.5,r:400,h:195,vx:.15,vy:-.25},{fx:.1,fy:.8,r:240,h:280,vx:.3,vy:-.15},{fx:.9,fy:.2,r:360,h:195,vx:-.18,vy:.28}];
var orbs=O.map(function(o){return{x:o.fx*innerWidth,y:o.fy*innerHeight,r:o.r,h:o.h,vx:o.vx,vy:o.vy};});
(function draw(){
  ctx.clearRect(0,0,c.width,c.height);
  orbs.forEach(function(o){
    o.x+=o.vx;o.y+=o.vy;
    if(o.x<-o.r||o.x>c.width+o.r)o.vx*=-1;
    if(o.y<-o.r||o.y>c.height+o.r)o.vy*=-1;
    var g=ctx.createRadialGradient(o.x,o.y,0,o.x,o.y,o.r);
    g.addColorStop(0,'hsla('+o.h+',100%,60%,.07)');g.addColorStop(1,'transparent');
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(o.x,o.y,o.r,0,Math.PI*2);ctx.fill();
  });
  requestAnimationFrame(draw);
})();
})();</script>`;

const VANILLA_MATRIX = `<script>(function(){
var c=document.createElement('canvas');
c.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;opacity:0.13;mix-blend-mode:screen;';
document.body.insertBefore(c,document.body.firstChild);
var ctx=c.getContext('2d'),drops,SZ=13,last=0;
var CH='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ウェエォオカガキギクグケゲコゴサザシジスズセゼソ';
function sz(){c.width=innerWidth;c.height=innerHeight;drops=Array(Math.ceil(c.width/SZ)).fill(1);}
addEventListener('resize',sz);sz();
(function draw(ts){
  if(ts-last>50){last=ts;
    ctx.fillStyle='rgba(6,8,16,.06)';ctx.fillRect(0,0,c.width,c.height);
    ctx.fillStyle='rgba(0,200,255,.32)';ctx.font=SZ+'px monospace';
    drops.forEach(function(y,i){ctx.fillText(CH[Math.random()*CH.length|0],i*SZ,y*SZ);if(y*SZ>c.height&&Math.random()>.975)drops[i]=0;drops[i]++;});
  }
  requestAnimationFrame(draw);
})(0);
})();</script>`;

const VANILLA_CURSOR = `<style>*{cursor:none!important}</style>
<script>(function(){
var dot=document.createElement('div');
dot.style.cssText='position:fixed;width:7px;height:7px;border-radius:50%;background:#00c8ff;pointer-events:none;z-index:9999;transform:translate(-50%,-50%);transition:transform .1s ease;';
var tc=document.createElement('canvas');
tc.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9998;';
var sp=document.createElement('div');
sp.style.cssText='position:fixed;width:700px;height:700px;border-radius:50%;pointer-events:none;z-index:1;transform:translate(-50%,-50%);background:radial-gradient(circle,rgba(0,200,255,.04) 0%,transparent 70%);';
document.body.appendChild(dot);document.body.appendChild(tc);document.body.appendChild(sp);
var ctx=tc.getContext('2d'),mx=innerWidth/2,my=innerHeight/2,trail=[];
function sz(){tc.width=innerWidth;tc.height=innerHeight;}addEventListener('resize',sz);sz();
document.addEventListener('mousemove',function(e){
  mx=e.clientX;my=e.clientY;
  dot.style.left=mx+'px';dot.style.top=my+'px';
  sp.style.left=mx+'px';sp.style.top=my+'px';
  trail.push({x:mx,y:my,a:1});if(trail.length>44)trail.shift();
});
(function draw(){
  ctx.clearRect(0,0,tc.width,tc.height);
  trail.forEach(function(p){ctx.beginPath();ctx.arc(p.x,p.y,1.5,0,Math.PI*2);ctx.fillStyle='rgba(0,200,255,'+p.a+')';ctx.fill();p.a=Math.max(0,p.a-.025);});
  requestAnimationFrame(draw);
})();
})();</script>`;

const VANILLA_HUD = `<style>
#_hud{position:fixed;inset:0;pointer-events:none;z-index:9990;}
#_hud .c{position:absolute;width:20px;height:20px;border-color:rgba(0,200,255,.3);}
#_hud .tl{top:12px;left:12px;border-top:1px solid;border-left:1px solid;}
#_hud .tr{top:12px;right:12px;border-top:1px solid;border-right:1px solid;}
#_hud .bl{bottom:12px;left:12px;border-bottom:1px solid;border-left:1px solid;}
#_hud .br{bottom:12px;right:12px;border-bottom:1px solid;border-right:1px solid;}
#_hud .clk{position:absolute;top:16px;right:40px;font:11px/1 monospace;color:rgba(0,200,255,.5);letter-spacing:2px;}
#_scan{position:fixed;left:0;width:100%;height:1px;background:rgba(0,200,255,.04);pointer-events:none;z-index:9989;}
</style>
<script>(function(){
var h=document.createElement('div');h.id='_hud';
h.innerHTML='<div class="c tl"></div><div class="c tr"></div><div class="c bl"></div><div class="c br"></div>'
  +'<svg style="position:absolute;top:8px;left:8px;width:32px;height:32px" viewBox="0 0 32 32">'
  +'<circle cx="16" cy="16" r="12" fill="none" stroke="rgba(0,200,255,.15)" stroke-width="1"/>'
  +'<path id="_arc" fill="none" stroke="#00c8ff" stroke-width="1.5" stroke-linecap="round"/></svg>'
  +'<div class="clk" id="_clk"></div>';
var sc=document.createElement('div');sc.id='_scan';
document.body.appendChild(h);document.body.appendChild(sc);
var ang=0,sy=0,fr=0,arc=document.getElementById('_arc'),clk=document.getElementById('_clk');
(function draw(){
  ang+=.5;var r=12,a=ang*Math.PI/180;
  var x1=16+r*Math.cos(a-1),y1=16+r*Math.sin(a-1),x2=16+r*Math.cos(a),y2=16+r*Math.sin(a);
  arc.setAttribute('d','M'+x1+','+y1+' A'+r+','+r+' 0 0,1 '+x2+','+y2);
  sy+=.07*innerHeight/100;if(sy>innerHeight)sy=0;sc.style.top=sy+'px';
  if(++fr%18===0){var n=new Date();clk.textContent=('0'+n.getHours()).slice(-2)+':'+('0'+n.getMinutes()).slice(-2)+':'+('0'+n.getSeconds()).slice(-2);}
  requestAnimationFrame(draw);
})();
})();</script>`;

// Ticker items are placeholders — Claude customizes them to match the site's brand/services
const VANILLA_TICKER = `<style>
#_ticker{overflow:hidden;background:rgba(0,200,255,.03);border-top:1px solid rgba(0,200,255,.1);border-bottom:1px solid rgba(0,200,255,.1);padding:10px 0;white-space:nowrap;position:relative;z-index:10;}
#_ticker-t{display:inline-block;}
@keyframes _tickscroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}
</style>
<script>(function(){
var items=["REPLACE_ITEM_1","REPLACE_ITEM_2","REPLACE_ITEM_3","REPLACE_ITEM_4","REPLACE_ITEM_5","REPLACE_ITEM_6"];
var div=document.createElement('div');div.id='_ticker';
var t=document.createElement('div');t.id='_ticker-t';
t.style.animation='_tickscroll '+Math.max(22,items.length*3.5)+'s linear infinite';
var d=items.concat(items);
t.innerHTML=d.map(function(i){return'<span style="margin:0 40px;font:12px/1 monospace;color:rgba(0,200,255,.6);letter-spacing:2px;text-transform:uppercase;">'+i+'</span>';}).join('');
div.appendChild(t);
var nav=document.querySelector('nav,header');
if(nav&&nav.nextSibling)nav.parentNode.insertBefore(div,nav.nextSibling);
else document.body.insertBefore(div,document.body.children[1]||document.body.firstChild);
})();</script>`;

// ─── PROMPTS ────────────────────────────────────────────────────

function buildSystemPrompt(targetTier: number | null): string {
  let base = `You are MAVIS, an elite web design AI. You receive a raw HTML website file and editing instructions.

CRITICAL OUTPUT RULES:
1. Respond with ONLY the complete modified HTML file. No markdown fences, no explanation, nothing else.
2. The response must start with <!DOCTYPE html> or <html — zero characters before it.
3. The output must be a complete, valid, self-contained HTML file.
4. Preserve all existing content and functionality unless instructed to change it.
5. Make edits surgical and precise unless doing a full tier upgrade.`;

  if (targetTier === 3) {
    base += `

TIER 3 — SOVEREIGN UPGRADE ($8K+ LEVEL):
You are upgrading this HTML website to elite PrymalAI-tier quality. Required changes:
1. Update body/html background to #060810, card/section surfaces to #0d1117
2. Set primary accent to #00c8ff (cyan) throughout — buttons, borders, glows, highlights
3. Add as the FIRST element in <head>: <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&family=DM+Mono&display=swap" rel="stylesheet">
4. Apply font-family:'Bebas Neue',sans-serif; letter-spacing:2px; text-transform:uppercase to all h1, h2, h3 — keep body text as DM Sans
5. Add spotlight effect to card/feature elements: JS mousemove sets --mx/--my CSS vars, CSS uses radial-gradient at those coords
6. Add CSS glitch animation to the main h1 (keyframes with clip-rect flicker + translateX shimmy)
7. Wrap all body content in a <div style="position:relative;z-index:1"> so it sits above the canvas layers
8. Replace REPLACE_ITEM_1 through REPLACE_ITEM_6 in Block 5 (Ticker) with 6 brand/service keywords from THIS website
9. Inject ALL 5 pre-built effect blocks (Orbs, Matrix, Cursor, HUD, Ticker) immediately before </body> in the exact order given`;
  } else if (targetTier === 2) {
    base += `

TIER 2 — DYNAMIC UPGRADE ($3K–$5K LEVEL):
You are upgrading this HTML website to dynamic quality. Required changes:
1. Darken color scheme: body background #0a0d14, card backgrounds #0f1420
2. Increase accent color vibrancy (saturate/brighten whatever color scheme exists)
3. Add a canvas particle network inside the hero/header section (vanilla JS: create canvas, 55 moving nodes with line connections at <130px, cyan rgba(0,200,255,...) color)
4. Add mouse-tracking spotlight to feature/card elements (JS mousemove sets CSS --mx/--my, radial-gradient overlay)
5. Add IntersectionObserver scroll-reveal: sections/cards fade+translateY from 30px to 0 when entering viewport
6. Add animated number counters to any statistics (count from 0 to final value over 1.5s on intersection)
7. If there is a code or terminal-style section: add a blinking cursor and character-by-character typing animation`;
  } else if (targetTier === 1) {
    base += `

TIER 1 — CLEAN PRO UPGRADE ($1K–$2K LEVEL):
You are upgrading this HTML website to clean professional quality. Required changes:
1. Apply a polished dark theme: #0a0d14 background, #161b22 surfaces, legible contrast
2. Add consistent hover transitions (0.2s ease) on all interactive elements
3. Add CSS scroll-reveal via @keyframes + IntersectionObserver (fade up on enter)
4. Ensure mobile responsiveness — proper flexbox/grid with media queries
5. Add a professional box-shadow/border to cards for depth
6. Clean up any inconsistent spacing — use a consistent 8px grid
7. Add a sticky header/nav if one exists, with glassmorphism backdrop-filter`;
  }

  return base;
}

function buildUserPrompt(
  html: string,
  instructions: string,
  targetTier: number | null,
): string {
  const maxHtml = 55000;
  const htmlInput = html.length > maxHtml
    ? html.slice(0, maxHtml) + "\n<!-- [HTML TRUNCATED AT 55KB] -->"
    : html;

  let prompt = `CURRENT HTML FILE:
\`\`\`html
${htmlInput}
\`\`\`

EDITING INSTRUCTIONS:
${instructions}`;

  if (targetTier === 3) {
    prompt += `

PRE-BUILT EFFECT BLOCKS — inject ALL FIVE immediately before </body> in this exact order:

BLOCK 1 — AMBIENT ORBS (background canvas layer):
${VANILLA_ORBS}

BLOCK 2 — MATRIX RAIN (background canvas layer):
${VANILLA_MATRIX}

BLOCK 3 — CUSTOM CURSOR (cyan dot + tracer trail + spotlight):
${VANILLA_CURSOR}

BLOCK 4 — HUD OVERLAY (corner brackets + rotating arc + live clock + scanline):
${VANILLA_HUD}

BLOCK 5 — TICKER STRIP (customise the items[] array to match THIS website's brand/services):
${VANILLA_TICKER}

Return the complete modified HTML starting with <!DOCTYPE html>. Nothing else.`;
  } else {
    prompt += `

Return ONLY the complete modified HTML file starting with <!DOCTYPE html>. No explanation, no markdown.`;
  }

  return prompt;
}

// ─── MAIN HANDLER ────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const anonSb = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "");
    const { data: { user } } = await anonSb.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json() as {
      html?: string;
      instructions?: string;
      quality_tier?: number | null;
    };

    const { html, instructions, quality_tier = null } = body;
    if (!html)         return json({ error: "html is required" }, 400);
    if (!instructions) return json({ error: "instructions is required" }, 400);

    const targetTier = quality_tier != null ? Number(quality_tier) : null;
    const isUpgrade  = targetTier != null;

    // Use Opus for tier upgrades (heavy rewrites), Sonnet for targeted edits
    const model     = isUpgrade && targetTier >= 2 ? "claude-opus-4-8" : "claude-sonnet-4-6";
    const maxTokens = targetTier === 3 ? 32000 : targetTier === 2 ? 24000 : 16000;

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system:   buildSystemPrompt(targetTier),
        messages: [{ role: "user", content: buildUserPrompt(html, instructions, targetTier) }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      throw new Error(`Claude API error ${claudeRes.status}: ${errText.slice(0, 300)}`);
    }

    const claudeData = await claudeRes.json() as { content: Array<{ text: string }> };
    let result = (claudeData?.content?.[0]?.text ?? "").trim();

    // Strip accidental markdown fences
    result = result.replace(/^```html\s*/m, "").replace(/^```\s*/m, "").replace(/```\s*$/m, "").trim();

    // Ensure response starts at the HTML root
    if (!result.startsWith("<!DOCTYPE") && !result.startsWith("<html")) {
      const i1 = result.indexOf("<!DOCTYPE");
      const i2 = result.indexOf("<html");
      const start = Math.min(...[i1, i2].filter(x => x !== -1));
      if (start > -1) result = result.slice(start);
    }

    const summary = instructions.trim().slice(0, 120) + (instructions.length > 120 ? "…" : "");

    return json({ html: result, summary });
  } catch (err: any) {
    console.error("mavis-site-editor error:", err);
    return json({ error: err.message ?? "Internal server error" }, 500);
  }
});
