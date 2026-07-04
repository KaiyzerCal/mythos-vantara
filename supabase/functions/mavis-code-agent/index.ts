// mavis-code-agent
// Claude-native software engineering agent: reads, writes, tests, and commits
// code autonomously via GitHub API. Uses extended thinking + tool-use loop.
//
// config.toml entry required (do NOT edit that file — note only):
//   [functions.mavis-code-agent]
//   verify_jwt = true

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

// ── Env ───────────────────────────────────────────────────────────────────────
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const E2B_API_KEY = Deno.env.get("E2B_API_KEY") ?? "";

// ── Constants ─────────────────────────────────────────────────────────────────
const DEFAULT_MAX_TURNS = 12;
const HARD_CAP_TURNS = 20;
const AGENT_MODEL = "claude-sonnet-4-6";
const GITHUB_API = "https://api.github.com";
const DEFAULT_BRANCH = "mavis-agent-work";
const DEFAULT_BASE = "main";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface RequestBody {
  task: string;
  owner?: string;
  repo?: string;
  branch?: string;
  base_branch?: string;
  create_pr?: boolean;
  max_turns?: number;
  specialist_name?: string;
  specialist_context?: string;
}

interface AgentResponse {
  summary: string;
  files_changed: string[];
  pr_url?: string;
  turns_used: number;
  repo: string;
  branch: string;
}

// Claude tool-use message types
interface TextBlock {
  type: "text";
  text: string;
}

interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}

interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock;

interface ClaudeMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

// ── SE Tool definitions ───────────────────────────────────────────────────────

const SE_TOOLS = [
  {
    name: "list_repo_files",
    description: "List files in a GitHub repo directory",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path ('' for root)" },
        branch: { type: "string" },
      },
      required: [],
    },
  },
  {
    name: "read_file",
    description: "Read a file from the GitHub repo",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        branch: { type: "string" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Create or update a file in the GitHub repo",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string", description: "Full file content (not a diff)" },
        message: { type: "string", description: "Git commit message" },
        branch: { type: "string" },
      },
      required: ["path", "content", "message"],
    },
  },
  {
    name: "delete_file",
    description: "Delete a file from the GitHub repo",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        message: { type: "string" },
        branch: { type: "string" },
      },
      required: ["path", "message"],
    },
  },
  {
    name: "search_code",
    description: "Search code in the GitHub repo",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    },
  },
  {
    name: "run_tests",
    description: "Run code in an E2B sandbox to verify correctness",
    input_schema: {
      type: "object",
      properties: {
        code: { type: "string" },
        language: { type: "string", description: "python3|javascript|bash" },
      },
      required: ["code"],
    },
  },
  {
    name: "create_branch",
    description: "Create a new branch for this work",
    input_schema: {
      type: "object",
      properties: {
        branch: { type: "string" },
        from_branch: { type: "string", description: "Source branch (defaults to main)" },
      },
      required: ["branch"],
    },
  },
  {
    name: "create_pull_request",
    description: "Open a pull request with the completed work",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        head: { type: "string", description: "Branch with changes" },
        base: { type: "string", description: "Target branch (usually main)" },
      },
      required: ["title", "head"],
    },
  },
  {
    name: "finish",
    description: "Signal task completion with a summary",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        files_changed: { type: "array", items: { type: "string" } },
        pr_url: { type: "string" },
      },
      required: ["summary"],
    },
  },
];

// ── Agent system prompt ───────────────────────────────────────────────────────

const AGENT_SYSTEM_PROMPT = `You are MAVIS Code Agent — a senior software engineer with deep expertise in all languages and frameworks.
You have access to a GitHub repository and can read files, write code, run tests, and create pull requests.

Your approach:
1. Read and understand the codebase structure before making changes
2. Plan your changes carefully — prefer targeted edits over large rewrites
3. Run tests when possible to verify your work
4. Write clear commit messages
5. Call finish() when the task is complete

You are autonomous. Do not ask for clarification — make reasonable decisions and explain them in your summary.`;

// ── JWT auth (mirrors mavis-crew-orchestrator pattern) ────────────────────────

