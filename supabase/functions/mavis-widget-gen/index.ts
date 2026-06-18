import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const WIDGET_API_URL = `${SUPABASE_URL}/functions/v1/mavis-widget-api`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FormField {
  name: string;
  label: string;
  type: string;
  required: boolean;
}

interface QuoteInput {
  id: string;
  label: string;
  type: "number" | "select" | "range";
  options?: string[];
  min?: number;
  max?: number;
}

interface RoiInput {
  id: string;
  label: string;
  unit: string;
  default_value: number;
}

interface Faq {
  question: string;
  answer: string;
  category?: string;
}

interface WidgetConfig {
  business_name: string;
  business_type?: string;
  primary_color?: string;
  position?: "bottom-right" | "bottom-left";
  avatar?: string;
  font?: string;
  // Chat
  name?: string;
  greeting?: string;
  placeholder?: string;
  system_prompt?: string;
  // Lead capture
  form_title?: string;
  form_fields?: FormField[];
  success_message?: string;
  ai_response_enabled?: boolean;
  // Quote calculator
  service_name?: string;
  quote_inputs?: QuoteInput[];
  price_per_unit?: number;
  currency?: string;
  // FAQ
  faqs?: Faq[];
  // ROI calculator
  roi_inputs?: RoiInput[];
  roi_formula?: string;
  roi_metric?: string;
  // Appointment booker
  service_options?: string[];
  calendar_url?: string;
  // YouTube player
  youtube_url?: string;
  youtube_video_id?: string;
  youtube_playlist_id?: string;
  video_title?: string;
  video_description?: string;
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
  show_controls?: boolean;
  show_youtube_button?: boolean;
}

// ---------------------------------------------------------------------------
// Helper: escape a string for safe injection into a JS string literal
// ---------------------------------------------------------------------------
function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, "\\n");
}

// ---------------------------------------------------------------------------
// Chat Widget
// ---------------------------------------------------------------------------
function generateChatWidget(widgetId: string, config: WidgetConfig, apiUrl: string): string {
  const color = config.primary_color ?? "#1a56db";
  const name = esc(config.name ?? config.business_name ?? "AI Assistant");
  const avatar = esc(config.avatar ?? "🤖");
  const greeting = esc(config.greeting ?? `Hi! I'm ${config.name ?? "your AI assistant"}. How can I help you today?`);
  const placeholder = esc(config.placeholder ?? "Type a message…");
  const systemPrompt = esc(config.system_prompt ?? `You are a helpful assistant for ${config.business_name ?? "this business"}.`);
  const position = config.position === "bottom-left" ? "left: 20px;" : "right: 20px;";

  return `(function(){
var W='${widgetId}',A='${esc(apiUrl)}';
var C={name:'${name}',color:'${esc(color)}',avatar:'${avatar}',greeting:'${greeting}',placeholder:'${placeholder}',systemPrompt:'${systemPrompt}'};
var history=[];
var style=document.createElement('style');
style.textContent='#mw-'+W+'{position:fixed;bottom:20px;${position}z-index:999999;font-family:system-ui,sans-serif;}'+
'#mw-'+W+' .mw-btn{width:60px;height:60px;border-radius:50%;background:'+C.color+';border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 24px rgba(0,0,0,.3);transition:transform .2s,box-shadow .2s;}'+
'#mw-'+W+' .mw-btn:hover{transform:scale(1.08);box-shadow:0 6px 30px rgba(0,0,0,.4);}'+
'#mw-'+W+' .mw-win{position:absolute;bottom:72px;right:0;width:360px;max-height:520px;background:#fff;border-radius:16px;box-shadow:0 12px 48px rgba(0,0,0,.18);display:none;flex-direction:column;overflow:hidden;animation:mwSlide .25s ease;}'+
'@keyframes mwSlide{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:translateY(0);}}'+
'#mw-'+W+' .mw-win.open{display:flex;}'+
'#mw-'+W+' .mw-hdr{background:'+C.color+';padding:16px 20px;display:flex;align-items:center;gap:12px;}'+
'#mw-'+W+' .mw-close{margin-left:auto;background:none;border:none;color:rgba(255,255,255,.8);cursor:pointer;font-size:20px;line-height:1;}'+
'#mw-'+W+' .mw-av{width:42px;height:42px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:22px;}'+
'#mw-'+W+' .mw-nm{color:#fff;font-weight:700;font-size:15px;}'+
'#mw-'+W+' .mw-st{color:rgba(255,255,255,.8);font-size:12px;margin-top:2px;}'+
'#mw-'+W+' .mw-msgs{flex:1;padding:16px;overflow-y:auto;display:flex;flex-direction:column;gap:10px;min-height:200px;max-height:300px;}'+
'#mw-'+W+' .mw-msg{max-width:82%;padding:10px 14px;border-radius:14px;font-size:14px;line-height:1.55;word-break:break-word;}'+
'#mw-'+W+' .mw-bot{background:#f1f5f9;color:#1e293b;border-bottom-left-radius:4px;align-self:flex-start;}'+
'#mw-'+W+' .mw-usr{background:'+C.color+';color:#fff;align-self:flex-end;border-bottom-right-radius:4px;}'+
'#mw-'+W+' .mw-typing{display:flex;align-items:center;gap:5px;padding:12px 14px;background:#f1f5f9;border-radius:14px;border-bottom-left-radius:4px;align-self:flex-start;}'+
'#mw-'+W+' .mw-dot{width:7px;height:7px;background:#94a3b8;border-radius:50%;animation:mwBounce 1.4s infinite;}'+
'#mw-'+W+' .mw-dot:nth-child(2){animation-delay:.2s;}#mw-'+W+' .mw-dot:nth-child(3){animation-delay:.4s;}'+
'@keyframes mwBounce{0%,60%,100%{transform:translateY(0);}30%{transform:translateY(-7px);}}'+
'#mw-'+W+' .mw-inp{padding:12px 16px;border-top:1px solid #e2e8f0;display:flex;gap:8px;background:#fff;}'+
'#mw-'+W+' .mw-inp input{flex:1;border:1.5px solid #e2e8f0;border-radius:10px;padding:9px 13px;font-size:14px;outline:none;transition:border-color .2s;}'+
'#mw-'+W+' .mw-inp input:focus{border-color:'+C.color+';}'+
'#mw-'+W+' .mw-send{background:'+C.color+';color:#fff;border:none;border-radius:10px;padding:9px 18px;cursor:pointer;font-size:14px;font-weight:600;white-space:nowrap;}'+
'#mw-'+W+' .mw-send:hover{opacity:.88;}'+
'#mw-'+W+' .mw-pw{text-align:center;padding:8px;font-size:11px;color:#94a3b8;}';
document.head.appendChild(style);
var wrap=document.createElement('div');
wrap.id='mw-'+W;
wrap.innerHTML='<button class="mw-btn" aria-label="Open chat"><span style="font-size:26px;">'+C.avatar+'</span></button>'+
'<div class="mw-win" role="dialog" aria-label="Chat with '+C.name+'">'+
'<div class="mw-hdr"><div class="mw-av">'+C.avatar+'</div><div><div class="mw-nm">'+C.name+'</div><div class="mw-st">Online · Powered by MAVIS</div></div><button class="mw-close" aria-label="Close">&#x2715;</button></div>'+
'<div class="mw-msgs" id="mw-msgs-'+W+'"></div>'+
'<div class="mw-inp"><input id="mw-in-'+W+'" type="text" placeholder="'+C.placeholder+'" autocomplete="off"/><button class="mw-send">Send</button></div>'+
'<div class="mw-pw">Powered by <strong>MAVIS AI</strong></div>'+
'</div>';
document.body.appendChild(wrap);
var btn=wrap.querySelector('.mw-btn');
var win=wrap.querySelector('.mw-win');
var msgs=wrap.querySelector('#mw-msgs-'+W);
var inp=wrap.querySelector('#mw-in-'+W);
var send=wrap.querySelector('.mw-send');
var closeBtn=wrap.querySelector('.mw-close');
function addMsg(text,role){
  var d=document.createElement('div');
  d.className='mw-msg '+(role==='user'?'mw-usr':'mw-bot');
  d.textContent=text;
  msgs.appendChild(d);
  msgs.scrollTop=msgs.scrollHeight;
  history.push({role:role==='user'?'user':'assistant',content:text});
  if(history.length>12)history=history.slice(history.length-12);
}
function showTyping(){
  var d=document.createElement('div');
  d.className='mw-typing';
  d.id='mw-typing-'+W;
  d.innerHTML='<div class="mw-dot"></div><div class="mw-dot"></div><div class="mw-dot"></div>';
  msgs.appendChild(d);
  msgs.scrollTop=msgs.scrollHeight;
}
function hideTyping(){var t=document.getElementById('mw-typing-'+W);if(t)t.remove();}
function sendMsg(){
  var text=(inp.value||'').trim();
  if(!text)return;
  inp.value='';
  addMsg(text,'user');
  send.disabled=true;
  showTyping();
  fetch(A,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'chat',widget_id:W,message:text,history:history.slice(0,-1),system_prompt:C.systemPrompt})
  }).then(function(r){return r.json();}).then(function(d){
    hideTyping();
    addMsg(d.response||d.message||'Sorry, I could not process that.','bot');
    send.disabled=false;
  }).catch(function(){
    hideTyping();
    addMsg('Sorry, something went wrong. Please try again.','bot');
    send.disabled=false;
  });
}
btn.addEventListener('click',function(){
  win.classList.toggle('open');
  if(win.classList.contains('open')&&msgs.children.length===0){
    addMsg(C.greeting,'bot');
    setTimeout(function(){inp.focus();},100);
  }
});
closeBtn.addEventListener('click',function(){win.classList.remove('open');});
send.addEventListener('click',sendMsg);
inp.addEventListener('keydown',function(e){if(e.key==='Enter')sendMsg();});
})();`;
}

