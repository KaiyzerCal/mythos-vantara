#!/usr/bin/env node
// MAVIS smoke test — exercises deployed edge functions end-to-end.
//
// Usage:
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SERVICE_ROLE_KEY=<service-role-key> \
//   OPERATOR_USER_ID=<a real auth.users uuid> \
//   node scripts/smoke-test.mjs [--gen] [--only=agent,modelslab]
//
//   --gen           also run the paid generation test (mavis-modelslab txt2img)
//   --only=a,b      run only the named tests
//
// Exit code is non-zero if any test fails, so it can gate a deploy.

const BASE =
  process.env.SUPABASE_URL?.replace(/\/$/, "") ||
  "https://wlygujlvsfimhtqsdxrx.supabase.co";
const KEY = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UID = process.env.OPERATOR_USER_ID || process.env.TELEGRAM_OPERATOR_USER_ID || "";

const args = process.argv.slice(2);
const RUN_GEN = args.includes("--gen");
const onlyArg = args.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? onlyArg.slice(7).split(",").map((s) => s.trim()) : null;

if (!KEY) {
  console.error("✗ SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE_KEY) is required.");
  process.exit(2);
}

const GREEN = "\x1b[32m", RED = "\x1b[31m", DIM = "\x1b[2m", YEL = "\x1b[33m", RST = "\x1b[0m";

async function call(fn, body, { timeoutMs = 90_000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/functions/v1/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: res.status, ok: res.ok, json, text };
  } finally {
    clearTimeout(t);
  }
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  const tag = pass ? `${GREEN}PASS${RST}` : `${RED}FAIL${RST}`;
  console.log(`  ${tag}  ${name}${detail ? `  ${DIM}${detail}${RST}` : ""}`);
}

const shouldRun = (name) => !ONLY || ONLY.includes(name);

// ── Tests ────────────────────────────────────────────────────────────────────

async function testAgentText() {
  if (!shouldRun("agent")) return;
  if (!UID) { record("agent: text reply", false, "set OPERATOR_USER_ID"); return; }
  const r = await call("mavis-agent", {
    user_id: UID,
    goal: "Reply with exactly the word PONG and nothing else.",
    mode: "TEST",
  });
  const content = r.json?.content ?? "";
  const pass = r.ok && typeof content === "string" && content.length > 0;
  record("agent: text reply", pass,
    pass ? `provider=${r.json?.provider ?? "?"} lane=${r.json?.lane ?? "?"}` : `status=${r.status} ${r.text.slice(0, 120)}`);
}

async function testAgentRouting() {
  if (!shouldRun("routing")) return;
  if (!UID) { record("agent: realtime lane -> grok", false, "set OPERATOR_USER_ID"); return; }
  const r = await call("mavis-agent", {
    user_id: UID,
    goal: "What is the latest news right now?",
    mode: "TEST",
  });
  // We only assert the router picked the realtime lane; provider depends on keys.
  const pass = r.ok && r.json?.lane === "realtime";
  record("agent: realtime lane routing", pass,
    pass ? `provider=${r.json?.provider ?? "?"}` : `lane=${r.json?.lane ?? "?"} status=${r.status}`);
}

async function testModelsLab() {
  if (!shouldRun("modelslab")) return;
  if (!RUN_GEN) { console.log(`  ${YEL}SKIP${RST}  modelslab: txt2img  ${DIM}(pass --gen to run; costs credits)${RST}`); return; }
  const r = await call("mavis-modelslab", {
    workflow_type: "txt2img",
    prompt: "a single red apple on a white table, product photo",
    width: 512, height: 512, steps: 20,
    user_id: UID || "smoke-test",
  }, { timeoutMs: 310_000 });
  const url = r.json?.imageUrl ?? "";
  const pass = r.ok && typeof url === "string" && url.startsWith("http");
  record("modelslab: txt2img", pass, pass ? url.slice(0, 60) + "…" : `status=${r.status} ${r.text.slice(0, 140)}`);
}

async function testFunctionReachable(fn, expectStatusOk = true) {
  // A lightweight reachability probe: empty POST. We accept any structured JSON
  // response (even an error like "prompt required") as "function is deployed".
  const r = await call(fn, {}, { timeoutMs: 20_000 });
  const reachable = r.status !== 404 && (r.json !== null || r.text.length > 0);
  record(`reachable: ${fn}`, reachable, reachable ? `status=${r.status}` : `status=${r.status}`);
}

// ── Runner ───────────────────────────────────────────────────────────────────

(async () => {
  console.log(`\nMAVIS smoke test → ${BASE}\n`);

  console.log("Core agent:");
  await testAgentText();
  await testAgentRouting();

  console.log("\nGeneration:");
  await testModelsLab();

  console.log("\nDeploy reachability (404 = not deployed):");
  for (const fn of ["mavis-telegram-bot", "mavis-action-executor", "mavis-modelslab",
                    "mavis-comfyui", "mavis-vtube-studio", "mavis-phone-call",
                    "mavis-vision-agent", "mavis-gmail-sync"]) {
    if (shouldRun("reachable")) await testFunctionReachable(fn);
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${failed.length ? RED : GREEN}${results.length - failed.length}/${results.length} passed${RST}\n`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error("Harness crashed:", e);
  process.exit(2);
});