async function getUserId(req: Request): Promise<string | null> {
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return null;

    // Use Supabase to validate the JWT — handles key rotation automatically
    const supabase = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
    const { data } = await supabase.auth.getUser(token);
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

// ── GitHub PAT helper (mirrors mavis-github-sync pattern) ─────────────────────

async function getGitHubToken(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("mavis_user_integrations")
    .select("config")
    .eq("user_id", userId)
    .eq("provider", "github")
    .maybeSingle();

  if (error || !data?.config?.token) return null;
  return data.config.token as string;
}

// ── GitHub API helpers ────────────────────────────────────────────────────────

function ghHeaders(token: string | null): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json",
    "User-Agent": "mavis-code-agent/1.0",
  };
  if (token) headers["Authorization"] = `token ${token}`;
  return headers;
}

/** Classify GitHub error response and throw an appropriate error. */
async function throwGitHubError(res: Response, context: string): Promise<never> {
  const body = await res.text().catch(() => "");
  if (res.status === 401 || res.status === 403) {
    throw new Error("GITHUB_AUTH_ERROR");
  }
  if (res.status === 404) {
    throw new Error(`GITHUB_NOT_FOUND:${context}`);
  }
  throw new Error(`GitHub API error ${res.status} (${context}): ${body.slice(0, 200)}`);
}

async function ghListRepoFiles(
  token: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<string> {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  const res = await fetch(url, { headers: ghHeaders(token), signal: AbortSignal.timeout(20000) });
  if (!res.ok) await throwGitHubError(res, `list files in ${owner}/${repo}@${branch}`);

  const data = await res.json();
  const blobs: Array<{ path: string; type: string }> = data.tree ?? [];
  const files = blobs
    .filter((item) => item.type === "blob")
    .slice(0, 100)
    .map((item) => item.path);

  return files.length > 0
    ? files.join("\n")
    : "(no files found — repository may be empty)";
}

async function ghReadFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  branch: string,
): Promise<string> {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  const res = await fetch(url, { headers: ghHeaders(token), signal: AbortSignal.timeout(20000) });
  if (!res.ok) await throwGitHubError(res, `read ${path}@${branch}`);

  const data = await res.json();
  if (!data.content) throw new Error(`File ${path} has no content (may be a directory or binary)`);

  // GitHub encodes content in base64 with line breaks
  const b64 = (data.content as string).replace(/\n/g, "");
  return atob(b64);
}

async function ghGetFileSha(
  token: string,
  owner: string,
  repo: string,
  path: string,
  branch: string,
): Promise<string | null> {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  const res = await fetch(url, { headers: ghHeaders(token), signal: AbortSignal.timeout(15000) });
  if (res.status === 404) return null;
  if (!res.ok) await throwGitHubError(res, `get SHA for ${path}`);
  const data = await res.json();
  return (data.sha as string) ?? null;
}

async function ghWriteFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  branch: string,
): Promise<string> {
  const sha = await ghGetFileSha(token, owner, repo, path, branch);

  const body: Record<string, unknown> = {
    message,
    content: btoa(unescape(encodeURIComponent(content))), // UTF-8 safe base64
    branch,
  };
  if (sha) body.sha = sha;

  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: ghHeaders(token),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) await throwGitHubError(res, `write ${path}`);

  const data = await res.json();
  const action = sha ? "Updated" : "Created";
  const commitSha: string = data.commit?.sha?.slice(0, 7) ?? "unknown";
  return `${action} ${path} (commit: ${commitSha})`;
}

async function ghDeleteFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  message: string,
  branch: string,
): Promise<string> {
  const sha = await ghGetFileSha(token, owner, repo, path, branch);
  if (!sha) return `File ${path} does not exist — nothing to delete`;

  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: ghHeaders(token),
    body: JSON.stringify({ message, sha, branch }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) await throwGitHubError(res, `delete ${path}`);

  const data = await res.json();
  const commitSha: string = data.commit?.sha?.slice(0, 7) ?? "unknown";
  return `Deleted ${path} (commit: ${commitSha})`;
}