// ---------------------------------------------------------------------------
// Lead Capture Widget
// ---------------------------------------------------------------------------
function generateLeadCaptureWidget(widgetId: string, config: WidgetConfig, apiUrl: string): string {
  const color = config.primary_color ?? "#1a56db";
  const title = esc(config.form_title ?? `Contact ${config.business_name ?? "Us"}`);
  const successMsg = esc(config.success_message ?? "Thanks! We'll be in touch shortly.");
  const aiEnabled = config.ai_response_enabled !== false;

  const fields: FormField[] = config.form_fields ?? [
    { name: "name", label: "Your Name", type: "text", required: true },
    { name: "email", label: "Email Address", type: "email", required: true },
    { name: "message", label: "How can we help?", type: "textarea", required: false },
  ];

  const fieldsJson = JSON.stringify(fields).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  return `(function(){
var W='${widgetId}',A='${esc(apiUrl)}';
var COLOR='${esc(color)}';
var TITLE='${title}';
var SUCCESS='${successMsg}';
var AI_ENABLED=${aiEnabled};
var FIELDS=${fieldsJson};
var style=document.createElement('style');
style.textContent='#mw-lc-'+W+'{font-family:system-ui,sans-serif;background:#fff;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.12);padding:32px;max-width:480px;margin:0 auto;}'+
'#mw-lc-'+W+' h2{margin:0 0 4px;font-size:20px;color:#1e293b;}'+
'#mw-lc-'+W+' .mw-sub{color:#64748b;font-size:14px;margin-bottom:20px;}'+
'#mw-lc-'+W+' .mw-field{margin-bottom:14px;}'+
'#mw-lc-'+W+' label{display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:5px;}'+
'#mw-lc-'+W+' input,#mw-lc-'+W+' textarea,#mw-lc-'+W+' select{width:100%;box-sizing:border-box;border:1.5px solid #e2e8f0;border-radius:8px;padding:9px 12px;font-size:14px;outline:none;transition:border-color .2s;resize:vertical;}'+
'#mw-lc-'+W+' input:focus,#mw-lc-'+W+' textarea:focus{border-color:'+COLOR+';}'+
'#mw-lc-'+W+' textarea{min-height:90px;}'+
'#mw-lc-'+W+' .mw-submit{background:'+COLOR+';color:#fff;border:none;border-radius:10px;padding:12px 24px;font-size:15px;font-weight:700;cursor:pointer;width:100%;margin-top:6px;transition:opacity .2s;}'+
'#mw-lc-'+W+' .mw-submit:hover{opacity:.88;}'+
'#mw-lc-'+W+' .mw-submit:disabled{opacity:.55;cursor:not-allowed;}'+
'#mw-lc-'+W+' .mw-success{text-align:center;padding:24px 0;}'+
'#mw-lc-'+W+' .mw-success .mw-icon{font-size:48px;margin-bottom:12px;}'+
'#mw-lc-'+W+' .mw-success h3{margin:0 0 8px;color:#1e293b;}'+
'#mw-lc-'+W+' .mw-ai-resp{background:#f1f5f9;border-left:3px solid '+COLOR+';border-radius:4px;padding:12px 16px;font-size:14px;color:#1e293b;margin-top:14px;line-height:1.6;}'+
'#mw-lc-'+W+' .mw-pw{text-align:center;margin-top:16px;font-size:11px;color:#94a3b8;}';
document.head.appendChild(style);
var root=document.getElementById('mavis-widget-'+W)||document.body;
var wrap=document.createElement('div');
wrap.id='mw-lc-'+W;
var fhtml='<h2>'+TITLE+'</h2><p class="mw-sub">Fill out the form and we will get back to you.</p><form id="mw-form-'+W+'">';
FIELDS.forEach(function(f){
  fhtml+='<div class="mw-field"><label>'+f.label+(f.required?' <span style="color:red">*</span>':'')+'</label>';
  if(f.type==='textarea'){
    fhtml+='<textarea name="'+f.name+'"'+(f.required?' required':'')+'></textarea>';
  } else {
    fhtml+='<input type="'+f.type+'" name="'+f.name+'"'+(f.required?' required':'')+'/>';
  }
  fhtml+='</div>';
});
fhtml+='<button type="submit" class="mw-submit">Send Message</button></form><div class="mw-pw">Powered by <strong>MAVIS AI</strong></div>';
wrap.innerHTML=fhtml;
root.appendChild(wrap);
var form=document.getElementById('mw-form-'+W);
form.addEventListener('submit',function(e){
  e.preventDefault();
  var data={};
  FIELDS.forEach(function(f){data[f.name]=(form.elements[f.name]||{}).value||'';});
  var btn=form.querySelector('.mw-submit');
  btn.disabled=true;
  btn.textContent='Sending...';
  fetch(A,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'lead_capture',widget_id:W,fields:data,ai_response:AI_ENABLED})
  }).then(function(r){return r.json();}).then(function(d){
    form.innerHTML='<div class="mw-success"><div class="mw-icon">✅</div><h3>'+SUCCESS+'</h3>'+(d.ai_response?'<div class="mw-ai-resp">'+d.ai_response+'</div>':'')+'</div>';
  }).catch(function(){
    btn.disabled=false;
    btn.textContent='Send Message';
    alert('Something went wrong. Please try again.');
  });
});
})();`;
}

