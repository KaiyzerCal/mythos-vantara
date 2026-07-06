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

function snapshotPage(): string {
  const lines: string[] = [`route: ${window.location.pathname}`];

  // Navigation links
  const seen = new Set<string>();
  document.querySelectorAll("a[href]").forEach((el) => {
    const text = el.textContent?.trim().slice(0, 60);
    const href = (el as HTMLAnchorElement).getAttribute("href");
    if (text && href && !seen.has(text)) {
      seen.add(text);
      lines.push(`link: "${text}" → ${href}`);
    }
  });

  // Buttons (cap at 60)
  let btnCount = 0;
  document.querySelectorAll("button:not([disabled])").forEach((el) => {
    if (btnCount >= 60) return;
    const text = el.textContent?.trim().slice(0, 60);
    const label = el.getAttribute("aria-label") || el.getAttribute("title");
    const display = label || text;
    if (display) {
      lines.push(`button: "${display}"`);
      btnCount++;
    }
  });

  // Inputs
  document.querySelectorAll("input:not([type='hidden']), textarea").forEach((el) => {
    const placeholder = el.getAttribute("placeholder");
    const label = el.getAttribute("aria-label") || el.getAttribute("name");
    const display = label || placeholder;
    if (display) lines.push(`input: "${display}"`);
  });

  return lines.slice(0, 80).join("\n");
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
        }
      );

      if (!res.ok) {
        const err = await res.text();
        throw new Error(err);
      }

      const result: PageAction = await res.json();
      setLastResult(result);

      // Execute the resolved action in the DOM
      switch (result.action) {
        case "navigate":
          if (result.path) navigate(result.path);
          break;

        case "click": {
          let target: Element | null = null;
          if (result.selector) {
            try { target = document.querySelector(result.selector); } catch { /* invalid selector */ }
          }
          if (!target && result.text) {
            const needle = result.text.toLowerCase();
            for (const el of document.querySelectorAll("button, a, [role='button'], [role='menuitem']")) {
              if (el.textContent?.trim().toLowerCase().includes(needle) ||
                  el.getAttribute("aria-label")?.toLowerCase().includes(needle)) {
                target = el;
                break;
              }
            }
          }
          if (target) (target as HTMLElement).click();
          break;
        }

        case "type": {
          const sel = result.selector ?? "";
          let inp: HTMLInputElement | HTMLTextAreaElement | null = null;
          try { inp = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(sel); } catch { /* invalid */ }
          if (inp && result.value !== undefined) {
            inp.focus();
            // Use native setter for React-controlled inputs
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set ||
              Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
            if (nativeInputValueSetter) {
              nativeInputValueSetter.call(inp, result.value);
            } else {
              inp.value = result.value;
            }
            inp.dispatchEvent(new Event("input", { bubbles: true }));
            inp.dispatchEvent(new Event("change", { bubbles: true }));
          }
          break;
        }

        case "scroll":
          switch (result.direction) {
            case "top":    window.scrollTo({ top: 0, behavior: "smooth" }); break;
            case "bottom": window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); break;
            case "up":     window.scrollBy({ top: -400, behavior: "smooth" }); break;
            case "down":   window.scrollBy({ top: 400, behavior: "smooth" }); break;
          }
          break;

        // "respond" — no DOM action, message shown in UI
      }

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
