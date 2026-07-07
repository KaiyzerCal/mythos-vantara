import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

export type PageAction = {
  action: "navigate" | "click" | "type" | "scroll" | "respond";
  path?: string;
  selector?: string;
  text?: string;
  value?: string;
  direction?: "top" | "bottom" | "up" | "down";
  message?: string;
  description: string;
  error?: string;
};

// ── Route table for client-side fallback ──────────────────────────────────────
const ROUTE_PATTERNS: Array<{ patterns: string[]; path: string; label: string }> = [
  { patterns: ["mavis", "chat", "ai", "talk"], path: "/mavis", label: "MAVIS Chat" },
  { patterns: ["journal", "diary", "log"], path: "/journal", label: "Journal" },
  { patterns: ["knowledge", "graph", "notes", "note", "kg"], path: "/knowledge", label: "Knowledge Graph" },
  { patterns: ["skill", "catalog", "abilities"], path: "/skills", label: "Skills" },
  { patterns: ["agency", "advisor", "c-suite", "executive"], path: "/agency", label: "Agency" },
  { patterns: ["quest", "mission"], path: "/quests", label: "Quests" },
  { patterns: ["goal", "objectives", "okr"], path: "/goals", label: "Goals" },
  { patterns: ["calendar", "schedule", "events"], path: "/calendar", label: "Calendar" },
  { patterns: ["task", "todo", "to-do"], path: "/tasks", label: "Tasks" },
  { patterns: ["memory", "memories"], path: "/memory", label: "Memory" },
  { patterns: ["notebook", "research"], path: "/notebook", label: "Notebook" },
  { patterns: ["analytics", "metrics", "stats"], path: "/analytics", label: "Analytics" },
  { patterns: ["setting", "config", "preferences"], path: "/settings", label: "Settings" },
  { patterns: ["vault", "codex"], path: "/vault", label: "Vault" },
  { patterns: ["health", "fitness", "wellness"], path: "/health", label: "Health" },
  { patterns: ["finance", "money", "expense", "budget"], path: "/finance", label: "Finance" },
  { patterns: ["email", "inbox", "gmail"], path: "/email", label: "Email" },
  { patterns: ["contact", "people", "crm"], path: "/contacts", label: "Contacts" },
  { patterns: ["workflow", "automation"], path: "/workflows", label: "Workflows" },
  { patterns: ["agent", "agents", "my agent"], path: "/agents", label: "Agents" },
  { patterns: ["world", "monitor", "global"], path: "/world-monitor", label: "World Monitor" },
  { patterns: ["voice", "lab", "tts"], path: "/voice-lab", label: "Voice Lab" },
  { patterns: ["prompt", "prompt vault"], path: "/prompt-vault", label: "Prompt Vault" },
  { patterns: ["home", "dashboard", "overview"], path: "/", label: "Dashboard" },
  { patterns: ["council", "board"], path: "/council-board", label: "Council Board" },
  { patterns: ["ally", "allies", "team"], path: "/allies", label: "Allies" },
  { patterns: ["ranking", "rank", "leaderboard"], path: "/rankings", label: "Rankings" },
  { patterns: ["tower"], path: "/tower", label: "Tower" },
  { patterns: ["forecast", "predict"], path: "/forecast", label: "Forecast" },
  { patterns: ["notification"], path: "/notifications", label: "Notifications" },
  { patterns: ["integrations", "connect"], path: "/integrations", label: "Integrations" },
  { patterns: ["store", "shop"], path: "/store", label: "Store" },
  { patterns: ["scouter", "scout"], path: "/scouter", label: "Scouter" },
  { patterns: ["persona", "identity"], path: "/personas", label: "Personas" },
  { patterns: ["inventory", "items"], path: "/inventory", label: "Inventory" },
  { patterns: ["social", "post", "publish"], path: "/social-analytics", label: "Social Analytics" },
  { patterns: ["design", "studio"], path: "/design-studio", label: "Design Studio" },
  { patterns: ["code", "code studio"], path: "/code-studio", label: "Code Studio" },
  { patterns: ["factory"], path: "/factory", label: "Factory" },
  { patterns: ["plans", "plan board", "plan"], path: "/plans", label: "Plan Board" },
];