// ---------------------------------------------------------------------------
// Quote Calculator Widget
// ---------------------------------------------------------------------------
function generateQuoteCalculatorWidget(widgetId: string, config: WidgetConfig, apiUrl: string): string {
  const color = config.primary_color ?? "#1a56db";
  const serviceName = esc(config.service_name ?? config.business_name ?? "Service");
  const currency = esc(config.currency ?? "USD");
  const pricePerUnit = config.price_per_unit ?? 100;

  const quoteInputs: QuoteInput[] = config.quote_inputs ?? [
    { id: "quantity", label: "Quantity", type: "number", min: 1, max: 10000 },
    { id: "timeline", label: "Timeline (days)", type: "range", min: 1, max: 90 },
  ];

  const inputsJson = JSON.stringify(quoteInputs).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  return `(function(){
var W='${widgetId}',A='${esc(apiUrl)}';
var COLOR='${esc(color)}';
var SERVICE='${serviceName}';
var CURRENCY='${currency}';
var PRICE_PER_UNIT=${pricePerUnit};
var INPUTS=${inputsJson};
var step=1;
var vals={};
var style=document.createElement('style');
style.textContent='#mw-qc-'+W+'{font-family:system-ui,sans-serif;background:#fff;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.12);padding:32px;max-width:520px;margin:0 auto;}'+
'#mw-qc-'+W+' .mw-prog{height:4px;background:#e2e8f0;border-radius:2px;margin-bottom:24px;overflow:hidden;}'+
'#mw-qc-'+W+' .mw-prog-bar{height:100%;background:'+COLOR+';border-radius:2px;transition:width .3s;}'+
'#mw-qc-'+W+' h2{margin:0 0 6px;font-size:20px;color:#1e293b;}'+
'#mw-qc-'+W+' .mw-step-lbl{font-size:12px;color:#64748b;margin-bottom:20px;}'+
'#mw-qc-'+W+' .mw-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-bottom:20px;}'+
'#mw-qc-'+W+' .mw-card{border:2px solid #e2e8f0;border-radius:12px;padding:16px;cursor:pointer;text-align:center;transition:border-color .2s,background .2s;font-size:14px;font-weight:600;}'+
'#mw-qc-'+W+' .mw-card.sel,#mw-qc-'+W+' .mw-card:hover{border-color:'+COLOR+';background:#eff6ff;}'+
'#mw-qc-'+W+' .mw-field{margin-bottom:16px;}'+
'#mw-qc-'+W+' label{display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:5px;}'+
'#mw-qc-'+W+' input[type=number],#mw-qc-'+W+' select{width:100%;box-sizing:border-box;border:1.5px solid #e2e8f0;border-radius:8px;padding:9px 12px;font-size:14px;outline:none;transition:border-color .2s;}'+
'#mw-qc-'+W+' input[type=range]{width:100%;accent-color:'+COLOR+';}'+
'#mw-qc-'+W+' input:focus,#mw-qc-'+W+' select:focus{border-color:'+COLOR+';}'+
'#mw-qc-'+W+' .mw-est{background:#eff6ff;border:1.5px solid '+COLOR+';border-radius:10px;padding:14px 18px;text-align:center;margin:16px 0;font-size:16px;font-weight:700;color:'+COLOR+';}'+
'#mw-qc-'+W+' .mw-btns{display:flex;gap:10px;margin-top:8px;}'+
'#mw-qc-'+W+' .mw-btn-back{flex:1;border:1.5px solid #e2e8f0;background:#fff;color:#374151;border-radius:10px;padding:11px;font-size:14px;font-weight:600;cursor:pointer;}'+
'#mw-qc-'+W+' .mw-btn-next{flex:2;background:'+COLOR+';color:#fff;border:none;border-radius:10px;padding:11px;font-size:14px;font-weight:700;cursor:pointer;}'+
'#mw-qc-'+W+' .mw-btn-next:hover{opacity:.88;}'+
'#mw-qc-'+W+' .mw-success{text-align:center;padding:16px 0;}'+
'#mw-qc-'+W+' .mw-quote-box{background:#f8fafc;border-radius:12px;padding:20px;text-align:left;margin-top:16px;font-size:14px;line-height:1.7;color:#1e293b;}'+
'#mw-qc-'+W+' .mw-pw{text-align:center;margin-top:16px;font-size:11px;color:#94a3b8;}';
document.head.appendChild(style);
var root=document.getElementById('mavis-widget-'+W)||document.body;
var wrap=document.createElement('div');
wrap.id='mw-qc-'+W;
root.appendChild(wrap);
function calcEstimate(){
  var qty=parseFloat(vals.quantity)||1;
  var low=(qty*PRICE_PER_UNIT*0.9).toLocaleString(undefined,{style:'currency',currency:CURRENCY,maximumFractionDigits:0});
  var high=(qty*PRICE_PER_UNIT*1.2).toLocaleString(undefined,{style:'currency',currency:CURRENCY,maximumFractionDigits:0});
  return low+' – '+high;
}
function render(){
  var pct=Math.round((step/3)*100);
  var html='<div class="mw-prog"><div class="mw-prog-bar" style="width:'+pct+'%"></div></div>';
  if(step===1){
    html+='<h2>Get a Quote for '+SERVICE+'</h2><p class="mw-step-lbl">Step 1 of 3 — Select your service type</p><div class="mw-cards">';
    var types=['Basic','Standard','Premium','Enterprise'];
    types.forEach(function(t){html+='<div class="mw-card'+(vals.service_type===t?' sel':'')+'" data-type="'+t+'">'+t+'</div>';});
    html+='</div><div class="mw-btns"><button class="mw-btn-next" id="mw-next-'+W+'">Next &rarr;</button></div>';
  } else if(step===2){
    html+='<h2>Project Details</h2><p class="mw-step-lbl">Step 2 of 3 — Tell us about your project</p>';
    INPUTS.forEach(function(inp){
      html+='<div class="mw-field"><label>'+inp.label+'</label>';
      if(inp.type==='select'&&inp.options){
        html+='<select id="mw-inp-'+inp.id+'">';
        inp.options.forEach(function(o){html+='<option value="'+o+'"'+(vals[inp.id]===o?' selected':'')+'>'+o+'</option>';});
        html+='</select>';
      } else if(inp.type==='range'){
        var rv=vals[inp.id]!==undefined?vals[inp.id]:(inp.min||0);
        html+='<input type="range" id="mw-inp-'+inp.id+'" min="'+(inp.min||0)+'" max="'+(inp.max||100)+'" value="'+rv+'" oninput="document.getElementById(\'mw-rv-'+inp.id+'\').textContent=this.value"/>';
        html+='<span id="mw-rv-'+inp.id+'">'+rv+'</span>';
      } else {
        html+='<input type="number" id="mw-inp-'+inp.id+'" min="'+(inp.min||0)+'" max="'+(inp.max||'')+'" value="'+(vals[inp.id]||inp.min||1)+'"/>';
      }
      html+='</div>';
    });
    html+='<div class="mw-est" id="mw-est-'+W+'">Estimated: '+calcEstimate()+'</div>';
    html+='<div class="mw-btns"><button class="mw-btn-back" id="mw-back-'+W+'">&larr; Back</button><button class="mw-btn-next" id="mw-next-'+W+'">Next &rarr;</button></div>';
  } else if(step===3){
    html+='<h2>Almost Done!</h2><p class="mw-step-lbl">Step 3 of 3 — Where should we send your quote?</p>';
    html+='<div class="mw-field"><label>Your Name</label><input type="text" id="mw-name-'+W+'" value="'+(vals.contact_name||'')+'"/></div>';
    html+='<div class="mw-field"><label>Email Address</label><input type="email" id="mw-email-'+W+'" value="'+(vals.contact_email||'')+'"/></div>';
    html+='<div class="mw-est">Your Estimate: '+calcEstimate()+'</div>';
    html+='<div class="mw-btns"><button class="mw-btn-back" id="mw-back-'+W+'">&larr; Back</button><button class="mw-btn-next" id="mw-next-'+W+'">Get My Quote</button></div>';
  }
  html+='<div class="mw-pw">Powered by <strong>MAVIS AI</strong></div>';
  wrap.innerHTML=html;
  // Bind events
  var nextBtn=document.getElementById('mw-next-'+W);
  var backBtn=document.getElementById('mw-back-'+W);
  if(backBtn)backBtn.addEventListener('click',function(){step--;render();});
  if(step===1){
    wrap.querySelectorAll('.mw-card').forEach(function(c){
      c.addEventListener('click',function(){
        wrap.querySelectorAll('.mw-card').forEach(function(x){x.classList.remove('sel');});
        c.classList.add('sel');
        vals.service_type=c.getAttribute('data-type');
      });
    });
    if(nextBtn)nextBtn.addEventListener('click',function(){if(!vals.service_type){alert('Please select a service type.');return;}step++;render();});
  } else if(step===2){
    INPUTS.forEach(function(inp){
      var el=document.getElementById('mw-inp-'+inp.id);
      if(el)el.addEventListener('input',function(){
        vals[inp.id]=this.value;
        var est=document.getElementById('mw-est-'+W);
        if(est)est.textContent='Estimated: '+calcEstimate();
      });
    });
    if(nextBtn)nextBtn.addEventListener('click',function(){
      INPUTS.forEach(function(inp){var el=document.getElementById('mw-inp-'+inp.id);if(el)vals[inp.id]=el.value;});
      step++;render();
    });
  } else if(step===3){
    if(nextBtn)nextBtn.addEventListener('click',function(){
      var nm=document.getElementById('mw-name-'+W);
      var em=document.getElementById('mw-email-'+W);
      if(nm)vals.contact_name=nm.value;
      if(em)vals.contact_email=em.value;
      if(!vals.contact_email){alert('Please enter your email address.');return;}
      nextBtn.disabled=true;nextBtn.textContent='Getting your quote...';
      fetch(A,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'quote',widget_id:W,service:SERVICE,inputs:vals,estimate:calcEstimate()})
      }).then(function(r){return r.json();}).then(function(d){
        wrap.innerHTML='<div class="mw-success"><div style="font-size:48px;margin-bottom:12px;">🎉</div><h2>Your Quote is Ready!</h2><p style="color:#64748b;">We sent a detailed breakdown to '+vals.contact_email+'</p>'+(d.quote||d.response?'<div class="mw-quote-box">'+(d.quote||d.response)+'</div>':'')+'</div><div class="mw-pw">Powered by <strong>MAVIS AI</strong></div>';
      }).catch(function(){nextBtn.disabled=false;nextBtn.textContent='Get My Quote';alert('Something went wrong. Please try again.');});
    });
  }
}
render();
})();`;
}

