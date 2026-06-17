// mavis-security-scanner
// Website security auditor: HTTP scrape → parallel Claude analysis (HTTP headers + HTML content) →
// A+–F security grade → HTML report → optional Gmail delivery.
// Mirrors n8n: Form URL → HTTP scrape → [Header audit ∥ Vuln audit] → Merge → Grade → HTML → Email.
//
// Actions: scan_website | analyze_headers | analyze_content
//
// scan_website — full pipeline: scrape + dual parallel Claude audit + grade + report + optional email
// analyze_headers — HTTP headers-only config audit
// analyze_content — HTML/JS content vulnerability scan
//
// Requires:
//   ANTHROPIC_API_KEY — Claude analysis (claude-haiku-4-5-20251001 default; sonnet for production)
//   mavis-google-agent with Gmail credentials — for send_to email delivery

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL        = Deno.env.get("SUPABASE_URL")!;
const SB_SRK        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

// ── Security header definitions ───────────────────────────────────────────────

const CRITICAL_HEADERS  = ["Content-Security-Policy", "Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options"];
const IMPORTANT_HEADERS = ["Referrer-Policy", "Permissions-Policy"];
const ALL_SEC_HEADERS   = [
  ...CRITICAL_HEADERS,
  ...IMPORTANT_HEADERS,
  "X-XSS-Protection",
  "Cross-Origin-Embedder-Policy",
  "Cross-Origin-Opener-Policy",
  "X-Permitted-Cross-Domain-Policies",
];

interface HeaderInfo { present: boolean; value: string }
type HeaderStatus = Record<string, HeaderInfo>;

function extractHeaderStatus(raw: Record<string, string>): HeaderStatus {
  const status: HeaderStatus = {};
  for (const h of ALL_SEC_HEADERS) status[h] = { present: false, value: "" };
  for (const [k, v] of Object.entries(raw)) {
    for (const h of ALL_SEC_HEADERS) {
      if (k.toLowerCase() === h.toLowerCase()) status[h] = { present: true, value: v };
    }
  }
  return status;
}

// Port of the n8n Process Audit Results grading algorithm
function determineGrade(status: HeaderStatus): string {
  let critCount = 0, impCount = 0;
  let cspIssue = false;

  for (const h of CRITICAL_HEADERS) {
    if (status[h]?.present) {
      critCount++;
      if (h === "Content-Security-Policy" && status[h].value.includes("unsafe-inline")) cspIssue = true;
    }
  }
  for (const h of IMPORTANT_HEADERS) if (status[h]?.present) impCount++;

  if (critCount === CRITICAL_HEADERS.length) {
    if (impCount === IMPORTANT_HEADERS.length) return cspIssue ? "A-" : "A+";
    if (impCount >= 1) return cspIssue ? "B+" : "A-";
    return cspIssue ? "B" : "B+";
  }
  if (critCount >= CRITICAL_HEADERS.length - 1) return impCount >= 1 ? "B" : "C+";
  if (critCount >= 2) return "C";
  if (critCount >= 1) return "D";
  return "F";
}

function countWarnings(status: HeaderStatus): number {
  let count = 0;
  // Missing non-critical security headers
  count += ALL_SEC_HEADERS.filter(h => !CRITICAL_HEADERS.includes(h) && !status[h]?.present).length;
  // HSTS max-age below 30 days
  const hsts = status["Strict-Transport-Security"];
  if (hsts?.present) {
    const m = hsts.value.match(/max-age=(\d+)/);
    if (m && parseInt(m[1]) < 2_592_000) count++;
  }
  return count;
}

// ── Claude helper ─────────────────────────────────────────────────────────────

