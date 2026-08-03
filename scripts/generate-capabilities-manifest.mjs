#!/usr/bin/env node
// Generates src/mavis/capabilitiesManifest.generated.ts from the actual
// repo state — supabase/functions/ on disk, supabase/config.toml,
// supabase/migrations/*.sql, and src/**/*.{ts,tsx} caller sites. Nothing in
// the output is hand-maintained; this is what the Execution Blueprint's
// Stage E explicitly asked for ("not hand-maintained — so it can't go stale
// the way SHARD.md did").
//
// Usage: node scripts/generate-capabilities-manifest.mjs [--check]
//   --check   don't write the file; exit 1 if the generated content would
//             differ from what's currently on disk (the CI drift gate).

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Converts an OS-native path (backslash-separated on Windows) to the
// forward-slash form used throughout this file's string matching/output.
const toPosix = (p) => p.split(sep).join("/");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FUNCTIONS_DIR = join(ROOT, "supabase/functions");
const OUT_PATH = join(ROOT, "src/mavis/capabilitiesManifest.generated.ts");
// Plain-JSON sibling — same data, importable by any Node script (e.g.
// scripts/smoke-test.mjs) without a TypeScript loader.
const JSON_OUT_PATH = join(ROOT, "src/mavis/capabilitiesManifest.generated.json");
const CHECK_ONLY = process.argv.includes("--check");

function walk(dir, exts, out = []) {
  // Sorted explicitly — readdirSync's OS-native order isn't guaranteed
  // consistent across platforms/filesystems, which previously made the
  // calledFromFrontend/calledFromBackend arrays' element order (and thus
  // this script's output) non-reproducible depending on where it ran.
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "_archive") continue;
      walk(full, exts, out);
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

// ── 1. Real function list from disk ─────────────────────────────────────
const functionNames = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name !== "_archive")
  .map((e) => e.name)
  .filter((name) => existsSync(join(FUNCTIONS_DIR, name, "index.ts")))
  .sort();