// ---------------------------------------------------------------------------
// FAQ Widget
// ---------------------------------------------------------------------------
function generateFaqWidget(widgetId: string, config: WidgetConfig, apiUrl: string): string {
  const color = config.primary_color ?? "#1a56db";
  const faqs: Faq[] = config.faqs ?? [
    { question: "How does this work?", answer: "Our process is simple: reach out, we consult, and we deliver results." },
    { question: "What are your hours?", answer: "We're available Monday–Friday, 9am–6pm." },
  ];
  const faqsJson = JSON.stringify(faqs).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  return `(function(){
var W='${widgetId}',A='${esc(apiUrl)}';
var COLOR='${esc(color)}';
var FAQS=${faqsJson};
var chatHistory=[];
var style=document.createElement('style');
style.textContent='#mw-fq-'+W+'{font-family:system-ui,sans-serif;background:#fff;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.12);padding:32px;max-width:640px;margin:0 auto;}'+
'#mw-fq-'+W+' h2{margin:0 0 16px;font-size:20px;color:#1e293b;}'+
'#mw-fq-'+W+' .mw-search-wrap{position:relative;margin-bottom:20px;}'+
'#mw-fq-'+W+' .mw-search{width:100%;box-sizing:border-box;border:1.5px solid #e2e8f0;border-radius:10px;padding:10px 14px 10px 38px;font-size:14px;outline:none;transition:border-color .2s;}'+
'#mw-fq-'+W+' .mw-search:focus{border-color:'+COLOR+';}'+
'#mw-fq-'+W+' .mw-search-ico{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#94a3b8;font-size:16px;}'+
'#mw-fq-'+W+' .mw-tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;}'+
'#mw-fq-'+W+' .mw-tag{padding:4px 12px;border-radius:20px;border:1.5px solid #e2e8f0;font-size:12px;cursor:pointer;background:#fff;transition:all .2s;}'+
'#mw-fq-'+W+' .mw-tag.active{background:'+COLOR+';color:#fff;border-color:'+COLOR+';}'+
'#mw-fq-'+W+' .mw-acc{border:1.5px solid #e2e8f0;border-radius:10px;overflow:hidden;}'+
'#mw-fq-'+W+' .mw-acc-item{border-bottom:1px solid #e2e8f0;}'+
'#mw-fq-'+W+' .mw-acc-item:last-child{border-bottom:none;}'+
'#mw-fq-'+W+' .mw-acc-q{width:100%;background:#fff;border:none;text-align:left;padding:16px 20px;font-size:14px;font-weight:600;color:#1e293b;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:8px;}'+
'#mw-fq-'+W+' .mw-acc-q:hover{background:#f8fafc;}'+
'#mw-fq-'+W+' .mw-acc-a{max-height:0;overflow:hidden;transition:max-height .3s ease,padding .3s;font-size:14px;color:#374151;line-height:1.6;padding:0 20px;background:#f8fafc;}'+
'#mw-fq-'+W+' .mw-acc-a.open{max-height:400px;padding:14px 20px;}'+
'#mw-fq-'+W+' .mw-chevron{font-size:12px;transition:transform .3s;flex-shrink:0;}'+
'#mw-fq-'+W+' .mw-chevron.open{transform:rotate(180deg);}'+
'#mw-fq-'+W+' .mw-fallback{margin-top:24px;border-top:1px solid #e2e8f0;padding-top:20px;}'+
'#mw-fq-'+W+' .mw-fallback h3{margin:0 0 12px;font-size:15px;color:#1e293b;}'+
'#mw-fq-'+W+' .mw-chat-msgs{background:#f8fafc;border-radius:10px;padding:12px;min-height:60px;max-height:200px;overflow-y:auto;margin-bottom:10px;display:flex;flex-direction:column;gap:8px;}'+
'#mw-fq-'+W+' .mw-cm{max-width:85%;padding:8px 12px;border-radius:10px;font-size:13px;line-height:1.5;}'+
'#mw-fq-'+W+' .mw-cm-bot{background:#e2e8f0;color:#1e293b;align-self:flex-start;}'+
'#mw-fq-'+W+' .mw-cm-usr{background:'+COLOR+';color:#fff;align-self:flex-end;}'+
'#mw-fq-'+W+' .mw-fallback-inp{display:flex;gap:8px;}'+
'#mw-fq-'+W+' .mw-fallback-inp input{flex:1;border:1.5px solid #e2e8f0;border-radius:8px;padding:9px 12px;font-size:13px;outline:none;}'+
'#mw-fq-'+W+' .mw-fallback-inp input:focus{border-color:'+COLOR+';}'+
'#mw-fq-'+W+' .mw-ask-btn{background:'+COLOR+';color:#fff;border:none;border-radius:8px;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;}'+
'#mw-fq-'+W+' .mw-no-results{text-align:center;padding:24px;color:#64748b;font-size:14px;}'+
'#mw-fq-'+W+' .mw-pw{text-align:center;margin-top:16px;font-size:11px;color:#94a3b8;}';
document.head.appendChild(style);
var root=document.getElementById('mavis-widget-'+W)||document.body;
var wrap=document.createElement('div');
wrap.id='mw-fq-'+W;
root.appendChild(wrap);
var activeTag='All';
var query='';
var categories=['All'];
FAQS.forEach(function(f){if(f.category&&categories.indexOf(f.category)===-1)categories.push(f.category);});
function renderFaqs(){
  var filtered=FAQS.filter(function(f){
    var matchQ=!query||f.question.toLowerCase().indexOf(query.toLowerCase())!==-1||f.answer.toLowerCase().indexOf(query.toLowerCase())!==-1;
    var matchT=activeTag==='All'||f.category===activeTag;
    return matchQ&&matchT;
  });
  var tagsHtml=categories.length>1?'<div class="mw-tags">'+categories.map(function(c){return '<button class="mw-tag'+(activeTag===c?' active':'')+'" data-cat="'+c+'">'+c+'</button>';}).join('')+'</div>':'';
  var accHtml=filtered.length===0?'<div class="mw-no-results">No results found. Try asking below.</div>':'<div class="mw-acc">'+filtered.map(function(f,i){
    return '<div class="mw-acc-item"><button class="mw-acc-q" data-idx="'+i+'">'+f.question+'<span class="mw-chevron">&#9660;</span></button><div class="mw-acc-a">'+f.answer+'</div></div>';
  }).join('')+'</div>';
  wrap.innerHTML='<h2>Frequently Asked Questions</h2>'+
    '<div class="mw-search-wrap"><span class="mw-search-ico">&#128269;</span><input class="mw-search" type="text" placeholder="Search questions..." value="'+query+'"/></div>'+
    tagsHtml+accHtml+
    '<div class="mw-fallback"><h3>Didn\'t find your answer?</h3><div class="mw-chat-msgs" id="mw-cmsgs-'+W+'"></div><div class="mw-fallback-inp"><input type="text" id="mw-ask-'+W+'" placeholder="Ask me anything..."/><button class="mw-ask-btn" id="mw-askbtn-'+W+'">Ask AI</button></div></div>'+
    '<div class="mw-pw">Powered by <strong>MAVIS AI</strong></div>';
  // Search
  wrap.querySelector('.mw-search').addEventListener('input',function(){query=this.value;renderFaqs();});
  // Tags
  if(categories.length>1){wrap.querySelectorAll('.mw-tag').forEach(function(t){t.addEventListener('click',function(){activeTag=this.getAttribute('data-cat');renderFaqs();});});}
  // Accordion
  wrap.querySelectorAll('.mw-acc-q').forEach(function(btn){
    btn.addEventListener('click',function(){
      var ans=this.parentElement.querySelector('.mw-acc-a');
      var chev=this.querySelector('.mw-chevron');
      var isOpen=ans.classList.contains('open');
      wrap.querySelectorAll('.mw-acc-a').forEach(function(a){a.classList.remove('open');});
      wrap.querySelectorAll('.mw-chevron').forEach(function(c){c.classList.remove('open');});
      if(!isOpen){ans.classList.add('open');chev.classList.add('open');}
    });
  });
  // AI fallback
  var askInp=document.getElementById('mw-ask-'+W);
  var askBtn=document.getElementById('mw-askbtn-'+W);
  var cmsgs=document.getElementById('mw-cmsgs-'+W);
  function askAI(){
    var q=(askInp.value||'').trim();
    if(!q)return;
    askInp.value='';
    var um=document.createElement('div');um.className='mw-cm mw-cm-usr';um.textContent=q;cmsgs.appendChild(um);cmsgs.scrollTop=cmsgs.scrollHeight;
    chatHistory.push({role:'user',content:q});
    var ld=document.createElement('div');ld.className='mw-cm mw-cm-bot';ld.textContent='…';cmsgs.appendChild(ld);cmsgs.scrollTop=cmsgs.scrollHeight;
    fetch(A,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'faq_fallback',widget_id:W,question:q,history:chatHistory.slice(0,-1)})})
    .then(function(r){return r.json();}).then(function(d){
      ld.textContent=d.response||d.message||'I\'m not sure about that. Please contact us directly.';
      chatHistory.push({role:'assistant',content:ld.textContent});
      if(chatHistory.length>12)chatHistory=chatHistory.slice(chatHistory.length-12);
      cmsgs.scrollTop=cmsgs.scrollHeight;
    }).catch(function(){ld.textContent='Sorry, I could not connect. Please try again.';});
  }
  askBtn.addEventListener('click',askAI);
  askInp.addEventListener('keydown',function(e){if(e.key==='Enter')askAI();});
}
renderFaqs();
})();`;
}