// Best-effort client-side command parser — runs when edge function is unavailable
function parseCommandLocally(command: string): PageAction | null {
  const lower = command.toLowerCase();

  // Navigation intent
  const navTriggers = ["go to", "open", "navigate", "take me", "show me", "switch to", "visit", "load"];
  const isNavIntent = navTriggers.some(t => lower.includes(t)) || lower.startsWith("go ");

  if (isNavIntent) {
    for (const { patterns, path, label } of ROUTE_PATTERNS) {
      if (patterns.some(p => lower.includes(p))) {
        return { action: "navigate", path, description: `Navigating to ${label}` };
      }
    }
  }

  // Direct route match even without nav trigger
  for (const { patterns, path, label } of ROUTE_PATTERNS) {
    if (patterns.some(p => lower.includes(p))) {
      return { action: "navigate", path, description: `Opening ${label}` };
    }
  }

  // Scroll commands
  if (lower.includes("scroll top") || lower.includes("scroll up") || lower.includes("top of")) {
    return { action: "scroll", direction: "top", description: "Scrolled to top" };
  }
  if (lower.includes("scroll bottom") || lower.includes("scroll down") || lower.includes("bottom of")) {
    return { action: "scroll", direction: "bottom", description: "Scrolled to bottom" };
  }

  return null;
}

function snapshotPage(): string {
  const lines: string[] = [`route: ${window.location.pathname}`];

  const seen = new Set<string>();
  document.querySelectorAll("a[href]").forEach((el) => {
    const text = el.textContent?.trim().slice(0, 60);
    const href = (el as HTMLAnchorElement).getAttribute("href");
    if (text && href && !seen.has(text)) {
      seen.add(text);
      lines.push(`link: "${text}" → ${href}`);
    }
  });

  let btnCount = 0;
  document.querySelectorAll("button:not([disabled])").forEach((el) => {
    if (btnCount >= 60) return;
    const text = el.textContent?.trim().slice(0, 60);
    const label = el.getAttribute("aria-label") || el.getAttribute("title");
    const display = label || text;
    if (display) { lines.push(`button: "${display}"`); btnCount++; }
  });

  document.querySelectorAll("input:not([type='hidden']), textarea").forEach((el) => {
    const placeholder = el.getAttribute("placeholder");
    const label = el.getAttribute("aria-label") || el.getAttribute("name");
    const display = label || placeholder;
    if (display) lines.push(`input: "${display}"`);
  });

  return lines.slice(0, 80).join("\n");
}

function applyAction(action: PageAction, navigate: (path: string) => void) {
  switch (action.action) {
    case "navigate":
      if (action.path) navigate(action.path);
      break;

    case "click": {
      let target: Element | null = null;
      if (action.selector) {
        try { target = document.querySelector(action.selector); } catch { /* invalid */ }
      }
      if (!target && action.text) {
        const needle = action.text.toLowerCase();
        for (const el of document.querySelectorAll("button, a, [role='button'], [role='menuitem']")) {
          if (el.textContent?.trim().toLowerCase().includes(needle) ||
              el.getAttribute("aria-label")?.toLowerCase().includes(needle)) {
            target = el; break;
          }
        }
      }
      if (target) (target as HTMLElement).click();
      break;
    }

    case "type": {
      const sel = action.selector ?? "";
      let inp: HTMLInputElement | HTMLTextAreaElement | null = null;
      try { inp = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(sel); } catch { /* invalid */ }
      if (inp && action.value !== undefined) {
        inp.focus();
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set ||
          Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
        if (nativeSetter) nativeSetter.call(inp, action.value);
        else inp.value = action.value;
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
      }
      break;
    }

    case "scroll":
      switch (action.direction) {
        case "top":    window.scrollTo({ top: 0, behavior: "smooth" }); break;
        case "bottom": window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); break;
        case "up":     window.scrollBy({ top: -400, behavior: "smooth" }); break;
        case "down":   window.scrollBy({ top: 400, behavior: "smooth" }); break;
      }
      break;
  }
}

export function usePageAgent() {
  const navigate = useNavigate();
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<PageAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async (command: string): Promise<PageAction> => {
    setRunning(true);
    setError(null);

    try {
      // ── Try edge function first ────────────────────────────────────────────
      let result: PageAction | null = null;

      try {
        const pageContext = snapshotPage();
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mavis-page-agent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`,
              "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
            body: JSON.stringify({ command, pageContext }),
            signal: AbortSignal.timeout(8000),
          }
        );

        if (res.ok) result = await res.json();
      } catch {
        // Edge function unavailable — fall through to local parsing
      }

      // ── Fallback: client-side pattern matching ─────────────────────────────
      if (!result) {
        result = parseCommandLocally(command) ?? {
          action: "respond",
          message: `I couldn't understand "${command}". Try: "open journal", "go to agency", "navigate to goals".`,
          description: "Unrecognized command",
        };
      }

      setLastResult(result);
      applyAction(result, navigate);
      return result;

    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      const fallback: PageAction = { action: "respond", message: `Error: ${msg}`, description: "Error" };
      setLastResult(fallback);
      return fallback;
    } finally {
      setRunning(false);
    }
  }, [navigate]);

  return { execute, running, lastResult, error };
}