// ── 2. SHARD.md category mapping (parsed, not hand-copied) ─────────────
const shardPath = join(ROOT, "SHARD.md");
const categoryByFn = {};
const purposeByFn = {};
if (existsSync(shardPath)) {
  // Normalize CRLF → LF before splitting: on a Windows checkout SHARD.md's
  // lines carry a trailing \r, which breaks the row regex's `$` anchor below
  // and silently drops every category/purpose mapping.
  const shard = readFileSync(shardPath, "utf8").replace(/\r\n/g, "\n");
  let currentCategory = null;
  for (const line of shard.split("\n")) {
    const catMatch = line.match(/^### (.+)$/);
    if (catMatch) { currentCategory = catMatch[1].trim(); continue; }
    // Only accept table rows while inside the "MAVIS EDGE FUNCTIONS" section
    // — the CLAUDE SKILLS section above it uses the same table shape.
    if (line.match(/^## \d/)) currentCategory = null;
    const rowMatch = line.match(/^\|\s*`([a-z0-9-]+)`\s*\|\s*(.+?)\s*\|$/);
    if (rowMatch && currentCategory) {
      const [, fn, purpose] = rowMatch;
      categoryByFn[fn] = currentCategory;
      purposeByFn[fn] = purpose;
    }
  }
}

// ── 3. verify_jwt=false from config.toml ────────────────────────────────
const configPath = join(ROOT, "supabase/config.toml");
const webhookFns = new Set();
if (existsSync(configPath)) {
  const config = readFileSync(configPath, "utf8");
  const blocks = config.split(/\n(?=\[functions\.)/);
  for (const block of blocks) {
    const nameMatch = block.match(/^\[functions\.([a-z0-9-]+)\]/);
    if (nameMatch && /verify_jwt\s*=\s*false/.test(block)) webhookFns.add(nameMatch[1]);
  }
}

// ── 4. Cron targets from migrations ─────────────────────────────────────
const migrationsDir = join(ROOT, "supabase/migrations");
const cronFns = new Set();
if (existsSync(migrationsDir)) {
  for (const f of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"))) {
    const content = readFileSync(join(migrationsDir, f), "utf8");
    for (const m of content.matchAll(/functions\/v1\/([a-z0-9-]+)/g)) cronFns.add(m[1]);
  }
}

// ── 5. Frontend / backend callers (grep-equivalent) ─────────────────────
const srcFiles = walk(join(ROOT, "src"), [".ts", ".tsx"]);
const fnFiles = walk(FUNCTIONS_DIR, [".ts"]);
const frontendCallers = {};
const backendCallers = {};
const invokePattern = (name) => new RegExp(
  `\\.functions\\.invoke\\(\\s*["'\`]${name}["'\`]|functions/v1/${name}\\b`
);

for (const name of functionNames) {
  const re = invokePattern(name);
  for (const f of srcFiles) {
    const content = readFileSync(f, "utf8");
    if (re.test(content)) {
      // Was f.replace(ROOT + "/", "") — a forward-slash string replace
      // against a path.join() result, which uses backslashes on Windows,
      // so it silently no-oped and left absolute Windows paths in the
      // output instead of repo-relative ones.
      (frontendCallers[name] ??= []).push(toPosix(f).replace(toPosix(ROOT) + "/", ""));
    }
  }
  for (const f of fnFiles) {
    if (f.startsWith(join(FUNCTIONS_DIR, name) + "/")) continue; // skip self
    const content = readFileSync(f, "utf8");
    if (re.test(content)) {
      const callerFn = toPosix(f).replace(toPosix(FUNCTIONS_DIR) + "/", "").split("/")[0];
      if (callerFn !== name) (backendCallers[name] ??= []).push(callerFn);
    }
  }
}

// ── 6. Autonomy & Proactive pathway classification ──────────────────────
// This one category needs judgment a regex can't produce (does it actually
// record an outcome, is a "trigger" real or just a manual button) — it was
// built via a full-source read during Execution Blueprint Stage B and is
// captured here as an explicit, labeled annotation layer, not derived.
// Re-verify by hand if any of these functions change meaningfully.
const AUTONOMY_PATHWAYS = {
  "mavis-goal-review":     { status: "CONNECTED", note: "Cron Mon 09:00 UTC → evaluates active goals → updates mavis_goals + proposes replacement quests." },
  "mavis-autonomous-engine": { status: "CONNECTED", note: "Cron */5m → evaluates due workflows → logs to mavis_autonomous_runs." },
  "mavis-trigger-engine":  { status: "CONNECTED", note: "Cron */5m → email/calendar/task triggers → mavis-agent (TRIGGER mode) → logs to mavis_trigger_log." },
  "mavis-signal-watcher":  { status: "CONNECTED", note: "Cron */15m → RSS/market/keyword signals → LLM briefing → mavis_memory + Telegram." },
  "mavis-proactive-agent": { status: "PARTIAL", note: "Fully built, but no cron/autonomous trigger exists — only reachable via a manual dashboard button or a chat keyword match. Not actually autonomous today." },
  "mavis-proactive-nudge": { status: "CONNECTED", note: "Cron every 4h → 11 urgency checks → notification_stages + mavis_insights + Telegram." },
  "mavis-streak-alerts":   { status: "CONNECTED", note: "Cron daily 08:00 UTC → fires a Telegram message, but no table records that it ran (no outcome trace)." },
  "mavis-quest-nudge":     { status: "CONNECTED", note: "Cron daily (morning+evening) → deadline alerts, same no-outcome-record caveat as streak-alerts." },
  "standing-orders":       { status: "CONNECTED", note: "mavis-so-scheduler (cron */15m) → mavis_tasks(type=standing_order) → mavis-task-executor's handleStandingOrder → mavis_so_executions outcome record. Best-instrumented pathway found." },
};

// ── 7. Status classification ─────────────────────────────────────────────
const NEEDS_DECISION = new Set(["mavis-yamete"]);

function classify(name) {
  if (NEEDS_DECISION.has(name)) return "NEEDS_DECISION";
  if (frontendCallers[name]?.length || backendCallers[name]?.length) return "ACTIVE";
  if (cronFns.has(name)) return "CRON_ONLY";
  if (webhookFns.has(name)) return "WEBHOOK";
  return "ORPHANED";
}

const manifest = functionNames.map((name) => ({
  name,
  category: categoryByFn[name] ?? "Uncategorized",
  purpose: purposeByFn[name] ?? null,
  status: classify(name),
  calledFromFrontend: frontendCallers[name] ?? [],
  calledFromBackend: backendCallers[name] ?? [],
  isCronTarget: cronFns.has(name),
  requiresJwt: !webhookFns.has(name),
  autonomyPathway: AUTONOMY_PATHWAYS[name] ?? null,
}));

// ── 8. Emit ───────────────────────────────────────────────────────────
const header = `// AUTO-GENERATED — DO NOT EDIT BY HAND.
// Run \`node scripts/generate-capabilities-manifest.mjs\` to regenerate
// (or \`npm run generate:capabilities\`). CI fails the build if this file
// is stale relative to the actual repo state — see
// .github/workflows/capabilities-drift-check.yml.
// Generated from: supabase/functions/ (disk), supabase/config.toml,
// supabase/migrations/*.sql, SHARD.md, and src/**/*.{ts,tsx} caller sites.

export type CapabilityStatus = "ACTIVE" | "CRON_ONLY" | "WEBHOOK" | "ORPHANED" | "NEEDS_DECISION";

export interface AutonomyPathwayInfo {
  status: "CONNECTED" | "PARTIAL" | "BROKEN";
  note: string;
}

export interface CapabilityEntry {
  name: string;
  category: string;
  purpose: string | null;
  status: CapabilityStatus;
  calledFromFrontend: string[];
  calledFromBackend: string[];
  isCronTarget: boolean;
  requiresJwt: boolean;
  autonomyPathway: AutonomyPathwayInfo | null;
}

export const CAPABILITIES_MANIFEST: CapabilityEntry[] = `;

const jsonBody = JSON.stringify(manifest, null, 2) + "\n";
const output = header + JSON.stringify(manifest, null, 2) + ";\n";

if (CHECK_ONLY) {
  const existing = existsSync(OUT_PATH) ? readFileSync(OUT_PATH, "utf8") : "";
  const existingJson = existsSync(JSON_OUT_PATH) ? readFileSync(JSON_OUT_PATH, "utf8") : "";
  if (existing !== output || existingJson !== jsonBody) {
    console.error(
      `capabilities manifest is stale (${functionNames.length} functions on disk don't match ` +
      `src/mavis/capabilitiesManifest.generated.{ts,json}). Run: node scripts/generate-capabilities-manifest.mjs`
    );
    process.exit(1);
  }
  console.log(`capabilities manifest is up to date (${functionNames.length} functions).`);
  process.exit(0);
}

writeFileSync(OUT_PATH, output);
writeFileSync(JSON_OUT_PATH, jsonBody);
console.log(`Wrote ${OUT_PATH} and ${JSON_OUT_PATH} (${functionNames.length} functions).`);