// ---------------------------------------------------------------------------
// ROI Calculator Widget
// ---------------------------------------------------------------------------
function generateRoiCalculatorWidget(widgetId: string, config: WidgetConfig, apiUrl: string): string {
  const color = config.primary_color ?? "#1a56db";
  const roiMetric = esc(config.roi_metric ?? "savings per year");

  const roiInputs: RoiInput[] = config.roi_inputs ?? [
    { id: "employees", label: "Number of Employees", unit: "", default_value: 10 },
    { id: "hours_saved", label: "Hours Saved per Week per Employee", unit: "hrs", default_value: 2 },
    { id: "hourly_rate", label: "Average Hourly Rate ($)", unit: "$", default_value: 50 },
  ];

  const inputsJson = JSON.stringify(roiInputs).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  return `(function(){
var W='${widgetId}',A='${esc(apiUrl)}';
var COLOR='${esc(color)}';
var METRIC='${roiMetric}';
var INPUTS=${inputsJson};
var vals={};
INPUTS.forEach(function(i){vals[i.id]=i.default_value;});
var style=document.createElement('style');
style.textContent='#mw-roi-'+W+'{font-family:system-ui,sans-serif;background:#fff;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.12);padding:32px;max-width:520px;margin:0 auto;}'+
'#mw-roi-'+W+' h2{margin:0 0 6px;font-size:20px;color:#1e293b;}'+
'#mw-roi-'+W+' .mw-sub{color:#64748b;font-size:14px;margin-bottom:24px;}'+
'#mw-roi-'+W+' .mw-field{margin-bottom:20px;}'+
'#mw-roi-'+W+' label{display:flex;justify-content:space-between;font-size:13px;font-weight:600;color:#374151;margin-bottom:8px;}'+
'#mw-roi-'+W+' .mw-val-badge{background:'+COLOR+';color:#fff;border-radius:6px;padding:2px 10px;font-size:13px;}'+
'#mw-roi-'+W+' input[type=range]{width:100%;accent-color:'+COLOR+';cursor:pointer;}'+
'#mw-roi-'+W+' input[type=number]{width:100%;box-sizing:border-box;border:1.5px solid #e2e8f0;border-radius:8px;padding:9px 12px;font-size:14px;outline:none;transition:border-color .2s;}'+
'#mw-roi-'+W+' input[type=number]:focus{border-color:'+COLOR+';}'+
'#mw-roi-'+W+' .mw-result{background:linear-gradient(135deg,'+COLOR+','+COLOR+'cc);border-radius:14px;padding:24px;text-align:center;color:#fff;margin:20px 0;}'+
'#mw-roi-'+W+' .mw-result-lbl{font-size:13px;opacity:.85;margin-bottom:6px;}'+
'#mw-roi-'+W+' .mw-result-val{font-size:36px;font-weight:800;margin-bottom:4px;}'+
'#mw-roi-'+W+' .mw-result-metric{font-size:13px;opacity:.8;}'+
'#mw-roi-'+W+' .mw-bar-wrap{background:rgba(255,255,255,.25);border-radius:4px;height:8px;margin-top:14px;overflow:hidden;}'+
'#mw-roi-'+W+' .mw-bar{height:100%;background:#fff;border-radius:4px;transition:width .6s ease;}'+
'#mw-roi-'+W+' .mw-cta{margin-top:20px;}'+
'#mw-roi-'+W+' .mw-cta-btn{background:'+COLOR+';color:#fff;border:none;border-radius:10px;padding:13px 24px;font-size:15px;font-weight:700;cursor:pointer;width:100%;transition:opacity .2s;}'+
'#mw-roi-'+W+' .mw-cta-btn:hover{opacity:.88;}'+
'#mw-roi-'+W+' .mw-lead-form{margin-top:16px;display:none;}'+
'#mw-roi-'+W+' .mw-lead-form input{width:100%;box-sizing:border-box;border:1.5px solid #e2e8f0;border-radius:8px;padding:9px 12px;font-size:14px;outline:none;margin-bottom:10px;transition:border-color .2s;}'+
'#mw-roi-'+W+' .mw-lead-form input:focus{border-color:'+COLOR+';}'+
'#mw-roi-'+W+' .mw-lead-submit{background:'+COLOR+';color:#fff;border:none;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:700;cursor:pointer;width:100%;}'+
'#mw-roi-'+W+' .mw-ai-resp{background:#f1f5f9;border-left:3px solid '+COLOR+';border-radius:4px;padding:12px 16px;font-size:13px;color:#1e293b;margin-top:12px;line-height:1.6;display:none;}'+
'#mw-roi-'+W+' .mw-pw{text-align:center;margin-top:16px;font-size:11px;color:#94a3b8;}';
document.head.appendChild(style);
var root=document.getElementById('mavis-widget-'+W)||document.body;
var wrap=document.createElement('div');
wrap.id='mw-roi-'+W;
root.appendChild(wrap);
function calcROI(){
  var em=parseFloat(vals.employees)||0;
  var hs=parseFloat(vals.hours_saved)||0;
  var hr=parseFloat(vals.hourly_rate)||0;
  var weekly=em*hs*hr;
  return Math.round(weekly*52);
}
function fmtCurrency(n){return n.toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:0});}
function render(){
  var roi=calcROI();
  var barPct=Math.min(100,Math.round((roi/500000)*100));
  var fHtml=INPUTS.map(function(inp){
    return '<div class="mw-field"><label>'+inp.label+' <span class="mw-val-badge" id="mw-badge-'+inp.id+'">'+(inp.unit?inp.unit+' ':'')+vals[inp.id]+'</span></label>'+
      '<input type="range" id="mw-r-'+inp.id+'" min="1" max="'+(inp.id==='employees'?500:inp.id==='hours_saved'?40:500)+'" value="'+vals[inp.id]+'"/></div>';
  }).join('');
  wrap.innerHTML='<h2>Calculate Your ROI</h2><p class="mw-sub">See how much value we can deliver for your business.</p>'+
    fHtml+
    '<div class="mw-result"><div class="mw-result-lbl">Your estimated</div><div class="mw-result-val" id="mw-rval-'+W+'">'+fmtCurrency(roi)+'</div><div class="mw-result-metric">'+METRIC+'</div><div class="mw-bar-wrap"><div class="mw-bar" id="mw-rbar-'+W+'" style="width:'+barPct+'%"></div></div></div>'+
    '<div class="mw-cta"><button class="mw-cta-btn" id="mw-ctabtn-'+W+'">Get My Custom ROI Analysis &rarr;</button></div>'+
    '<div class="mw-lead-form" id="mw-lead-'+W+'"><input type="text" id="mw-lname-'+W+'" placeholder="Your name"/><input type="email" id="mw-lemail-'+W+'" placeholder="Email address"/><button class="mw-lead-submit" id="mw-lsub-'+W+'">Send My Analysis</button></div>'+
    '<div class="mw-ai-resp" id="mw-airesp-'+W+'"></div>'+
    '<div class="mw-pw">Powered by <strong>MAVIS AI</strong></div>';
  // Bind sliders
  INPUTS.forEach(function(inp){
    var slider=document.getElementById('mw-r-'+inp.id);
    if(slider){
      slider.addEventListener('input',function(){
        vals[inp.id]=parseFloat(this.value);
        var badge=document.getElementById('mw-badge-'+inp.id);
        if(badge)badge.textContent=(inp.unit?inp.unit+' ':'')+vals[inp.id];
        var newRoi=calcROI();
        var rval=document.getElementById('mw-rval-'+W);
        var rbar=document.getElementById('mw-rbar-'+W);
        if(rval)rval.textContent=fmtCurrency(newRoi);
        if(rbar)rbar.style.width=Math.min(100,Math.round((newRoi/500000)*100))+'%';
      });
    }
  });
  // CTA
  var ctaBtn=document.getElementById('mw-ctabtn-'+W);
  var leadForm=document.getElementById('mw-lead-'+W);
  if(ctaBtn&&leadForm)ctaBtn.addEventListener('click',function(){leadForm.style.display='block';ctaBtn.style.display='none';document.getElementById('mw-lname-'+W).focus();});
  // Lead submit
  var lsub=document.getElementById('mw-lsub-'+W);
  if(lsub)lsub.addEventListener('click',function(){
    var nm=(document.getElementById('mw-lname-'+W)||{}).value||'';
    var em=(document.getElementById('mw-lemail-'+W)||{}).value||'';
    if(!em){alert('Please enter your email.');return;}
    lsub.disabled=true;lsub.textContent='Analyzing...';
    fetch(A,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'roi_analysis',widget_id:W,name:nm,email:em,inputs:vals,roi:calcROI(),metric:METRIC})})
    .then(function(r){return r.json();}).then(function(d){
      var ar=document.getElementById('mw-airesp-'+W);
      if(ar){ar.style.display='block';ar.textContent=d.analysis||d.response||'Thank you! We\'ll send your full ROI report to '+em+' shortly.';}
      if(leadForm)leadForm.style.display='none';
    }).catch(function(){lsub.disabled=false;lsub.textContent='Send My Analysis';alert('Something went wrong. Please try again.');});
  });
}
render();
})();`;
}

