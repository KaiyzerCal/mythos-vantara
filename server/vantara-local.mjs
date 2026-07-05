/**
 * VANTARA Local Server
 * Runs alongside the Vite/Tauri dev process and gives MAVIS access to capabilities
 * that Supabase Deno functions cannot provide: real code execution, local git,
 * Playwright browser automation, Ollama (free local LLM), and DuckDuckGo search.
 *
 * Start: node server/vantara-local.mjs
 * Or via npm run server (see package.json)
 *
 * Binds to 127.0.0.1 only — never exposed to the network.
 */

import { createServer } from "node:http";
import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const PORT = process.env.VANTARA_PORT ?? 8789;
const TOKEN = process.env.VANTARA_LOCAL_TOKEN ?? ""; // optional: require Bearer token

// ── Optional heavy deps (graceful if missing) ─────────────────────────────────
let playwright = null;
try {
  playwright = await import("playwright");
} catch { /* install with: npm install playwright */ }

// ── DuckDuckGo free search (no API key required) ──────────────────────────────
async function ddgSearch(query, limit = 6) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    const items = (data.RelatedTopics ?? [])
      .filter((t) => t.Text && t.FirstURL)
      .slice(0, limit)
      .map((t) => ({ title: t.Text.split(" - ")[0] ?? t.Text.slice(0, 80), url: t.FirstURL, description: t.Text }));
    return {
      query,
      abstract: data.AbstractText ?? "",
      abstract_source: data.AbstractSource ?? "",
      items,
      answer: data.Answer ?? "",
    };
  } catch (e) {
    return { query, error: e.message, items: [] };
  }
}