async function callClaude(system: string, user: string, model: string): Promise<string> {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 2048, system, messages: [{ role: "user", content: user }] }),
    signal: AbortSignal.timeout(60000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Claude error: ${JSON.stringify(data?.error).slice(0, 200)}`);
  return (data.content?.[0]?.text ?? "").trim();
}

// ── Audit prompts (ported from n8n agent nodes) ───────────────────────────────

const CONFIG_SYSTEM = `You are an elite web security expert specializing in secure configurations.

Analyze the HTTP response headers for security misconfigurations.
Begin by listing ALL security headers that ARE present and their values.
For each header, clearly state whether it is present or missing.

Then present findings in three sections:
## Header Security – Missing or misconfigured security headers
## Cookie Security – Insecure cookie configurations
## Content Security – CSP issues, mixed content

For each finding:
1. A clear description of the misconfiguration
2. The security implications
3. The recommended secure configuration with example code in a code block

For each header entry use this format:
### [Section]
1. **[Header Name]**
   - **Present?** Yes/No
   - **Value:** \`actual-value\`

If no issues in a section, explicitly state that.`;

const VULN_SYSTEM = `You are an elite cybersecurity expert specializing in web application security.

Analyze the HTML and visible content of this webpage for client-side security vulnerabilities.
Focus only on issues detectable from client-side code.

Structure findings as:
## Critical Vulnerabilities – Issues that could lead to immediate compromise
## Information Leakage – Sensitive data exposed in page source
## Client-Side Weaknesses – JavaScript vulnerabilities, XSS opportunities

For each issue:
1. **[Issue Title]**
   - **Description:** clear description
   - **Impact:** potential impact
   - **Recommendation:** specific fix

If no issues found in a section, explicitly state that.`;

// ── Markdown → HTML (for email report) ───────────────────────────────────────

function mdToHtml(md: string): string {
  // Extract code blocks first to protect them from other replacements
  const blocks: string[] = [];
  let out = md.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) => {
    const idx = blocks.length;
    blocks.push(`<pre style="background:#f8f9fa;padding:10px;border-radius:4px;overflow-x:auto;font-family:monospace;font-size:13px;white-space:pre-wrap">${
      code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    }</pre>`);
    return `\x00BLOCK${idx}\x00`;
  });

  // Inline code
  out = out.replace(/`([^`\n]+)`/g, '<code style="background:#f0f0f0;padding:2px 4px;border-radius:3px;font-family:monospace;font-size:13px">$1</code>');

  // Headings
  out = out.replace(/^### (.+)$/gm, '<h3 style="color:#2c3e50;margin:16px 0 6px">$1</h3>');
  out = out.replace(/^## (.+)$/gm,  '<h2 style="color:#2c3e50;margin:20px 0 8px">$1</h2>');
  out = out.replace(/^# (.+)$/gm,   '<h1 style="color:#2c3e50">$1</h1>');

  // Bold / italic
  out = out.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  out = out.replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>');
  out = out.replace(/\*(.+?)\*/g,         '<em>$1</em>');

  // Lists
  out = out.replace(/^\d+\. (.+)$/gm, '<li style="margin:4px 0">$1</li>');
  out = out.replace(/^[-*] (.+)$/gm,  '<li style="list-style:disc;margin:4px 0;margin-left:20px">$1</li>');

  // Paragraphs
  out = out.replace(/\n\n+/g, '</p><p style="margin:8px 0">');
  out = '<p style="margin:8px 0">' + out + '</p>';

  // Restore code blocks
  blocks.forEach((html, i) => { out = out.replace(`\x00BLOCK${i}\x00`, html); });

  return out;
}

// ── HTML report generator (mirrors n8n "convert to HTML" node) ───────────────

function generateReport(data: {
  url:           string;
  grade:         string;
  timestamp:     string;
  headerStatus:  HeaderStatus;
  criticalCount: number;
  warningCount:  number;
  configAudit:   string;
  vulnAudit:     string;
  rawHeaders:    Record<string, string>;
}): string {
  const gradeColor =
    data.grade.startsWith("A") ? "#27AE60" :
    data.grade.startsWith("B") ? "#3498DB" :
    data.grade.startsWith("C") ? "#F39C12" :
    "#E74C3C";

  const safeUrl = data.url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

  const headerBadges = [...CRITICAL_HEADERS, ...IMPORTANT_HEADERS].map(h => {
    const ok  = data.headerStatus[h]?.present;
    const col = ok ? "#27AE60" : "#E74C3C";
    return `<span style="display:inline-block;margin:2px;padding:4px 8px;background:${col};color:#fff;border-radius:4px;font-size:12px">${ok ? "✓" : "✗"} ${h}</span>`;
  }).join("");

  const headerRows = Object.entries(data.rawHeaders).map(([k, v]) => {
    const secH  = ALL_SEC_HEADERS.find(h => h.toLowerCase() === k.toLowerCase());
    const isSec = !!secH;
    const ok    = secH ? data.headerStatus[secH]?.present : false;
    const bg    = isSec ? (ok ? "#E8F5E9" : "#FFEBEE") : "#F8F9FA";
    return `<tr style="background:${bg}">
      <td style="padding:8px;font-family:monospace;font-size:12px;font-weight:bold;white-space:nowrap">${k}</td>
      <td style="padding:8px;font-size:12px;word-break:break-all">${v}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Security Audit — ${safeUrl}</title>