// ---------------------------------------------------------------------------
// Appointment Booker Widget
// ---------------------------------------------------------------------------
function generateAppointmentBookerWidget(widgetId: string, config: WidgetConfig, apiUrl: string): string {
  const color = config.primary_color ?? "#1a56db";
  const services: string[] = config.service_options ?? ["Consultation", "Strategy Session", "Demo"];
  const calendarUrl = config.calendar_url ?? "";
  const servicesJson = JSON.stringify(services).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  return `(function(){
var W='${widgetId}',A='${esc(apiUrl)}';
var COLOR='${esc(color)}';
var SERVICES=${servicesJson};
var CAL_URL='${esc(calendarUrl)}';
var step=1;
var sel={service:'',date:'',time:'',name:'',email:'',phone:''};
var TIME_SLOTS=['9:00 AM','9:30 AM','10:00 AM','10:30 AM','11:00 AM','11:30 AM','1:00 PM','1:30 PM','2:00 PM','2:30 PM','3:00 PM','3:30 PM','4:00 PM'];
var style=document.createElement('style');
style.textContent='#mw-ab-'+W+'{font-family:system-ui,sans-serif;background:#fff;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.12);padding:32px;max-width:520px;margin:0 auto;}'+
'#mw-ab-'+W+' .mw-prog{height:4px;background:#e2e8f0;border-radius:2px;margin-bottom:24px;overflow:hidden;}'+
'#mw-ab-'+W+' .mw-prog-bar{height:100%;background:'+COLOR+';border-radius:2px;transition:width .3s;}'+
'#mw-ab-'+W+' h2{margin:0 0 6px;font-size:20px;color:#1e293b;}'+
'#mw-ab-'+W+' .mw-step-lbl{font-size:12px;color:#64748b;margin-bottom:20px;}'+
'#mw-ab-'+W+' .mw-svc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-bottom:20px;}'+
'#mw-ab-'+W+' .mw-svc-card{border:2px solid #e2e8f0;border-radius:12px;padding:18px 12px;cursor:pointer;text-align:center;transition:border-color .2s,background .2s;font-size:14px;font-weight:600;color:#374151;}'+
'#mw-ab-'+W+' .mw-svc-card.sel,#mw-ab-'+W+' .mw-svc-card:hover{border-color:'+COLOR+';background:#eff6ff;color:'+COLOR+';}'+
'#mw-ab-'+W+' .mw-date-input{width:100%;box-sizing:border-box;border:1.5px solid #e2e8f0;border-radius:8px;padding:10px 12px;font-size:14px;outline:none;margin-bottom:16px;transition:border-color .2s;}'+
'#mw-ab-'+W+' .mw-date-input:focus{border-color:'+COLOR+';}'+
'#mw-ab-'+W+' .mw-time-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:20px;}'+
'#mw-ab-'+W+' .mw-slot{border:1.5px solid #e2e8f0;border-radius:8px;padding:10px;text-align:center;font-size:13px;cursor:pointer;transition:all .2s;color:#374151;}'+
'#mw-ab-'+W+' .mw-slot.sel,#mw-ab-'+W+' .mw-slot:hover{border-color:'+COLOR+';background:#eff6ff;color:'+COLOR+';font-weight:600;}'+
'#mw-ab-'+W+' .mw-field{margin-bottom:14px;}'+
'#mw-ab-'+W+' label{display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:5px;}'+
'#mw-ab-'+W+' .mw-input{width:100%;box-sizing:border-box;border:1.5px solid #e2e8f0;border-radius:8px;padding:9px 12px;font-size:14px;outline:none;transition:border-color .2s;}'+
'#mw-ab-'+W+' .mw-input:focus{border-color:'+COLOR+';}'+
'#mw-ab-'+W+' .mw-btns{display:flex;gap:10px;margin-top:8px;}'+
'#mw-ab-'+W+' .mw-btn-back{flex:1;border:1.5px solid #e2e8f0;background:#fff;color:#374151;border-radius:10px;padding:11px;font-size:14px;font-weight:600;cursor:pointer;}'+
'#mw-ab-'+W+' .mw-btn-next{flex:2;background:'+COLOR+';color:#fff;border:none;border-radius:10px;padding:11px;font-size:14px;font-weight:700;cursor:pointer;}'+
'#mw-ab-'+W+' .mw-btn-next:hover{opacity:.88;}'+
'#mw-ab-'+W+' .mw-confirm{text-align:center;padding:8px 0;}'+
'#mw-ab-'+W+' .mw-confirm-box{background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;padding:20px;margin:16px 0;text-align:left;font-size:14px;color:#166534;line-height:1.7;}'+
'#mw-ab-'+W+' .mw-cal-btn{background:'+COLOR+';color:#fff;border:none;border-radius:10px;padding:12px 24px;font-size:15px;font-weight:700;cursor:pointer;width:100%;margin-top:12px;text-decoration:none;display:block;text-align:center;}'+
'#mw-ab-'+W+' .mw-ai-msg{background:#f1f5f9;border-left:3px solid '+COLOR+';border-radius:4px;padding:12px 16px;font-size:13px;color:#1e293b;margin-top:12px;line-height:1.6;}'+
'#mw-ab-'+W+' .mw-pw{text-align:center;margin-top:16px;font-size:11px;color:#94a3b8;}';
document.head.appendChild(style);
var root=document.getElementById('mavis-widget-'+W)||document.body;
var wrap=document.createElement('div');
wrap.id='mw-ab-'+W;
root.appendChild(wrap);
function getTodayStr(){var d=new Date();return d.toISOString().split('T')[0];}
function render(){
  var pct=Math.round((step/4)*100);
  var html='<div class="mw-prog"><div class="mw-prog-bar" style="width:'+pct+'%"></div></div>';
  if(step===1){
    html+='<h2>Book an Appointment</h2><p class="mw-step-lbl">Step 1 of 4 — Select a service</p>';
    html+='<div class="mw-svc-grid">'+SERVICES.map(function(s){return '<div class="mw-svc-card'+(sel.service===s?' sel':'')+'" data-svc="'+s+'">'+s+'</div>';}).join('')+'</div>';
    html+='<div class="mw-btns"><button class="mw-btn-next" id="mw-next-'+W+'">Next &rarr;</button></div>';
  } else if(step===2){
    html+='<h2>Choose Date &amp; Time</h2><p class="mw-step-lbl">Step 2 of 4 — Pick a date and time slot</p>';
    html+='<label>Select Date</label><input class="mw-date-input" type="date" id="mw-date-'+W+'" min="'+getTodayStr()+'" value="'+(sel.date||getTodayStr())+'"/>';
    html+='<label>Available Times</label><div class="mw-time-grid">'+TIME_SLOTS.map(function(t){return '<div class="mw-slot'+(sel.time===t?' sel':'')+'" data-time="'+t+'">'+t+'</div>';}).join('')+'</div>';
    html+='<div class="mw-btns"><button class="mw-btn-back" id="mw-back-'+W+'">&larr; Back</button><button class="mw-btn-next" id="mw-next-'+W+'">Next &rarr;</button></div>';
  } else if(step===3){
    html+='<h2>Your Details</h2><p class="mw-step-lbl">Step 3 of 4 — Contact information</p>';
    html+='<div class="mw-field"><label>Full Name</label><input class="mw-input" type="text" id="mw-nm-'+W+'" value="'+(sel.name||'')+'"/></div>';
    html+='<div class="mw-field"><label>Email Address</label><input class="mw-input" type="email" id="mw-em-'+W+'" value="'+(sel.email||'')+'"/></div>';
    html+='<div class="mw-field"><label>Phone (optional)</label><input class="mw-input" type="tel" id="mw-ph-'+W+'" value="'+(sel.phone||'')+'"/></div>';
    html+='<div class="mw-btns"><button class="mw-btn-back" id="mw-back-'+W+'">&larr; Back</button><button class="mw-btn-next" id="mw-next-'+W+'">Confirm Booking</button></div>';
  } else if(step===4){
    html+='<div class="mw-confirm"><div style="font-size:56px;margin-bottom:10px;">📅</div><h2>Booking Confirmed!</h2>';
    html+='<div class="mw-confirm-box"><strong>Service:</strong> '+sel.service+'<br><strong>Date:</strong> '+sel.date+'<br><strong>Time:</strong> '+sel.time+'<br><strong>Name:</strong> '+sel.name+'<br><strong>Email:</strong> '+sel.email+'</div>';
    html+='<div class="mw-ai-msg" id="mw-aimsg-'+W+'">Generating your confirmation…</div>';
    if(CAL_URL){html+='<a href="'+CAL_URL+'" target="_blank" class="mw-cal-btn">Add to Calendar</a>';}
    html+='</div>';
    // Trigger API call for AI confirmation
    setTimeout(function(){
      fetch(A,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'book_appointment',widget_id:W,service:sel.service,date:sel.date,time:sel.time,name:sel.name,email:sel.email,phone:sel.phone})})
      .then(function(r){return r.json();}).then(function(d){
        var am=document.getElementById('mw-aimsg-'+W);
        if(am)am.textContent=d.confirmation||d.message||'We\'ve received your booking and will send a confirmation to '+sel.email+'.';
      }).catch(function(){var am=document.getElementById('mw-aimsg-'+W);if(am)am.textContent='Booking received! A confirmation will be sent to '+sel.email+'.';});
    },400);
  }
  if(step<4)html+='<div class="mw-pw">Powered by <strong>MAVIS AI</strong></div>';
  wrap.innerHTML=html;
  // Bind
  var nextBtn=document.getElementById('mw-next-'+W);
  var backBtn=document.getElementById('mw-back-'+W);
  if(backBtn)backBtn.addEventListener('click',function(){step--;render();});
  if(step===1){
    wrap.querySelectorAll('.mw-svc-card').forEach(function(c){
      c.addEventListener('click',function(){wrap.querySelectorAll('.mw-svc-card').forEach(function(x){x.classList.remove('sel');});c.classList.add('sel');sel.service=c.getAttribute('data-svc');});
    });
    if(nextBtn)nextBtn.addEventListener('click',function(){if(!sel.service){alert('Please select a service.');return;}step++;render();});
  } else if(step===2){
    var di=document.getElementById('mw-date-'+W);
    if(di){di.value=sel.date||getTodayStr();di.addEventListener('change',function(){sel.date=this.value;});}
    wrap.querySelectorAll('.mw-slot').forEach(function(s){
      s.addEventListener('click',function(){wrap.querySelectorAll('.mw-slot').forEach(function(x){x.classList.remove('sel');});s.classList.add('sel');sel.time=s.getAttribute('data-time');});
    });
    if(nextBtn)nextBtn.addEventListener('click',function(){
      if(di)sel.date=di.value;
      if(!sel.date){alert('Please select a date.');return;}
      if(!sel.time){alert('Please select a time slot.');return;}
      step++;render();
    });
  } else if(step===3){
    if(nextBtn)nextBtn.addEventListener('click',function(){
      var nm=document.getElementById('mw-nm-'+W);var em=document.getElementById('mw-em-'+W);var ph=document.getElementById('mw-ph-'+W);
      if(nm)sel.name=nm.value;if(em)sel.email=em.value;if(ph)sel.phone=ph.value;
      if(!sel.name){alert('Please enter your name.');return;}
      if(!sel.email){alert('Please enter your email.');return;}
      step++;render();
    });
  }
}
render();
})();`;
}

