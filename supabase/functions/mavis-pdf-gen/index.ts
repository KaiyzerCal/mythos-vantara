// MAVIS PDF Generator — renders professional PDFs from templates or raw HTML.
// Requires BROWSER_URL (browser-server/Dockerfile) with /pdf endpoint.
// Set: BROWSER_URL=http://your-server:3000

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BROWSER_URL = Deno.env.get("BROWSER_URL") ?? "";
const SB_URL      = Deno.env.get("SUPABASE_URL")!;
const SB_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ── Templates ─────────────────────────────────────────────────────────────────

function renderInvoice(d: Record<string, unknown>): string {
  const items = (d.items as { description: string; qty: number; price: number }[] | undefined) ?? [];
  const subtotal = items.reduce((s, i) => s + i.qty * i.price, 0);
  const tax = Number(d.tax_rate ?? 0);
  const total = subtotal * (1 + tax / 100);
  const rows = items.map((i) =>
    `<tr><td>${i.description}</td><td>${i.qty}</td><td>$${i.price.toFixed(2)}</td><td>$${(i.qty * i.price).toFixed(2)}</td></tr>`
  ).join("");
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{font-family:'Helvetica Neue',sans-serif;color:#1a1a2e;margin:0;padding:40px}
    .header{display:flex;justify-content:space-between;border-bottom:3px solid #6c47ff;padding-bottom:20px;margin-bottom:30px}
    .company{font-size:24px;font-weight:700;color:#6c47ff}
    .invoice-meta{text-align:right;font-size:13px;color:#666}
    .invoice-meta h2{font-size:28px;color:#1a1a2e;margin:0 0 8px}
    .parties{display:flex;justify-content:space-between;margin-bottom:30px}
    .party label{font-size:11px;text-transform:uppercase;color:#999;letter-spacing:1px}
    .party p{margin:4px 0;font-size:14px}
    table{width:100%;border-collapse:collapse;margin:20px 0}
    thead tr{background:#6c47ff;color:#fff}
    th{padding:10px 12px;text-align:left;font-size:13px}
    td{padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:13px}
    tr:nth-child(even){background:#faf8ff}
    .totals{display:flex;justify-content:flex-end}
    .totals-box{min-width:250px}
    .totals-box .row{display:flex;justify-content:space-between;padding:6px 0;font-size:14px}
    .totals-box .total{border-top:2px solid #6c47ff;font-weight:700;font-size:16px;color:#6c47ff}
    .notes{margin-top:30px;padding:15px;background:#faf8ff;border-radius:8px;font-size:13px;color:#666}
    .footer{text-align:center;margin-top:40px;font-size:12px;color:#aaa;border-top:1px solid #eee;padding-top:20px}
  </style></head><body>
    <div class="header">
      <div><div class="company">${d.company_name ?? "Your Company"}</div><div style="font-size:13px;color:#666;margin-top:4px">${d.company_address ?? ""}</div></div>
      <div class="invoice-meta"><h2>INVOICE</h2><div>#${d.invoice_number ?? "001"}</div><div>Date: ${d.date ?? new Date().toLocaleDateString()}</div><div>Due: ${d.due_date ?? "Net 30"}</div></div>
    </div>
    <div class="parties">
      <div class="party"><label>Bill To</label><p><strong>${d.client_name ?? "Client Name"}</strong></p><p>${d.client_email ?? ""}</p><p>${d.client_address ?? ""}</p></div>
    </div>
    <table><thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="totals"><div class="totals-box">
      <div class="row"><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>
      ${tax ? `<div class="row"><span>Tax (${tax}%)</span><span>$${(subtotal * tax / 100).toFixed(2)}</span></div>` : ""}
      <div class="row total"><span>Total</span><span>$${total.toFixed(2)}</span></div>
    </div></div>
    ${d.notes ? `<div class="notes"><strong>Notes:</strong> ${d.notes}</div>` : ""}
    <div class="footer">Thank you for your business!</div>
  </body></html>`;
}

function renderReport(d: Record<string, unknown>): string {
  const sections = (d.sections as { heading: string; content: string }[] | undefined) ?? [];
  const sectionHtml = sections.map((s) =>
    `<div class="section"><h3>${s.heading}</h3><p>${s.content.replace(/\n/g, "</p><p>")}</p></div>`
  ).join("");
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{font-family:'Georgia',serif;color:#1a1a2e;margin:0;padding:50px;max-width:780px;margin:auto}
    .cover{text-align:center;padding:60px 0 40px;border-bottom:3px solid #6c47ff;margin-bottom:40px}
    .cover h1{font-size:32px;color:#6c47ff;margin:0 0 10px}
    .cover .subtitle{font-size:16px;color:#666;margin:0 0 20px}
    .cover .meta{font-size:13px;color:#999}
    .section{margin-bottom:30px}
    h3{font-size:18px;color:#6c47ff;border-left:4px solid #6c47ff;padding-left:12px;margin:0 0 10px}
    p{font-size:14px;line-height:1.8;color:#333;margin:0 0 12px}
    .sources{margin-top:30px;padding:20px;background:#faf8ff;border-radius:8px}
    .sources h3{border:none;padding:0;margin-bottom:12px}
    .sources li{font-size:13px;margin:6px 0;color:#666}
    .footer{text-align:center;margin-top:40px;font-size:12px;color:#aaa;border-top:1px solid #eee;padding-top:20px}
  </style></head><body>
    <div class="cover"><h1>${d.title ?? "Research Report"}</h1><div class="subtitle">${d.subtitle ?? ""}</div><div class="meta">Prepared by MAVIS · ${d.date ?? new Date().toLocaleDateString()}</div></div>
    ${d.summary ? `<div class="section"><h3>Executive Summary</h3><p>${String(d.summary).replace(/\n/g, "</p><p>")}</p></div>` : ""}
    ${sectionHtml}
    ${d.sources ? `<div class="sources"><h3>Sources</h3><ol>${(d.sources as string[]).map((s) => `<li>${s}</li>`).join("")}</ol></div>` : ""}
    <div class="footer">Generated by MAVIS · Confidential</div>
  </body></html>`;
}

function renderProposal(d: Record<string, unknown>): string {
  const deliverables = (d.deliverables as string[] | undefined) ?? [];
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{font-family:'Helvetica Neue',sans-serif;color:#1a1a2e;margin:0;padding:50px;max-width:780px;margin:auto}
    .header{background:linear-gradient(135deg,#6c47ff,#a855f7);color:#fff;padding:50px;border-radius:16px;margin-bottom:40px;text-align:center}
    .header h1{font-size:34px;margin:0 0 8px}
    .header p{opacity:.85;font-size:15px;margin:0}
    section{margin-bottom:30px}
    h2{font-size:20px;color:#6c47ff;border-bottom:2px solid #f0f0f0;padding-bottom:8px}
    p,li{font-size:14px;line-height:1.8;color:#333}
    ul{padding-left:20px}
    .pricing{background:#faf8ff;border:2px solid #6c47ff;border-radius:12px;padding:24px;text-align:center;margin:20px 0}
    .pricing .amount{font-size:42px;font-weight:700;color:#6c47ff}
    .pricing .label{color:#999;font-size:14px}
    .cta{background:#1a1a2e;color:#fff;padding:24px;border-radius:12px;text-align:center;margin-top:40px}
    .footer{text-align:center;margin-top:30px;font-size:12px;color:#aaa}
  </style></head><body>
    <div class="header"><h1>${d.title ?? "Project Proposal"}</h1><p>${d.tagline ?? "Prepared for " + (d.client_name ?? "You")}</p><p style="margin-top:8px;opacity:.7">${d.date ?? new Date().toLocaleDateString()}</p></div>
    ${d.overview ? `<section><h2>Overview</h2><p>${String(d.overview).replace(/\n/g, "</p><p>")}</p></section>` : ""}
    ${deliverables.length ? `<section><h2>Deliverables</h2><ul>${deliverables.map((d) => `<li>${d}</li>`).join("")}</ul></section>` : ""}
    ${d.timeline ? `<section><h2>Timeline</h2><p>${d.timeline}</p></section>` : ""}
    ${d.investment ? `<div class="pricing"><div class="label">Investment</div><div class="amount">${d.investment}</div>${d.payment_terms ? `<div class="label" style="margin-top:8px">${d.payment_terms}</div>` : ""}</div>` : ""}
    ${d.terms ? `<section><h2>Terms & Conditions</h2><p>${d.terms}</p></section>` : ""}
    <div class="cta"><p style="color:#aaa;font-size:13px;margin:0 0 8px">Ready to get started?</p><p style="color:#fff;font-size:15px;margin:0">${d.contact_email ?? ""}</p></div>
    <div class="footer">Created by MAVIS · ${d.company_name ?? ""}</div>
  </body></html>`;
}

const TEMPLATES: Record<string, (d: Record<string, unknown>) => string> = {
  invoice: renderInvoice,
  report: renderReport,
  proposal: renderProposal,
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(SB_URL, SB_KEY);
    const { data: { user }, error } = await sb.auth.getUser(auth.replace("Bearer ", ""));
    if (error || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!BROWSER_URL) {
      return new Response(JSON.stringify({ error: "PDF generation requires BROWSER_URL. Deploy browser-server/Dockerfile and set the secret." }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const template = String(body.template ?? "").toLowerCase();
    const data     = (body.data ?? {}) as Record<string, unknown>;
    const html     = body.html ? String(body.html) : TEMPLATES[template]?.(data);

    if (!html) {
      return new Response(JSON.stringify({ error: `Unknown template "${template}". Available: ${Object.keys(TEMPLATES).join(", ")}. Or pass html directly.` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pdfRes = await fetch(`${BROWSER_URL}/pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html, options: body.options ?? {} }),
      signal: AbortSignal.timeout(45000),
    });

    if (!pdfRes.ok) {
      const err = await pdfRes.text();
      throw new Error(`PDF server error ${pdfRes.status}: ${err.slice(0, 200)}`);
    }

    const pdfBytes  = await pdfRes.arrayBuffer();
    const pdfBase64 = base64Encode(pdfBytes);

    // Optionally upload to Supabase storage
    let storageUrl: string | undefined;
    if (body.save_to_storage) {
      const filename = `pdf/${user.id}/${Date.now()}_${template || "document"}.pdf`;
      const { data: uploaded } = await sb.storage
        .from("mavis-files")
        .upload(filename, pdfBytes, { contentType: "application/pdf", upsert: true });
      if (uploaded) {
        const { data: { publicUrl } } = sb.storage.from("mavis-files").getPublicUrl(filename);
        storageUrl = publicUrl;
      }
    }

    return new Response(
      JSON.stringify({ pdf: pdfBase64, mime: "application/pdf", url: storageUrl }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[mavis-pdf-gen]", e.message);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