<style>
body{font-family:Arial,sans-serif;margin:0;padding:0;background:#f5f5f5;color:#333}
.wrap{max-width:900px;margin:0 auto;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.12)}
.hdr{background:#2c3e50;color:#fff;padding:24px 20px;text-align:center}
.hdr h1{margin:0;font-size:26px;text-shadow:1px 1px 2px rgba(0,0,0,.4)}
.body{padding:24px}
.box{border-radius:6px;padding:16px;margin-bottom:20px}
.box.summary{background:#EBF5FB}
.box.raw{background:#F5F7FA;border:1px solid #e0e0e0}
.box.find{background:#fff;border:1px solid #e0e0e0}
.box.guide{background:#eafaf1;border-left:4px solid #2ecc71}
h2{color:#2c3e50;margin-top:0}
table{width:100%;border-collapse:collapse}
th{background:#E0E0E0;padding:10px;text-align:left;font-size:13px}
td{vertical-align:top}
.grade{font-size:56px;font-weight:700;width:88px;height:88px;line-height:88px;text-align:center;color:#fff;border-radius:6px}
.footer{text-align:center;padding:16px;font-size:12px;color:#999;border-top:1px solid #eee}
</style>
</head>
<body>
<div class="wrap">
<div class="hdr"><h1>Website Security Audit Report</h1></div>
<div class="body">

<div class="box summary">
<h2>Security Summary</h2>
<table><tr>
<td style="width:106px;padding-right:16px">
  <div class="grade" style="background:${gradeColor}">${data.grade}</div>
</td>
<td>
  <table>
    <tr><td style="padding:4px 8px 4px 0"><strong>Site:</strong></td><td style="padding:4px 0"><a href="${safeUrl}" style="color:#3498db">${safeUrl}</a></td></tr>
    <tr><td style="padding:4px 8px 4px 0"><strong>Scanned:</strong></td><td style="padding:4px 0">${data.timestamp}</td></tr>
    <tr><td style="padding:4px 8px 4px 0"><strong>Critical:</strong></td><td style="padding:4px 0">${data.criticalCount}</td></tr>
    <tr><td style="padding:4px 8px 4px 0"><strong>Warnings:</strong></td><td style="padding:4px 0">${data.warningCount}</td></tr>
    <tr><td style="padding:4px 8px 4px 0;vertical-align:top"><strong>Headers:</strong></td><td style="padding:4px 0">${headerBadges}</td></tr>
  </table>
</td>
</tr></table>
</div>

<div class="box raw">
<h2>Response Headers</h2>
<table>
<thead><tr><th>Header</th><th>Value</th></tr></thead>
<tbody>${headerRows}</tbody>
</table>
<p style="font-size:12px;color:#777;margin-top:8px">Green = security header present · Red = security header missing · White = non-security header</p>
</div>

<div class="box find">
<h2>Security Configuration Audit</h2>
${mdToHtml(data.configAudit)}
</div>

<div class="box find">
<h2>Vulnerability Analysis</h2>
${mdToHtml(data.vulnAudit)}
</div>

<div class="box guide">
<h2>Implementation Guide</h2>
<p>Address findings in order of criticality. Retest after each fix.</p>
<ol>
<li>Add missing critical security headers (CSP, HSTS, X-Content-Type-Options, X-Frame-Options)</li>
<li>Harden cookie attributes: HttpOnly, Secure, SameSite=Strict</li>
<li>Tighten Content Security Policy — remove <code>unsafe-inline</code> where possible</li>
<li>Address identified client-side vulnerabilities in order of impact</li>
<li>Consider a WAF for additional protection layer</li>
</ol>
</div>

</div>
<div class="footer">
<p>Automated client-side security assessment. For comprehensive security, engage a professional penetration tester.</p>
<p>Generated on ${data.timestamp}</p>
</div>
</div>
</body>
</html>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const body       = await req.json().catch(() => ({}));
    const adminSb    = createClient(SB_URL, SB_SRK);
    const authHeader = req.headers.get("Authorization") ?? "";

    let uid: string;
    if (authHeader === `Bearer ${SB_SRK}`) {
      uid = String(body.userId ?? body.user_id ?? "").trim();
      if (!uid) return json({ error: "userId required for service-role calls" }, 400);
    } else if (authHeader.startsWith("Bearer ")) {
      const { data: { user }, error } = await adminSb.auth.getUser(authHeader.replace("Bearer ", ""));
      if (error || !user) return json({ error: "Unauthorized" }, 401);
      uid = user.id;
    } else {
      return json({ error: "Unauthorized" }, 401);
    }

    const action = String(body.action ?? "scan_website");
    const model  = String(body.model  ?? "claude-haiku-4-5-20251001");

    switch (action) {

      case "scan_website": {
        const url = String(body.url ?? body.website_url ?? body.target ?? "");
        if (!url) return json({ error: "url required" }, 400);
        if (!/^https?:\/\//i.test(url)) return json({ error: "url must begin with http:// or https://" }, 400);

        // 1. Scrape the website — capture full response including headers
        const scrapeRes = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36" },
          signal:  AbortSignal.timeout(20000),
          redirect: "follow",
        }).catch(e => { throw new Error(`Failed to fetch ${url}: ${e.message}`); });

        const htmlContent = await scrapeRes.text();
        const rawHeaders: Record<string, string> = {};
        scrapeRes.headers.forEach((v, k) => { rawHeaders[k] = v; });

        // 2. Prepare inputs for parallel analysis
        const formattedHeaders = Object.entries(rawHeaders).map(([k, v]) => `${k}: ${v}`).join("\n");
        const truncatedContent = htmlContent.slice(0, 50_000); // 50KB cap for Claude token budget

        // 3. Parallel dual Claude analysis — mirrors n8n's split-path approach
        const [configAudit, vulnAudit] = await Promise.all([
          callClaude(CONFIG_SYSTEM, `Here are the HTTP response headers:\n\n${formattedHeaders}`, model),
          callClaude(VULN_SYSTEM,   `Here is the content of the webpage:\n\n${truncatedContent}`, model),
        ]);

        // 4. Grade + counts (mirrors n8n Process Audit Results node)
        const headerStatus   = extractHeaderStatus(rawHeaders);
        const grade          = determineGrade(headerStatus);
        const warningCount   = countWarnings(headerStatus);
        const csp            = headerStatus["Content-Security-Policy"];
        const criticalCount  = (csp?.present && csp.value.includes("unsafe-inline")) ? 1 : 0;
        const timestamp      = new Date().toLocaleString("en-US", {
          year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
        });

        // 5. HTML report (mirrors n8n "convert to HTML" node)
        const htmlReport = generateReport({
          url, grade, timestamp, headerStatus, criticalCount, warningCount, configAudit, vulnAudit, rawHeaders,
        });

        const result: Record<string, unknown> = {
          url, grade, timestamp, criticalCount, warningCount,
          header_status: headerStatus,
          config_audit:  configAudit,
          vuln_audit:    vulnAudit,
          html_report:   htmlReport,
        };

        // 6. Optional email delivery via mavis-google-agent
        const sendTo = String(body.send_to ?? body.email ?? "");
        if (sendTo) {
          const emailRes = await fetch(`${SB_URL}/functions/v1/mavis-google-agent`, {
            method:  "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SB_SRK}` },
            body:    JSON.stringify({
              userId:    uid,
              action:    "send_email",
              to:        sendTo,
              subject:   `Website Security Audit — ${url}`,
              body:      `Security audit for ${url}\nGrade: ${grade} | Critical: ${criticalCount} | Warnings: ${warningCount}`,
              html_body: htmlReport,
            }),
            signal: AbortSignal.timeout(15000),
          }).catch(() => null);
          result.email_sent = emailRes?.ok ?? false;
        }

        // 7. Log
        await adminSb.from("mavis_memory").insert({
          user_id:    uid,
          role:       "assistant",
          content:    `[SECURITY SCAN] ${url} → Grade: ${grade} | Critical: ${criticalCount} | Warnings: ${warningCount}`,
          tags:       ["security_scan", "website_audit", "security"],
          importance: 5,
        }).catch(() => {});

        return json(result);
      }

      case "analyze_headers": {
        const headers = body.headers ?? {};
        const formatted = typeof headers === "string"
          ? headers
          : Object.entries(headers as Record<string, string>).map(([k, v]) => `${k}: ${v}`).join("\n");
        const audit        = await callClaude(CONFIG_SYSTEM, `Here are the HTTP response headers:\n\n${formatted}`, model);
        const headerStatus = extractHeaderStatus(typeof headers === "object" ? headers as Record<string, string> : {});
        const grade        = determineGrade(headerStatus);
        return json({ audit, grade, header_status: headerStatus });
      }

      case "analyze_content": {
        const content = String(body.content ?? body.html ?? "").slice(0, 50_000);
        if (!content) return json({ error: "content or html required" }, 400);
        const audit = await callClaude(VULN_SYSTEM, `Here is the content of the webpage:\n\n${content}`, model);
        return json({ audit });
      }

      default:
        return json({
          error: `Unknown action: ${action}. Use: scan_website | analyze_headers | analyze_content`,
        }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-security-scanner]", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