async function ghSearchCode(
  token: string,
  owner: string,
  repo: string,
  query: string,
): Promise<string> {
  // GitHub code search requires a brief delay between requests; use timeout
  const url = `${GITHUB_API}/search/code?q=${encodeURIComponent(query)}+repo:${owner}/${repo}&per_page=5`;
  const res = await fetch(url, { headers: ghHeaders(token), signal: AbortSignal.timeout(20000) });
  if (!res.ok) await throwGitHubError(res, `search code for "${query}"`);

  const data = await res.json();
  const items: Array<{ path: string; html_url: string }> = data.items ?? [];
  if (items.length === 0) return `No results found for query: ${query}`;

  return items
    .map((item) => `${item.path} — ${item.html_url}`)
    .join("\n");
}

async function ghCreateBranch(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  fromBranch: string,
): Promise<string> {
  // Get SHA of the source branch
  const refUrl = `${GITHUB_API}/repos/${owner}/${repo}/git/ref/heads/${fromBranch}`;
  const refRes = await fetch(refUrl, { headers: ghHeaders(token), signal: AbortSignal.timeout(15000) });
  if (!refRes.ok) await throwGitHubError(refRes, `get ref for ${fromBranch}`);
  const refData = await refRes.json();
  const sha: string = refData.object?.sha;
  if (!sha) throw new Error(`Could not get SHA for branch ${fromBranch}`);

  // Create the new branch
  const createUrl = `${GITHUB_API}/repos/${owner}/${repo}/git/refs`;
  const createRes = await fetch(createUrl, {
    method: "POST",
    headers: ghHeaders(token),
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
    signal: AbortSignal.timeout(15000),
  });

  // 422 means branch already exists — that's fine
  if (createRes.status === 422) {
    return `Branch ${branch} already exists`;
  }
  if (!createRes.ok) await throwGitHubError(createRes, `create branch ${branch}`);

  return `Created branch ${branch} from ${fromBranch} (SHA: ${sha.slice(0, 7)})`;
}

async function ghCreatePullRequest(
  token: string,
  owner: string,
  repo: string,
  title: string,
  body: string,
  head: string,
  base: string,
): Promise<string> {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/pulls`;
  const res = await fetch(url, {
    method: "POST",
    headers: ghHeaders(token),
    body: JSON.stringify({ title, body: body ?? "", head, base }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) await throwGitHubError(res, `create PR ${head} → ${base}`);

  const data = await res.json();
  const prUrl: string = data.html_url ?? "";
  const prNumber: number = data.number ?? 0;
  return JSON.stringify({ pr_url: prUrl, pr_number: prNumber });
}

// ── E2B sandbox helper ────────────────────────────────────────────────────────

async function runInE2B(code: string, language = "python3"): Promise<string> {
  if (!E2B_API_KEY) {
    return "E2B sandbox not configured (E2B_API_KEY not set). Skipping test execution.";
  }

  try {
    const res = await fetch(`${SB_URL}/functions/v1/mavis-e2b-sandbox`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SB_KEY}`,
      },
      body: JSON.stringify({ code, language }),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return `E2B sandbox error ${res.status}: ${errText.slice(0, 300)}`;
    }

    const data = await res.json();
    const stdout: string = data.stdout ?? "";
    const stderr: string = data.stderr ?? "";
    const exitCode: number = data.exit_code ?? 0;

    let result = `Exit code: ${exitCode}`;
    if (stdout) result += `\n\nSTDOUT:\n${stdout.slice(0, 2000)}`;
    if (stderr) result += `\n\nSTDERR:\n${stderr.slice(0, 1000)}`;
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `E2B call failed: ${msg}`;
  }
}

// ── Tool dispatcher ───────────────────────────────────────────────────────────

interface ToolContext {
  token: string | null;  // null = anonymous read-only access (public repos only)
  owner: string;
  repo: string;
  branch: string;
  baseBranch: string;
  createPr: boolean;
  filesChanged: string[];
}

interface FinishResult {
  done: true;
  summary: string;
  filesChanged: string[];
  prUrl?: string;
}

interface ToolResult {
  done: false;
  output: string;
}

