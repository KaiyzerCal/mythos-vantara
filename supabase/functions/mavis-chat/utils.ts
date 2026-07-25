// mavis-chat/utils.ts
// Pure, parameter-driven helper functions — extracted from index.ts
// (Stabilization Brief Phase 2.6). No closure dependencies on request state.

// ── Memory importance scoring (Felix pattern) ──────────────────
// Pure keyword heuristic — no AI call needed.
export function scoreImportance(text: string): number {
  const lower = text.toLowerCase();
  const HIGH = ["goal","decide","decided","contract","revenue","critical","never","always","promise","commit","committed","deadline","milestone","must","rule","principle"];
  const MED  = ["quest","task","project","plan","build","launch","strategy","system","habit","ritual"];
  if (HIGH.some(w => lower.includes(w))) return Math.min(9, 7 + HIGH.filter(w => lower.includes(w)).length);
  if (MED.some(w => lower.includes(w)))  return 5 + (MED.filter(w => lower.includes(w)).length > 1 ? 1 : 0);
  return 3;
}

// ── Context Compression (OpenHuman TokenJuice pattern) ─────────
// Reduces verbose block content before LLM context assembly.
// Targets: excess whitespace, JSON boilerplate, long field values.
// Pure TypeScript — no AI call, zero latency overhead.
export function compressBlock(text: string, maxEntryChars = 300): string {
  if (!text) return text;
  // Collapse 3+ consecutive blank lines → 1
  let out = text.replace(/\n{3,}/g, "\n\n");
  // Remove trailing spaces on each line
  out = out.replace(/[ \t]+$/gm, "");
  // Truncate very long value lines (e.g. raw JSON dumps injected inline)
  out = out.split("\n").map(line => {
    if (line.length > maxEntryChars && !line.startsWith("  ")) {
      return line.slice(0, maxEntryChars) + "…";
    }
    return line;
  }).join("\n");
  return out;
}

// ── High-stakes query detection (for critic pass) ──────────────
// Returns true if the user message is asking for a plan, strategy,
// analysis, or decision — i.e., outputs where a second-opinion
// adversarial review adds significant quality value.
export function isHighStakesQuery(msg: string): boolean {
  const lower = msg.toLowerCase();
  const TRIGGERS = [
    "make a plan","build a plan","create a plan","design a plan",
    "strategy","strategic","roadmap","how should i","what should i do",
    "analyze","analyse","evaluate","assess","review my","critique",
    "decision","decide","which option","what's the best","what is the best",
    "pros and cons","trade-off","tradeoff","compare","breakdown",
    "investment","financial plan","business plan","launch plan",
    "help me think","devil's advocate","second opinion","blind spot",
  ];
  return TRIGGERS.some(t => lower.includes(t)) && msg.length > 80;
}

// ── LLM cost estimator (OpenJarvis cost telemetry pattern) ──────────────
// Rough USD cost from character counts. Rates per 1M tokens (4 chars ≈ 1 token).
export function estimateLlmCost(provider: string, inputChars: number, outputChars: number): number {
  const inTok  = inputChars  / 4;
  const outTok = outputChars / 4;
  const RATES: Record<string, [number, number]> = {
    "gemini-2.0-flash":       [0.0,    0.0  ],  // free tier
    "gemini-2.0-flash-lite":  [0.0,    0.0  ],  // free tier
    "gemini-2.5-flash":       [0.075,  0.30 ],
    "gemini-2.5-thinking":    [3.5,   10.50 ],
    "openai-mini":            [0.15,   0.60 ],
    "claude-haiku":           [0.25,   1.25 ],
    "claude-sonnet":          [3.0,   15.0  ],
    "claude-sonnet-thinking": [3.0,   15.0  ],
    "grok":                   [0.30,   0.50 ],
  };
  const [inRate, outRate] = RATES[provider] ?? [0.15, 0.60];
  return Math.round(((inTok * inRate + outTok * outRate) / 1_000_000) * 1_000_000) / 1_000_000;
}

// ── Real-time facet class detection (OpenHuman self-learning pattern) ──
// Keyword-pattern scan over the user's message to detect preference signals.
// Returns a partial facets object — only populated classes.
// Six classes: style, identity, tooling, veto, goal, channel.
export function detectFacets(msg: string): Record<string, string> | null {
  const lower = msg.toLowerCase();
  const facets: Record<string, string> = {};

  // Style facets
  if (/\b(brief|short|concise|quick|terse|less verbose|don't elaborate)\b/.test(lower))
    facets.style = "concise";
  else if (/\b(detail|elaborate|in depth|comprehensive|thorough|step.by.step)\b/.test(lower))
    facets.style = "detailed";

  // Veto facets (hard stops)
  const vetoMatch = lower.match(/\b(don'?t|never|stop|avoid|hate|dislike)\s+(use|say|do|call|format|show|include|repeat)\s+(\w[\w\s]{0,30})/);
  if (vetoMatch) facets.veto = `Avoid: "${vetoMatch[3].trim()}"`;

  // Goal facets
  const goalMatch = lower.match(/\b(my goal is|i want to|i'?m trying to|i need to|working on)\s+(.{10,80})/);
  if (goalMatch) facets.goal = goalMatch[2].trim().replace(/[.!?]$/, "");

  // Tooling facets
  const TOOLS = ["notion","obsidian","slack","discord","github","jira","linear","figma","supabase","stripe","zapier","make.com","airtable","google sheets","clickup","todoist","asana"];
  const mentionedTools = TOOLS.filter(t => lower.includes(t));
  if (mentionedTools.length) facets.tooling = mentionedTools.join(", ");

  // Channel facets
  if (/\b(telegram|whatsapp|sms|email|push notification|notify me|send me|alert me)\b/.test(lower))
    facets.channel = lower.match(/telegram|whatsapp|sms|email|push notification|notify|alert/)?.[0] ?? "notify";

  return Object.keys(facets).length > 0 ? facets : null;
}