// ---------------------------------------------------------------------------
// YouTube Player Widget
// ---------------------------------------------------------------------------

function extractYouTubeId(urlOrId: string): { videoId: string; playlistId: string } {
  const s = (urlOrId || "").trim();
  if (!s) return { videoId: "", playlistId: "" };
  // Bare 11-char video ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return { videoId: s, playlistId: "" };
  let videoId = "", playlistId = "";
  try {
    const url = new URL(s.startsWith("http") ? s : `https://${s}`);
    if (url.hostname === "youtu.be") {
      videoId = url.pathname.slice(1).split("/")[0] || "";
    } else if (url.pathname.includes("/embed/")) {
      const part = url.pathname.replace(/.*\/embed\//, "");
      if (part && part !== "videoseries") videoId = part.split("?")[0];
    } else {
      videoId = url.searchParams.get("v") || "";
    }
    playlistId = url.searchParams.get("list") || "";
  } catch { /* ignore non-URL strings */ }
  return { videoId: videoId.slice(0, 20), playlistId: playlistId.slice(0, 60) };
}

function generateYouTubePlayerWidget(widgetId: string, config: WidgetConfig): string {
  const raw = config.youtube_url ?? config.youtube_video_id ?? "";
  const { videoId, playlistId: parsedPlaylistId } = extractYouTubeId(raw);
  const playlistId = config.youtube_playlist_id?.trim() || parsedPlaylistId;

  if (!videoId && !playlistId) {
    return `(function(){console.warn('[MAVIS] YouTube widget ${widgetId}: no valid video URL or ID provided');})();`;
  }

  const title = esc(config.video_title ?? "");
  const desc  = esc(config.video_description ?? "");
  const autoplay     = config.autoplay ? 1 : 0;
  const muted        = (config.autoplay || config.muted) ? 1 : 0; // autoplay requires mute
  const loop         = config.loop ? 1 : 0;
  const controls     = config.show_controls !== false ? 1 : 0;
  const showYtBtn    = config.show_youtube_button !== false ? "true" : "false";
  const safeVideoId  = esc(videoId);
  const safeListId   = esc(playlistId);

  return `(function(){
var W='${widgetId}';
var VID='${safeVideoId}';
var LIST='${safeListId}';
var TITLE='${title}';
var DESC='${desc}';
var AUTOPLAY=${autoplay};
var MUTED=${muted};
var LOOP=${loop};
var CTRL=${controls};
var SHOW_YT=${showYtBtn};
// Build the embed URL query string
var p=[];
if(AUTOPLAY)p.push('autoplay=1');
if(MUTED)p.push('mute=1');
if(LOOP&&VID)p.push('loop=1','playlist='+VID);
p.push('controls='+CTRL,'rel=0','modestbranding=1');
var qs=p.join('&');
var embedUrl=(!VID&&LIST)
  ?'https://www.youtube.com/embed/videoseries?list='+LIST+'&'+qs
  :'https://www.youtube.com/embed/'+VID+'?'+qs;
var watchUrl=(!VID&&LIST)
  ?'https://www.youtube.com/playlist?list='+LIST
  :'https://www.youtube.com/watch?v='+VID;
// Styles
var s=document.createElement('style');
s.textContent=
  '#mw-yt-'+W+'{font-family:system-ui,sans-serif;max-width:100%;margin:0 auto;}'+
  '#mw-yt-'+W+' .yt-hdr{margin-bottom:10px;}'+
  '#mw-yt-'+W+' .yt-ttl{font-size:18px;font-weight:700;color:#1e293b;margin:0 0 4px;}'+
  '#mw-yt-'+W+' .yt-dsc{font-size:14px;color:#64748b;margin:0;line-height:1.55;}'+
  '#mw-yt-'+W+' .yt-wrap{position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:12px;background:#000;box-shadow:0 4px 24px rgba(0,0,0,.18);}'+
  '#mw-yt-'+W+' .yt-wrap iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:none;border-radius:12px;}'+
  '#mw-yt-'+W+' .yt-ftr{display:flex;align-items:center;justify-content:space-between;margin-top:10px;flex-wrap:wrap;gap:8px;}'+
  '#mw-yt-'+W+' .yt-btn{display:inline-flex;align-items:center;gap:6px;background:#FF0000;color:#fff;border:none;border-radius:8px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:opacity .2s;line-height:1;}'+
  '#mw-yt-'+W+' .yt-btn:hover{opacity:.85;}'+
  '#mw-yt-'+W+' .yt-pw{font-size:11px;color:#94a3b8;}';
document.head.appendChild(s);
// Root element
var root=document.getElementById('mavis-widget-'+W)||document.body;
var wrap=document.createElement('div');
wrap.id='mw-yt-'+W;
var html='';
if(TITLE||DESC){
  html+='<div class="yt-hdr">';
  if(TITLE)html+='<p class="yt-ttl">'+TITLE+'</p>';
  if(DESC)html+='<p class="yt-dsc">'+DESC+'</p>';
  html+='</div>';
}
html+='<div class="yt-wrap"><iframe src="'+embedUrl+'" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy" title="'+(TITLE||'Video player')+'"></iframe></div>';
html+='<div class="yt-ftr">';
if(SHOW_YT){
  html+='<a href="'+watchUrl+'" target="_blank" rel="noopener noreferrer" class="yt-btn">';
  html+='<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>';
  html+=(LIST&&!VID?'View Playlist':'Watch on YouTube');
  html+='</a>';
}
html+='<span class="yt-pw">Powered by <strong>MAVIS</strong></span>';
html+='</div>';
wrap.innerHTML=html;
root.appendChild(wrap);
})();`;
}

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

function getMonthlyPrice(type: string): number {
  const prices: Record<string, number> = {
    chat: 9700,
    lead_capture: 4900,
    quote_calculator: 7900,
    faq: 4900,
    roi_calculator: 7900,
    appointment_booker: 9700,
    youtube_player: 2900,
  };
  return prices[type] ?? 4900;
}

function generatePreviewHtml(widgetId: string, publicUrl: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;background:#f8fafc;min-height:200px"><script src="${publicUrl}" defer></script></body></html>`;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { action, widget_type, widget_id, config, user_id, project_id, business_context } = body;

    if (action === "list_types") {
      return new Response(
        JSON.stringify({
          types: [
            { id: "chat", name: "AI Chat Assistant", description: "Floating chat bubble powered by MAVIS AI", icon: "💬", monthly_price: 97 },
            { id: "lead_capture", name: "Smart Lead Capture", description: "AI-powered form with instant personalized responses", icon: "📋", monthly_price: 49 },
            { id: "quote_calculator", name: "Quote Calculator", description: "Interactive pricing estimator with AI quotes", icon: "💰", monthly_price: 79 },
            { id: "faq", name: "FAQ + AI Fallback", description: "Searchable FAQ with AI question answering", icon: "❓", monthly_price: 49 },
            { id: "roi_calculator", name: "ROI Calculator", description: "Business value calculator with AI analysis", icon: "📈", monthly_price: 79 },
            { id: "appointment_booker", name: "Appointment Booker", description: "Service booking with AI confirmation", icon: "📅", monthly_price: 97 },
            { id: "youtube_player", name: "YouTube Player", description: "Responsive video or playlist embed — no hosting required", icon: "▶️", monthly_price: 29 },
          ],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "generate") {
      const wId: string = widget_id ?? crypto.randomUUID().replace(/-/g, "").slice(0, 12);

      // Generate widget JavaScript
      let widgetJs = "";
      switch (widget_type) {
        case "chat":
          widgetJs = generateChatWidget(wId, config, WIDGET_API_URL);
          break;
        case "lead_capture":
          widgetJs = generateLeadCaptureWidget(wId, config, WIDGET_API_URL);
          break;
        case "quote_calculator":
          widgetJs = generateQuoteCalculatorWidget(wId, config, WIDGET_API_URL);
          break;
        case "faq":
          widgetJs = generateFaqWidget(wId, config, WIDGET_API_URL);
          break;
        case "roi_calculator":
          widgetJs = generateRoiCalculatorWidget(wId, config, WIDGET_API_URL);
          break;
        case "appointment_booker":
          widgetJs = generateAppointmentBookerWidget(wId, config, WIDGET_API_URL);
          break;
        case "youtube_player":
          widgetJs = generateYouTubePlayerWidget(wId, config);
          break;
        default:
          throw new Error(`Unknown widget type: ${widget_type}`);
      }

      // Upload to Supabase Storage
      const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      const filePath = `${wId}/widget.js`;

      const { error: uploadErr } = await sb.storage
        .from("widgets")
        .upload(filePath, new Blob([widgetJs], { type: "application/javascript" }), {
          contentType: "application/javascript",
          cacheControl: "3600",
          upsert: true,
        });

      if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

      const {
        data: { publicUrl },
      } = sb.storage.from("widgets").getPublicUrl(filePath);

      // Generate embed code snippets
      const scriptEmbed = `<script src="${publicUrl}" defer></script>`;
      const divEmbed = `<div id="mavis-widget-${wId}"></div>\n<script src="${publicUrl}" defer></script>`;
      const wordpressShortcode = `[mavis_widget id="${wId}"]`;

      // Store widget record in DB
      if (user_id) {
        await sb.from("widget_instances").upsert({
          id: wId,
          user_id,
          project_id: project_id ?? null,
          widget_type,
          config,
          business_context: business_context ?? null,
          public_url: publicUrl,
          status: "active",
          monthly_price_cents: getMonthlyPrice(widget_type),
        });
      }

      return new Response(
        JSON.stringify({
          success: true,
          widget_id: wId,
          widget_type,
          public_url: publicUrl,
          embed: {
            script: scriptEmbed,
            div: divEmbed,
            wordpress_shortcode: wordpressShortcode,
          },
          preview_html: generatePreviewHtml(wId, publicUrl),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
