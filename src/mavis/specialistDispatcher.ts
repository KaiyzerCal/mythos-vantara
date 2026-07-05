// ============================================================
// MAVIS Specialist Dispatcher
// Maps active Agency specialists to real edge function capabilities.
// When a specialist is active, their division-specific tools fire
// instead of (or in addition to) the generic mavis-agent loop.
// ============================================================

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ActiveSpecialist {
  agent_name: string;
  division: string;
  spec_content: string;
}

export interface DispatchResult {
  handled: boolean;
  response?: string;
  loadingLabel?: string;
}

type Route = {
  divisions: string[];   // which specialist divisions this route applies to ("*" = all)
  match: (content: string) => boolean;
  loadingLabel: string;
  invoke: (
    content: string,
    specialist: ActiveSpecialist,
    userId: string,
    supabase: any,
  ) => Promise<string>;
};

// ── Utility ───────────────────────────────────────────────────────────────────

function has(content: string, ...patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(content));
}

function extractUrl(content: string): string | null {
  const m = content.match(/https?:\/\/[^\s>)]+/);
  return m?.[0] ?? null;
}

function extractCode(content: string): { code: string; language: string } | null {
  const fenced = content.match(/```(\w+)?\n?([\s\S]*?)```/);
  if (fenced) return { code: fenced[2].trim(), language: fenced[1] ?? "python" };
  const inline = content.match(/`([^`]{10,})`/);
  if (inline) return { code: inline[1], language: "bash" };
  return null;
}

function extractTicker(content: string): string | null {
  const m = content.match(/\$([A-Z]{1,5})\b/) ?? content.match(/\b([A-Z]{2,5})\s+(?:stock|ticker|share|equity)/i);
  return m?.[1] ?? null;
}

function extractTextFromResult(data: any, ...keys: string[]): string {
  for (const key of keys) {
    if (data?.[key] && typeof data[key] === "string" && data[key].trim()) return data[key];
  }
  return JSON.stringify(data, null, 2).slice(0, 3000);
}

function persona(specialist: ActiveSpecialist, body: string): string {
  return `**[${specialist.agent_name}]**\n\n${body}`;
}

// ── Local server (optional) ────────────────────────────────────────────────────
// When the VANTARA local Node.js server is running (node server/vantara-local.mjs),
// web research and code execution use it directly — free, no API key required.
import { isLocalServerAvailable, localWebSearch, localExecCode } from "@/mavis/localServerClient";

// ── Route table ───────────────────────────────────────────────────────────────

const ROUTES: Route[] = [

  // ── Code execution (engineering / testing / security) ────────────────────────
  {
    divisions: ["engineering", "testing", "security", "game-development"],
    match: (c) =>
      extractCode(c) !== null &&
      has(c, /\b(run|execute|eval|test|check|compile|try this|bash|node|python|script)\b/i),
    loadingLabel: "Executing code",
    invoke: async (content, specialist, _userId, supabase) => {
      const extracted = extractCode(content)!;

      // Prefer local execution (no E2B cost) when local server is running
      const localAvailable = await isLocalServerAvailable();
      if (localAvailable) {
        const result = await localExecCode(extracted.code, extracted.language as any);
        const out = result?.output ?? result?.error ?? "No output";
        const err = result?.success === false ? `\n\n⚠️ Error: ${result.error}` : "";
        return persona(specialist, `Executed (${extracted.language}) — local sandbox:\n\`\`\`\n${out}${err}\n\`\`\``);
      }

      // Fallback: E2B via Supabase edge function
      const { data } = await supabase.functions.invoke("mavis-code-exec", {
        body: { code: extracted.code, language: extracted.language },
      });
      const output = Array.isArray(data?.output) ? data.output.join("\n") : (data?.result ?? data?.error ?? "No output");
      const err = data?.error ? `\n\n⚠️ Error: ${data.error}` : "";
      return persona(specialist, `Executed (${extracted.language}):\n\`\`\`\n${output}${err}\n\`\`\``);
    },
  },

  // ── Security website scan ────────────────────────────────────────────────────
  {
    divisions: ["security", "engineering", "testing"],
    match: (c) =>
      extractUrl(c) !== null &&
      has(c, /\b(scan|audit|pentest|vulnerability|security review|check security|XSS|CSRF|injection|headers)\b/i),
    loadingLabel: "Running security scan",
    invoke: async (content, specialist, _userId, supabase) => {
      const url = extractUrl(content)!;
      const { data } = await supabase.functions.invoke("mavis-security-scanner", {
        body: { action: "scan_website", url },
      });
      if (data?.error) return persona(specialist, `Security scan failed: ${data.error}`);
      const grade = data?.grade ?? "N/A";
      const critical = data?.criticalCount ?? 0;
      const warnings = data?.warningCount ?? 0;
      const vulnSummary = data?.vuln_audit ?? data?.config_audit ?? "";
      return persona(specialist,
        `**Security Scan: ${url}**\n\nGrade: **${grade}** · Critical: ${critical} · Warnings: ${warnings}\n\n${vulnSummary.slice(0, 2000)}`
      );
    },
  },

  // ── Stock analysis (finance) ─────────────────────────────────────────────────
  {
    divisions: ["finance", "specialized"],
    match: (c) =>
      extractTicker(c) !== null ||
      has(c, /\b(stock|equity|share price|market cap|analyze.*stock|should I buy|portfolio|trading signal)\b/i),
    loadingLabel: "Fetching market data",
    invoke: async (content, specialist, _userId, supabase) => {
      const ticker = extractTicker(content);
      if (!ticker) return persona(specialist, "Please specify a ticker symbol (e.g. $AAPL, $BTC).");
      const { data } = await supabase.functions.invoke("mavis-stock-analysis", {
        body: { action: "quote", code: ticker },
      });
      if (data?.error) return persona(specialist, `Market data error: ${data.error}`);
      const price = data?.price ?? "N/A";
      const change = data?.change_pct != null ? `${data.change_pct > 0 ? "+" : ""}${data.change_pct.toFixed(2)}%` : "N/A";
      const name = data?.name ?? ticker;
      // Also get decision signal
      const { data: signalData } = await supabase.functions.invoke("mavis-stock-analysis", {
        body: { action: "decision_signals", stocks: [ticker] },
      }).catch(() => ({ data: null }));
      const signal = signalData?.signals?.[0];
      const signalLine = signal ? `\n\n**Signal:** ${signal.signal.toUpperCase()} (${(signal.strength * 100).toFixed(0)}% confidence) — ${signal.reason}` : "";
      return persona(specialist,
        `**${name} (${ticker})**\n\nPrice: **$${price}** | Change: ${change}${signalLine}`
      );
    },
  },

  // ── Financial account data ────────────────────────────────────────────────────
  {
    divisions: ["finance"],
    match: (c) =>
      has(c, /\b(my account|my balance|transactions|net worth|budget|spending|income|plaid|bank)\b/i),
    loadingLabel: "Fetching financial data",
    invoke: async (content, specialist, userId, supabase) => {
      const action = has(content, /transaction|spending/i) ? "get_transactions"
        : has(content, /net.?worth/i) ? "get_net_worth"
        : has(content, /budget/i) ? "get_budget"
        : "get_accounts";
      const { data } = await supabase.functions.invoke("mavis-finance", {
        body: { action, user_id: userId },
      });
      if (data?.status === "not_connected") return persona(specialist, "Your financial accounts are not connected. Connect them via the Finance page (/finance) → Plaid integration.");
      return persona(specialist, extractTextFromResult(data, "summary", "result", "data"));
    },
  },

  // ── Image generation (design / marketing / product) ──────────────────────────
  {
    divisions: ["design", "marketing", "product", "game-development", "specialized"],
    match: (c) =>
      has(c, /\b(generate|create|make|design|draw|render|produce|build)\b/i) &&
      has(c, /\b(image|photo|illustration|logo|poster|banner|visual|artwork|graphic|icon|thumbnail|mockup)\b/i),
    loadingLabel: "Generating image",
    invoke: async (content, specialist, _userId, supabase) => {
      const prompt = content
        .replace(/^(please\s+)?(generate|create|make|design|draw|render|produce|build)\s+(an?\s+)?(image|photo|illustration|logo|poster|banner|visual|artwork|graphic|icon|thumbnail|mockup)\s+(of\s+|for\s+)?/i, "")
        .trim();
      const { data } = await supabase.functions.invoke("mavis-image-gen", {
        body: { prompt: `${prompt}. Professional quality, high resolution.` },
      });
      if (data?.error) return persona(specialist, `Image generation failed: ${data.error}`);
      const url = data?.url;
      if (!url) return persona(specialist, "Image generation returned no URL. Check that an image provider (DALL-E, Flux, Stable Diffusion) is configured.");
      return persona(specialist, `Here's your image:\n\n![${prompt.slice(0, 50)}](${url})\n\n_Provider: ${data.provider ?? "unknown"}_`);
    },
  },

  // ── Content creation for platforms (marketing) ────────────────────────────────
  {
    divisions: ["marketing", "sales", "product", "design"],
    match: (c) =>
      has(c, /\b(write|draft|create|generate)\s+(a\s+)?(post|tweet|thread|caption|article|newsletter|linkedin|instagram|tiktok|content)\b/i),
    loadingLabel: "Creating content",
    invoke: async (content, specialist, userId, supabase) => {
      const platformMatch = content.match(/\b(linkedin|twitter|instagram|tiktok|youtube|facebook|x\.com)\b/i);
      const platform = platformMatch?.[1]?.toLowerCase() ?? "general";
      const topic = content.replace(/^(write|draft|create|generate)\s+(a\s+)?(post|tweet|thread|caption|article|newsletter|content)\s+(for\s+\w+\s+)?/i, "").trim();
      const { data } = await supabase.functions.invoke("mavis-content-pipeline", {
        body: { action: "create_content", user_id: userId, platform, topic, brand_voice: specialist.agent_name },
      });
      if (data?.error) return persona(specialist, `Content creation failed: ${data.error}`);
      const result = data?.data?.content ?? data?.content ?? extractTextFromResult(data, "content", "result", "text");
      return persona(specialist, result);
    },
  },

  // ── Brand voice rewrite (marketing / sales) ───────────────────────────────────
  {
    divisions: ["marketing", "sales", "design", "specialized"],
    match: (c) =>
      has(c, /\b(rewrite|improve|polish|edit|refine|brand.?voice|make this sound)\b/i) &&
      c.length > 100,
    loadingLabel: "Applying brand voice",
    invoke: async (content, specialist, _userId, supabase) => {
      const platformMatch = content.match(/\b(linkedin|twitter|instagram|tiktok|youtube)\b/i);
      const platform = platformMatch?.[1]?.toLowerCase() ?? "general";
      const { data } = await supabase.functions.invoke("mavis-brand-voice", {
        body: { action: "apply", content, platform },
      });
      if (data?.error) return persona(specialist, `Brand voice failed: ${data.error}`);
      return persona(specialist, data?.rewritten ?? extractTextFromResult(data, "rewritten", "result", "content"));
    },
  },

  // ── Lead research (sales) ─────────────────────────────────────────────────────
  {
    divisions: ["sales", "marketing"],
    match: (c) =>
      has(c, /\b(research|find|prospect|lead|outreach|contact|qualify)\b/i) &&
      has(c, /\b(company|startup|business|firm|corp|inc|llc|brand|client)\b/i),
    loadingLabel: "Researching leads",
    invoke: async (content, specialist, userId, supabase) => {
      const companyMatch = content.match(/\b(?:for|about|on|research)\s+([A-Z][A-Za-z0-9\s&'.,-]{1,40}?)(?:\s+(?:and|at|company|startup|inc|llc|corp|\.|,)|\s*$)/);
      const company = companyMatch?.[1]?.trim() ?? content.replace(/\b(research|find|prospect|lead|outreach|contact)\b/gi, "").trim().slice(0, 60);
      const { data } = await supabase.functions.invoke("mavis-lead-gen", {
        body: { action: "research", company, target_role: "decision maker", product_context: "MAVIS AI platform" },
      });
      if (data?.error) return persona(specialist, `Lead research failed: ${data.error}`);
      const lead = data?.lead ?? data?.result ?? data;
      const summary = typeof lead === "string" ? lead : [
        lead.company_name && `**Company:** ${lead.company_name}`,
        lead.description && `**Overview:** ${lead.description}`,
        lead.industry && `**Industry:** ${lead.industry}`,
        lead.estimated_size && `**Size:** ${lead.estimated_size}`,
        lead.key_people?.length && `**Key People:** ${lead.key_people.join(", ")}`,
        lead.pain_points?.length && `**Pain Points:** ${lead.pain_points.join("; ")}`,
        lead.score != null && `**Fit Score:** ${lead.score}/10`,
      ].filter(Boolean).join("\n");
      return persona(specialist, summary || extractTextFromResult(data, "summary", "result"));
    },
  },

  // ── Web research / multi-search (research, academic, specialized) ─────────────
  {
    divisions: ["academic", "specialized", "gis", "spatial-computing", "support"],
    match: (c) =>
      has(c, /\b(research|investigate|find out|look up|search for|tell me about|what is|who is|how does|why does)\b/i) &&
      c.length > 25,
    loadingLabel: "Searching the web",
    invoke: async (content, specialist, _userId, supabase) => {
      const query = content
        .replace(/^(please\s+)?(research|investigate|find out|look up|search for|tell me about)\s+/i, "")
        .trim();

      // Prefer local DuckDuckGo (free, no API key) when local server is running
      const localAvailable = await isLocalServerAvailable();
      if (localAvailable) {
        const data = await localWebSearch(query, 8);
        if ((data?.items as any[])?.length) {
          const lines = (data.items as any[]).slice(0, 5).map((i: any) =>
            `- [${i.title}](${i.url})\n  ${(i.description ?? "").slice(0, 200)}`
          );
          const abstract = data.abstract ? `\n\n${data.abstract}` : "";
          return persona(specialist, `**Search: "${query}"**${abstract}\n\n${lines.join("\n")}`);
        }
      }

      // Fallback: Supabase edge function (multi_search)
      const { data } = await supabase.functions.invoke("mavis-agent-reach", {
        body: { action: "multi_search", query },
      });
      if (data?.error) return persona(specialist, `Research failed: ${data.error}`);
      const parts: string[] = [];
      for (const [platform, result] of Object.entries(data?.results ?? data ?? {})) {
        if (!result || typeof result !== "object") continue;
        const r = result as any;
        if (r.items?.length) {
          parts.push(`**${platform.toUpperCase()}**\n` + r.items.slice(0, 3).map((i: any) => `- [${i.title ?? i.name}](${i.url})\n  ${(i.description ?? i.content ?? "").slice(0, 200)}`).join("\n"));
        }
      }
      return persona(specialist, parts.join("\n\n") || "No results found. Try a more specific query.");
    },
  },

  // ── URL browsing (any division) ───────────────────────────────────────────────
  {
    divisions: ["*"],
    match: (c) =>
      extractUrl(c) !== null &&
      has(c, /\b(read|fetch|browse|open|check|visit|analyze|review|summarize|what does.*say)\b/i),
    loadingLabel: "Reading web page",
    invoke: async (content, specialist, _userId, supabase) => {
      const url = extractUrl(content)!;
      const { data } = await supabase.functions.invoke("mavis-agent-reach", {
        body: { action: "web_read", url },
      });
      if (data?.error) return persona(specialist, `Could not read ${url}: ${data.error}`);
      const pageContent = (data?.content ?? "").slice(0, 3000);
      return persona(specialist, `**Page: ${url}**\n\n${pageContent}`);
    },
  },

  // ── Strategy council (specialized, project-management, product) ───────────────
  {
    divisions: ["specialized", "project-management", "product", "academic"],
    match: (c) =>
      has(c, /\b(strategy|strategic|plan|what should I do|how should I approach|framework|decision|advice|recommendation|what.?s the best way)\b/i) &&
      c.length > 40,
    loadingLabel: "Consulting strategy council",
    invoke: async (content, specialist, userId, supabase) => {
      const { data } = await supabase.functions.invoke("mavis-strategy-council", {
        body: {
          question: content,
          context: `Active specialist: ${specialist.agent_name} (${specialist.division})`,
          user_id: userId,
        },
      });
      if (data?.error) return persona(specialist, `Strategy council error: ${data.error}`);
      const synthesis = data?.synthesis ?? data?.recommendation ?? extractTextFromResult(data, "synthesis", "recommendation", "result");
      const confidence = data?.confidence != null ? `\n\n_Confidence: ${Math.round(data.confidence * 100)}%_` : "";
      return persona(specialist, `${synthesis}${confidence}`);
    },
  },

  // ── Quality evaluation (testing / engineering) ────────────────────────────────
  {
    divisions: ["testing", "engineering", "security"],
    match: (c) =>
      has(c, /\b(evaluate|quality|QA|review|score|assess|check quality|how good is|rate this)\b/i) &&
      c.length > 100,
    loadingLabel: "Evaluating quality",
    invoke: async (content, specialist, _userId, supabase) => {
      const { data } = await supabase.functions.invoke("mavis-quality-eval", {
        body: {
          content: content.slice(0, 3000),
          context: `Evaluated by: ${specialist.agent_name}`,
        },
      });
      if (data?.error) return persona(specialist, `Quality eval failed: ${data.error}`);
      const score = data?.score ?? "N/A";
      const passed = data?.passed ? "✅ PASSED" : "❌ FAILED";
      const feedback = data?.feedback ?? "";
      return persona(specialist, `**Quality Score: ${score}/10 ${passed}**\n\n${feedback}`);
    },
  },

  // ── CRM operations (sales / support) ─────────────────────────────────────────
  {
    divisions: ["sales", "support"],
    match: (c) =>
      has(c, /\b(create contact|add contact|search contacts|update contact|create deal|new deal|list contacts|CRM|hubspot)\b/i),
    loadingLabel: "Accessing CRM",
    invoke: async (content, specialist, userId, supabase) => {
      let action = "list_recent";
      if (/create contact|add contact/i.test(content)) action = "search_contacts";
      else if (/search contacts?/i.test(content)) action = "search_contacts";
      else if (/create deal|new deal/i.test(content)) action = "list_deals";
      const emailMatch = content.match(/[\w.-]+@[\w.-]+\.\w+/);
      const { data } = await supabase.functions.invoke("mavis-crm-agent", {
        body: { action, ...(emailMatch ? { email: emailMatch[0] } : {}), ...(action === "search_contacts" ? { query: content.slice(0, 100) } : {}), userId },
      });
      if (data?.error) return persona(specialist, `CRM error: ${data.error}`);
      return persona(specialist, extractTextFromResult(data, "result", "contacts", "deals", "summary"));
    },
  },
];

// ── Main dispatch function ─────────────────────────────────────────────────────

export async function dispatchToSpecialist(
  content: string,
  specialist: ActiveSpecialist,
  userId: string,
  supabase: any,
  onLoading?: (label: string) => void,
): Promise<DispatchResult> {
  const division = specialist.division;

  for (const route of ROUTES) {
    const appliesToDivision =
      route.divisions.includes("*") || route.divisions.includes(division);
    if (!appliesToDivision) continue;
    if (!route.match(content)) continue;

    onLoading?.(route.loadingLabel);
    try {
      const response = await route.invoke(content, specialist, userId, supabase);
      return { handled: true, response, loadingLabel: route.loadingLabel };
    } catch (e: any) {
      return {
        handled: true,
        response: `**[${specialist.agent_name}]** Tool error (${route.loadingLabel}): ${e.message}. Falling back to analysis.`,
        loadingLabel: route.loadingLabel,
      };
    }
  }

  return { handled: false };
}

// ── Division capability labels (shown in UI) ──────────────────────────────────

export const DIVISION_CAPABILITIES: Record<string, string[]> = {
  engineering:        ["GitHub read/write", "Code execution", "Security scan", "Deploy"],
  testing:            ["Code execution", "Quality evaluation", "Security scan"],
  security:           ["Security scan", "Code audit", "Vulnerability analysis"],
  marketing:          ["Content creation", "Image generation", "Brand voice", "Lead research"],
  sales:              ["Lead research", "CRM operations", "Content creation"],
  finance:            ["Stock analysis", "Account data", "Budget analysis"],
  design:             ["Image generation", "Content creation", "Brand voice"],
  product:            ["Strategy council", "Content creation", "Image generation"],
  "project-management": ["Strategy council", "Planning", "Task management"],
  academic:           ["Web research", "Strategy council", "Analysis"],
  specialized:        ["Stock analysis", "Web research", "Strategy council", "Image generation"],
  gis:                ["Web research", "Map data"],
  "spatial-computing": ["Web research", "Vision analysis"],
  "game-development": ["Code execution", "Image generation", "Story generation"],
  support:            ["CRM operations", "Web research"],
};

export function getDivisionCapabilities(division: string): string[] {
  return DIVISION_CAPABILITIES[division] ?? ["Web research", "Analysis"];
}