async function dispatchTool(
  toolName: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<FinishResult | ToolResult> {
  const branch = String(input.branch ?? ctx.branch);

  switch (toolName) {
    case "list_repo_files": {
      const path = String(input.path ?? "");
      const output = await ghListRepoFiles(ctx.token, ctx.owner, ctx.repo, branch);
      return { done: false, output };
    }

    case "read_file": {
      const path = String(input.path ?? "");
      const output = await ghReadFile(ctx.token, ctx.owner, ctx.repo, path, branch);
      return { done: false, output };
    }

    case "write_file": {
      if (!ctx.token) return { done: false, output: "write_file requires a GitHub PAT (read-only anonymous session). Add your PAT in Settings → API Keys → GitHub to enable write operations." };
      const path = String(input.path ?? "");
      const content = String(input.content ?? "");
      const message = String(input.message ?? `Update ${path}`);
      const output = await ghWriteFile(ctx.token, ctx.owner, ctx.repo, path, content, message, branch);
      // Track mutated files
      if (!ctx.filesChanged.includes(path)) ctx.filesChanged.push(path);
      return { done: false, output };
    }

    case "delete_file": {
      if (!ctx.token) return { done: false, output: "delete_file requires a GitHub PAT (read-only anonymous session)." };
      const path = String(input.path ?? "");
      const message = String(input.message ?? `Delete ${path}`);
      const output = await ghDeleteFile(ctx.token, ctx.owner, ctx.repo, path, message, branch);
      if (!ctx.filesChanged.includes(path)) ctx.filesChanged.push(path);
      return { done: false, output };
    }

    case "search_code": {
      if (!ctx.token) return { done: false, output: "search_code requires a GitHub PAT (not available in anonymous read-only session). Try listing files and reading them directly." };
      const query = String(input.query ?? "");
      const output = await ghSearchCode(ctx.token, ctx.owner, ctx.repo, query);
      return { done: false, output };
    }

    case "run_tests": {
      const code = String(input.code ?? "");
      const language = String(input.language ?? "python3");
      const output = await runInE2B(code, language);
      return { done: false, output };
    }

    case "create_branch": {
      if (!ctx.token) return { done: false, output: "create_branch requires a GitHub PAT (read-only anonymous session)." };
      const newBranch = String(input.branch ?? ctx.branch);
      const fromBranch = String(input.from_branch ?? ctx.baseBranch);
      const output = await ghCreateBranch(ctx.token, ctx.owner, ctx.repo, newBranch, fromBranch);
      return { done: false, output };
    }

    case "create_pull_request": {
      if (!ctx.token) return { done: false, output: "create_pull_request requires a GitHub PAT (read-only anonymous session)." };
      const title = String(input.title ?? "MAVIS Code Agent changes");
      const body = String(input.body ?? "");
      const head = String(input.head ?? ctx.branch);
      const base = String(input.base ?? ctx.baseBranch);
      const output = await ghCreatePullRequest(ctx.token, ctx.owner, ctx.repo, title, body, head, base);

      // Parse pr_url out of the JSON result so we can surface it
      let prUrl: string | undefined;
      try {
        const parsed = JSON.parse(output);
        prUrl = parsed.pr_url ?? undefined;
      } catch { /* ignore */ }

      return { done: false, output: prUrl ? `Pull request created: ${prUrl}` : output };
    }

    case "finish": {
      const summary = String(input.summary ?? "Task completed.");
      const filesChanged: string[] = Array.isArray(input.files_changed)
        ? (input.files_changed as string[]).map(String)
        : ctx.filesChanged;
      const prUrl = input.pr_url ? String(input.pr_url) : undefined;
      return { done: true, summary, filesChanged, prUrl };
    }

    default:
      return { done: false, output: `Unknown tool: ${toolName}` };
  }
}

// ── Main Claude agent loop ────────────────────────────────────────────────────

async function runAgentLoop(
  task: string,
  ctx: ToolContext,
  maxTurns: number,
  specialistName?: string,
  specialistContext?: string,
): Promise<{ summary: string; filesChanged: string[]; prUrl?: string; turnsUsed: number }> {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

  const accessNote = ctx.token
    ? ""
    : "\n⚠️ ANONYMOUS ACCESS: No GitHub PAT configured. You have READ-ONLY access to this public repository. Skip write_file, delete_file, create_branch, create_pull_request — focus on reading and analysis only.";

  const specialistNote = specialistName && specialistContext
    ? `\n\nACTIVE SPECIALIST: ${specialistName}\nYou are operating as this specialist. Apply their frameworks and expertise to the code review.\n\n${specialistContext.slice(0, 3000)}\n— END SPECIALIST OVERLAY —`
    : "";

  const messages: ClaudeMessage[] = [
    {
      role: "user",
      content:
        `Task: ${task}\n\n` +
        `Repository: ${ctx.owner}/${ctx.repo}\n` +
        `Working branch: ${ctx.branch}\n` +
        `Base branch: ${ctx.baseBranch}\n` +
        (ctx.createPr ? "When done, create a pull request.\n" : "") +
        accessNote +
        specialistNote +
        "\n\nStart by exploring the repository structure, then plan and execute the task.",
    },
  ];

  let turnsUsed = 0;
  let lastTextSummary = "";

  while (turnsUsed < maxTurns) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "interleaved-thinking-2025-05-14",
      },
      body: JSON.stringify({
        model: AGENT_MODEL,
        max_tokens: 16000,
        thinking: { type: "enabled", budget_tokens: 8000 },
        system: AGENT_SYSTEM_PROMPT,
        tools: SE_TOOLS,
        messages,
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Claude API error ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    const stopReason: string = data.stop_reason ?? "end_turn";
    const contentBlocks: ContentBlock[] = data.content ?? [];

    turnsUsed++;

    // Collect the last text block for fallback summary
    const textBlocks = contentBlocks.filter((b): b is TextBlock => b.type === "text");
    if (textBlocks.length > 0) {
      lastTextSummary = textBlocks.map((b) => b.text).join("\n");
    }

    // Push the assistant turn onto the message history (include thinking blocks for context)
    messages.push({ role: "assistant", content: contentBlocks });

    // ── Check for tool_use blocks ─────────────────────────────────────────────
    const toolUseBlocks = contentBlocks.filter((b): b is ToolUseBlock => b.type === "tool_use");

    if (toolUseBlocks.length === 0) {
      // No tool calls — treat as task complete (end_turn or max_tokens)
      console.log(`[mavis-code-agent] No tool calls on turn ${turnsUsed}, stop_reason=${stopReason}`);
      break;
    }

    // ── Execute all tool calls sequentially and collect results ───────────────
    const toolResultContents: ToolResultBlock[] = [];
    let finishResult: FinishResult | null = null;

    for (const toolBlock of toolUseBlocks) {
      console.log(`[mavis-code-agent] Turn ${turnsUsed}: calling ${toolBlock.name}`);

      let toolOutput: string;
      try {
        const result = await dispatchTool(toolBlock.name, toolBlock.input, ctx);

        if (result.done) {
          finishResult = result;
          toolOutput = `Task finished: ${result.summary}`;
        } else {
          toolOutput = result.output;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[mavis-code-agent] Tool ${toolBlock.name} failed:`, msg);

        // Re-throw auth / not-found errors immediately — no point continuing
        if (msg === "GITHUB_AUTH_ERROR" || msg.startsWith("GITHUB_NOT_FOUND:")) {
          throw new Error(msg);
        }

        toolOutput = `Error executing ${toolBlock.name}: ${msg}`;
      }

      toolResultContents.push({
        type: "tool_result",
        tool_use_id: toolBlock.id,
        content: toolOutput,
      });

      // If finish was called, break out of tool execution
      if (finishResult) break;
    }

    // Push all tool results as a single user message (required by Claude API)
    messages.push({ role: "user", content: toolResultContents as unknown as ContentBlock[] });

    // If finish was called, return immediately
    if (finishResult) {
      return {
        summary: finishResult.summary,
        filesChanged: finishResult.filesChanged.length > 0
          ? finishResult.filesChanged
          : ctx.filesChanged,
        prUrl: finishResult.prUrl,
        turnsUsed,
      };
    }
  }

  // ── Exited loop without finish — use last text as summary ─────────────────
  console.log(
    `[mavis-code-agent] Loop ended after ${turnsUsed} turn(s) without explicit finish call`,
  );

  return {
    summary: lastTextSummary || `Task processing completed after ${turnsUsed} turn(s).`,
    filesChanged: ctx.filesChanged,
    prUrl: undefined,
    turnsUsed,
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req: Request): Promise<Response> => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // Only accept POST
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const userId = await getUserId(req);
  if (!userId) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (!ANTHROPIC_KEY) {
    return json({ error: "ANTHROPIC_API_KEY is not configured" }, 500);
  }

  // ── Supabase service-role client ─────────────────────────────────────────
  const supabase = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

  // ── Read GitHub PAT (optional — public repos work without one) ───────────
  const githubToken = await getGitHubToken(supabase, userId);
  // Not a hard fail — anonymous access works for public repos (read-only, 60 req/hr)

  // ── Parse request body ────────────────────────────────────────────────────
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const task = String(body.task ?? "").trim();
  if (!task) {
    return json({ error: '"task" is required' }, 400);
  }

  // ── Resolve owner from GitHub /user if not provided (requires PAT) ────────
  let owner = String(body.owner ?? "").trim();
  if (!owner) {
    if (!githubToken) {
      return json({ error: '"owner" is required when no GitHub PAT is configured (cannot auto-resolve username anonymously).' }, 400);
    }
    try {
      const userRes = await fetch(`${GITHUB_API}/user`, {
        headers: ghHeaders(githubToken),
        signal: AbortSignal.timeout(10000),
      });
      if (!userRes.ok) {
        if (userRes.status === 401 || userRes.status === 403) {
          return json(
            { error: "GitHub token invalid or expired. Reconnect GitHub in Integrations." },
            400,
          );
        }
        return json({ error: "Failed to resolve GitHub username. Provide 'owner' explicitly." }, 400);
      }
      const userData = await userRes.json();
      owner = userData.login ?? "";
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return json({ error: `Failed to resolve GitHub username: ${msg}` }, 400);
    }
  }

  if (!owner) {
    return json({ error: '"owner" is required (could not resolve from GitHub token)' }, 400);
  }

  const repo = String(body.repo ?? "").trim();
  if (!repo) {
    return json({ error: '"repo" is required' }, 400);
  }

  const branch = String(body.branch ?? DEFAULT_BRANCH).trim();
  const baseBranch = String(body.base_branch ?? DEFAULT_BASE).trim();
  const createPr = body.create_pr !== false; // default true
  const rawMax = Number(body.max_turns ?? DEFAULT_MAX_TURNS);
  const maxTurns = Math.min(
    HARD_CAP_TURNS,
    Math.max(1, isNaN(rawMax) ? DEFAULT_MAX_TURNS : rawMax),
  );
  const specialistName = body.specialist_name ? String(body.specialist_name) : undefined;
  const specialistContext = body.specialist_context ? String(body.specialist_context) : undefined;

  console.log(
    `[mavis-code-agent] Starting: user=${userId} repo=${owner}/${repo} branch=${branch} maxTurns=${maxTurns} anonymous=${!githubToken} specialist=${specialistName ?? "none"}`,
  );

  // ── Build tool context ────────────────────────────────────────────────────
  const ctx: ToolContext = {
    token: githubToken,
    owner,
    repo,
    branch,
    baseBranch,
    createPr,
    filesChanged: [],
  };

  // ── Run the agent loop ────────────────────────────────────────────────────
  try {
    const result = await runAgentLoop(task, ctx, maxTurns, specialistName, specialistContext);

    const response: AgentResponse = {
      summary: result.summary,
      files_changed: result.filesChanged,
      pr_url: result.prUrl,
      turns_used: result.turnsUsed,
      repo: `${owner}/${repo}`,
      branch,
    };

    console.log(
      `[mavis-code-agent] Done: turns=${result.turnsUsed} files=${result.filesChanged.length} pr=${result.prUrl ?? "none"}`,
    );

    return json(response);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[mavis-code-agent] Fatal error:", msg);

    // Surface well-known error types as friendly messages
    if (msg === "GITHUB_AUTH_ERROR") {
      return json(
        { error: "GitHub token invalid or expired. Reconnect GitHub in Integrations." },
        400,
      );
    }
    if (msg.startsWith("GITHUB_NOT_FOUND:")) {
      const context = msg.slice("GITHUB_NOT_FOUND:".length);
      return json({ error: `Repository not found: ${owner}/${repo} (${context})` }, 404);
    }

    return json({ error: msg }, 500);
  }
});
