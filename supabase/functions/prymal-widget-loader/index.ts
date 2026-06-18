// prymal-widget-loader — serves the embeddable customer AI agent chat widget
// Customers paste: <script src="[this-url]?token=EMBED_TOKEN" async></script>
// Injects a floating chat button + slide-up panel powered by mavis-agent-serve

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_JS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/javascript; charset=utf-8",
  "Cache-Control": "public, max-age=300",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("", { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  const url   = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";

  if (!token) {
    return new Response("// prymal-widget-loader: missing token", { headers: CORS_JS, status: 400 });
  }

  // Load minimal agent config to pre-populate widget branding
  let agentName  = "AI Assistant";
  let brandColor = "#1a56db";

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data } = await sb
      .from("customer_agents")
      .select("agent_name, brand_color, status")
      .eq("embed_token", token)
      .single();
    if (data?.status !== "active") {
      return new Response("// prymal-widget-loader: agent not active", { headers: CORS_JS, status: 403 });
    }
    agentName  = data.agent_name  ?? agentName;
    brandColor = data.brand_color ?? brandColor;
  } catch {
    return new Response("// prymal-widget-loader: agent not found", { headers: CORS_JS, status: 404 });
  }

  const agentServeUrl = `${SUPABASE_URL}/functions/v1/mavis-agent-serve`;

  // Self-contained IIFE widget script
  const script = `
(function() {
  'use strict';
  var AGENT_TOKEN  = ${JSON.stringify(token)};
  var AGENT_NAME   = ${JSON.stringify(agentName)};
  var BRAND_COLOR  = ${JSON.stringify(brandColor)};
  var API_URL      = ${JSON.stringify(agentServeUrl)};
  var SESSION_ID   = 'pa_' + Math.random().toString(36).slice(2, 10);
  var history      = [];
  var isOpen       = false;
  var isTyping     = false;

  // ── Styles ────────────────────────────────────────────────────
  var style = document.createElement('style');
  style.textContent = [
    '#pa-widget-btn{position:fixed;bottom:20px;right:20px;z-index:99999;width:52px;height:52px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(0,0,0,0.3);transition:transform 0.2s;font-size:22px;background:' + BRAND_COLOR + '}',
    '#pa-widget-btn:hover{transform:scale(1.08)}',
    '#pa-widget-panel{position:fixed;bottom:82px;right:20px;z-index:99998;width:360px;max-width:calc(100vw - 40px);height:520px;max-height:calc(100vh - 100px);background:#0d1117;border:1px solid rgba(255,255,255,0.1);border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.5);transform:translateY(12px) scale(0.97);opacity:0;pointer-events:none;transition:transform 0.22s ease,opacity 0.22s ease}',
    '#pa-widget-panel.open{transform:none;opacity:1;pointer-events:all}',
    '#pa-widget-header{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,0.07);background:#060810;shrink:0}',
    '#pa-widget-avatar{width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;border:1px solid;background:' + BRAND_COLOR + '22;color:' + BRAND_COLOR + ';border-color:' + BRAND_COLOR + '44}',
    '#pa-widget-name{flex:1;font-size:13px;font-weight:600;color:#eef2f7;font-family:sans-serif}',
    '#pa-widget-close{background:none;border:none;color:rgba(255,255,255,0.3);cursor:pointer;font-size:18px;line-height:1;padding:2px}',
    '#pa-widget-msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.1) transparent}',
    '.pa-msg{display:flex;flex-direction:column;max-width:82%}',
    '.pa-msg.user{align-self:flex-end}',
    '.pa-msg.agent{align-self:flex-start}',
    '.pa-bubble{padding:8px 12px;border-radius:12px;font-size:12px;line-height:1.5;font-family:sans-serif;white-space:pre-wrap;word-break:break-word}',
    '.pa-msg.user .pa-bubble{background:rgba(255,255,255,0.07);color:rgba(255,255,255,0.85);border-radius:12px 12px 4px 12px}',
    '.pa-msg.agent .pa-bubble{background:rgba(0,0,0,0.4);color:rgba(255,255,255,0.7);border:1px solid rgba(255,255,255,0.06);border-radius:12px 12px 12px 4px}',
    '.pa-typing{display:flex;gap:4px;padding:8px 12px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.06);border-radius:12px;align-self:flex-start}',
    '.pa-dot{width:6px;height:6px;border-radius:50%;background:' + BRAND_COLOR + '88;animation:pa-bounce 1s ease-in-out infinite}',
    '.pa-dot:nth-child(2){animation-delay:0.2s}.pa-dot:nth-child(3){animation-delay:0.4s}',
    '@keyframes pa-bounce{0%,80%,100%{transform:scale(0);opacity:0.3}40%{transform:scale(1);opacity:1}}',
    '#pa-widget-input-row{display:flex;align-items:flex-end;gap:8px;padding:10px 12px;border-top:1px solid rgba(255,255,255,0.06);background:#060810;shrink:0}',
    '#pa-widget-input{flex:1;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#eef2f7;font-size:12px;font-family:sans-serif;padding:8px 10px;resize:none;min-height:36px;max-height:90px;line-height:1.4;outline:none}',
    '#pa-widget-input::placeholder{color:rgba(255,255,255,0.2)}',
    '#pa-widget-send{width:34px;height:34px;border-radius:8px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:14px;transition:opacity 0.15s;background:' + BRAND_COLOR + '}',
    '#pa-widget-send:disabled{opacity:0.3;cursor:not-allowed}',
    '#pa-widget-footer{text-align:center;padding:6px;font-size:9px;color:rgba(255,255,255,0.15);font-family:sans-serif;border-top:1px solid rgba(255,255,255,0.04)}',
    '#pa-widget-footer a{color:' + BRAND_COLOR + '66;text-decoration:none}',
  ].join('');
  document.head.appendChild(style);

  // ── DOM ───────────────────────────────────────────────────────
  var btn = document.createElement('button');
  btn.id = 'pa-widget-btn';
  btn.title = 'Chat with ' + AGENT_NAME;
  btn.innerHTML = '💬';

  var panel = document.createElement('div');
  panel.id = 'pa-widget-panel';
  panel.innerHTML = [
    '<div id="pa-widget-header">',
      '<div id="pa-widget-avatar">' + AGENT_NAME.slice(0,2).toUpperCase() + '</div>',
      '<span id="pa-widget-name">' + AGENT_NAME + '</span>',
      '<button id="pa-widget-close" aria-label="Close">×</button>',
    '</div>',
    '<div id="pa-widget-msgs"></div>',
    '<div id="pa-widget-input-row">',
      '<textarea id="pa-widget-input" placeholder="Type a message…" rows="1"></textarea>',
      '<button id="pa-widget-send" aria-label="Send">➤</button>',
    '</div>',
    '<div id="pa-widget-footer">Powered by <a href="https://prymalai.com" target="_blank">PrymalAI</a></div>',
  ].join('');

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  var msgsEl  = document.getElementById('pa-widget-msgs');
  var inputEl = document.getElementById('pa-widget-input');
  var sendEl  = document.getElementById('pa-widget-send');
  var closeEl = document.getElementById('pa-widget-close');

  // ── State ─────────────────────────────────────────────────────
  function togglePanel() {
    isOpen = !isOpen;
    panel.classList.toggle('open', isOpen);
    btn.innerHTML = isOpen ? '✕' : '💬';
    if (isOpen && history.length === 0) addMsg('agent', 'Hi! I\\'m ' + AGENT_NAME + '. How can I help you today?');
  }

  function addMsg(role, text) {
    var wrap  = document.createElement('div');
    wrap.className = 'pa-msg ' + role;
    var bubble = document.createElement('div');
    bubble.className = 'pa-bubble';
    bubble.textContent = text;
    wrap.appendChild(bubble);
    msgsEl.appendChild(wrap);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    return wrap;
  }

  function showTyping() {
    var el = document.createElement('div');
    el.className = 'pa-typing';
    el.innerHTML = '<div class="pa-dot"></div><div class="pa-dot"></div><div class="pa-dot"></div>';
    msgsEl.appendChild(el);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    return el;
  }

  async function sendMessage() {
    var text = inputEl.value.trim();
    if (!text || isTyping) return;
    inputEl.value = '';
    inputEl.style.height = 'auto';
    addMsg('user', text);
    history.push({ role: 'user', content: text });

    isTyping = true;
    sendEl.disabled = true;
    var typingEl = showTyping();

    try {
      var res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-agent-token': AGENT_TOKEN },
        body: JSON.stringify({ message: text, history: history.slice(-10), session_id: SESSION_ID }),
      });
      var data = await res.json();
      typingEl.remove();
      var reply = data.reply || 'Sorry, I had trouble responding. Please try again.';
      addMsg('agent', reply);
      history.push({ role: 'agent', content: reply });
    } catch (e) {
      typingEl.remove();
      addMsg('agent', 'Sorry, something went wrong. Please try again.');
    } finally {
      isTyping = false;
      sendEl.disabled = false;
    }
  }

  // ── Events ────────────────────────────────────────────────────
  btn.addEventListener('click', togglePanel);
  closeEl.addEventListener('click', togglePanel);
  sendEl.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  inputEl.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 90) + 'px';
  });
})();
`;

  return new Response(script, { headers: CORS_JS });
});