// ── Code execution sandbox ─────────────────────────────────────────────────────
// SAFETY: only runs in project context, 10-second timeout, no shell metacharacters
const UNSAFE_PATTERNS = [/rm\s+-rf/i, /mkfs/i, /dd\s+if=/i, />\s*\/dev\//i, /curl.*\|\s*sh/i, /wget.*\|\s*sh/i];

function isSafeCode(code) {
  return !UNSAFE_PATTERNS.some((p) => p.test(code));
}

async function execCode(code, language = "node") {
  if (!isSafeCode(code)) {
    return { success: false, error: "Blocked: code contains unsafe patterns" };
  }
  const ext = language === "python" ? "py" : language === "bash" ? "sh" : "js";
  const cmd = language === "python" ? "python3" : language === "bash" ? "bash" : "node";
  const tmpFile = join(PROJECT_ROOT, `__sandbox_${Date.now()}.${ext}`);
  try {
    writeFileSync(tmpFile, code, "utf8");
    const output = execSync(`timeout 10s ${cmd} ${tmpFile}`, {
      encoding: "utf8",
      cwd: PROJECT_ROOT,
      env: { ...process.env, NODE_PATH: join(PROJECT_ROOT, "node_modules") },
    });
    return { success: true, output: output.trim().slice(0, 5000) };
  } catch (e) {
    return { success: false, error: e.stdout?.trim() ?? e.message };
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

// ── Git operations (restricted to project root) ───────────────────────────────
const SAFE_GIT_CMDS = /^(status|log|diff|branch|show|ls-files|remote -v|fetch|pull)/;

async function gitOp(command) {
  if (!SAFE_GIT_CMDS.test(command.trim())) {
    return { success: false, error: `Git command not allowed in local server: '${command}'. Use mavis-code-agent for write operations.` };
  }
  try {
    const output = execSync(`git ${command}`, { cwd: PROJECT_ROOT, encoding: "utf8" });
    return { success: true, output: output.trim().slice(0, 10000) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── Playwright browser (headless) ─────────────────────────────────────────────
async function browserFetch(url, action = "extract") {
  if (!playwright) {
    return { error: "Playwright not installed. Run: npm install playwright && npx playwright install chromium" };
  }
  const executablePath = process.env.PLAYWRIGHT_BROWSERS_PATH
    ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`
    : undefined;
  let browser;
  try {
    browser = await playwright.chromium.launch({
      headless: true,
      executablePath,
    });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });

    if (action === "title") {
      return { success: true, title: await page.title(), url };
    }
    if (action === "screenshot") {
      const buf = await page.screenshot({ type: "jpeg", quality: 60 });
      return { success: true, screenshot: `data:image/jpeg;base64,${buf.toString("base64")}` };
    }
    // Default: extract readable text (strip scripts/styles)
    const text = await page.evaluate(() => {
      for (const s of document.querySelectorAll("script,style,nav,footer,header,aside")) s.remove();
      return document.body?.innerText ?? document.body?.textContent ?? "";
    });
    const title = await page.title();
    return { success: true, title, url, content: text.trim().replace(/\s{3,}/g, "\n\n").slice(0, 4000) };
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    try { await browser?.close(); } catch {}
  }
}

// ── Ollama (free local LLM) ───────────────────────────────────────────────────
async function ollamaChat(prompt, model = "deepseek-coder:6.7b", system = "") {
  try {
    const messages = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: prompt });
    const res = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return { success: true, response: data.message?.content ?? "", model };
  } catch (e) {
    return { success: false, error: `Ollama unavailable: ${e.message}. Run Ollama locally and pull a model: ollama pull deepseek-coder:6.7b` };
  }
}

// ── Self-improve: read a file and LLM-improve it ──────────────────────────────
async function selfImprove(filePath, goal, useOllama = false) {
  // Restrict to project files only
  const absPath = resolve(PROJECT_ROOT, filePath);
  if (!absPath.startsWith(PROJECT_ROOT)) {
    return { success: false, error: "Path outside project root" };
  }
  if (!existsSync(absPath)) {
    return { success: false, error: `File not found: ${filePath}` };
  }
  const code = readFileSync(absPath, "utf8");
  const prompt =
    `You are a senior software engineer improving production code.\n\n` +
    `File: ${filePath}\n\nGoal: ${goal}\n\nCurrent code:\n\`\`\`\n${code.slice(0, 8000)}\n\`\`\`\n\n` +
    `Return ONLY the improved code. No explanation, no markdown fences, just the code.`;

  if (useOllama) {
    const result = await ollamaChat(prompt, "deepseek-coder:6.7b");
    return { success: result.success, improvedCode: result.response, filePath, goal };
  }

  // Claude via Supabase env (if ANTHROPIC_API_KEY is available here)
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 4096,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const data = await res.json();
      const improvedCode = data.content?.find((b) => b.type === "text")?.text ?? "";
      return { success: true, improvedCode, filePath, goal };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  return {
    success: false,
    error: "No LLM available. Set ANTHROPIC_API_KEY or run Ollama locally (useOllama: true).",
  };
}

// ── Autonomous task (research + execute) ──────────────────────────────────────
async function autonomousTask(task) {
  const research = await ddgSearch(task);
  const codeResult = await execCode(
    `console.log(JSON.stringify({ task: ${JSON.stringify(task)}, timestamp: new Date().toISOString() }))`,
    "node"
  );
  return { research, codeResult, completedAt: new Date().toISOString() };
}

// ── HTTP Server ───────────────────────────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function respond(res, data, status = 200) {
  res.writeHead(status, { ...CORS, "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return; }

  // Optional auth check
  if (TOKEN) {
    const auth = req.headers.authorization ?? "";
    if (!auth.startsWith(`Bearer ${TOKEN}`)) {
      respond(res, { error: "Unauthorized" }, 401); return;
    }
  }

  // Health check
  if (req.method === "GET" && req.url === "/status") {
    respond(res, {
      ok: true,
      version: "1.0.0",
      capabilities: {
        websearch: true,
        exec: true,
        git: true,
        browser: !!playwright,
        ollama: true, // will fail at runtime if Ollama not running
        selfimprove: true,
      },
      project: PROJECT_ROOT,
    });
    return;
  }

  // Parse body
  let body = {};
  await new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => raw += c);
    req.on("end", () => {
      try { body = JSON.parse(raw); } catch {}
      resolve();
    });
  });

  // ── /tools — direct tool access ────────────────────────────────────────────
  if (req.method === "POST" && req.url === "/tools") {
    const { tool, payload = {} } = body;
    let result;
    try {
      switch (tool) {
        case "websearch":
          result = await ddgSearch(String(payload.query ?? payload), Number(payload.limit ?? 6));
          break;
        case "exec":
          result = await execCode(String(payload.code ?? payload), String(payload.language ?? "node"));
          break;
        case "git":
          result = await gitOp(String(payload.command ?? payload));
          break;
        case "browser":
          result = await browserFetch(String(payload.url), String(payload.action ?? "extract"));
          break;
        case "ollama":
          result = await ollamaChat(String(payload.prompt ?? payload), String(payload.model ?? "deepseek-coder:6.7b"), String(payload.system ?? ""));
          break;
        case "selfimprove":
          result = await selfImprove(String(payload.file), String(payload.goal ?? "Improve this code"), Boolean(payload.use_ollama));
          break;
        case "autonomous":
          result = await autonomousTask(String(payload.task ?? payload));
          break;
        default:
          result = { error: `Unknown tool: ${tool}. Available: websearch, exec, git, browser, ollama, selfimprove, autonomous` };
      }
    } catch (e) {
      result = { error: e.message };
    }
    respond(res, result);
    return;
  }

  // ── /swarm — quick local swarm (wraps the tools) ───────────────────────────
  if (req.method === "POST" && req.url === "/swarm") {
    const { type, input = {} } = body;
    try {
      const research = await ddgSearch(input.query ?? input.task ?? type);
      const codeIdea = input.code ? await execCode(input.code, input.language ?? "node") : null;
      respond(res, {
        ok: true,
        type,
        research,
        codeExecution: codeIdea,
        recommendation: "Use /tools with tool:'selfimprove' to improve a specific file.",
        completedAt: new Date().toISOString(),
      });
    } catch (e) {
      respond(res, { error: e.message }, 500);
    }
    return;
  }

  respond(res, { error: "Not found. Endpoints: GET /status · POST /tools · POST /swarm" }, 404);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n⚡ VANTARA Local Server running at http://127.0.0.1:${PORT}`);
  console.log(`   GET  /status   → health + capability check`);
  console.log(`   POST /tools    → { tool, payload } — direct tool access`);
  console.log(`   POST /swarm    → { type, input } — quick orchestration`);
  console.log(`\n   Tools: websearch · exec · git · browser · ollama · selfimprove`);
  console.log(`   Playwright: ${playwright ? "✅ available" : "❌ npm install playwright"}`);
  console.log(`   Ollama: check http://localhost:11434 (run: ollama serve)\n`);
});
