import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export function useInlineCompose() {
  const [isComposing, setIsComposing] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const getSuggestion = useCallback(async (
    currentText: string,
    context?: string, // optional vault/journal context
    systemHint?: string,
  ) => {
    if (currentText.trim().length < 10) return;
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    setIsComposing(true);
    setSuggestion(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token ?? "";

      const system = systemHint ??
        "You are an AI writing assistant integrated into MAVIS. The user is writing in their personal journal or vault. " +
        "Continue their text naturally in 1-2 sentences. Match their tone exactly. Output ONLY the continuation — no quotes, no explanation.";

      const userMsg = context
        ? `Context from vault:\n${context}\n\nCurrent text:\n${currentText}\n\nContinue:`
        : `Current text:\n${currentText}\n\nContinue:`;

      const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({
          messages: [{ role: "user", content: userMsg }],
          systemPrompt: system,
          mode: "CHAT",
          chatKind: "inline-compose",
          stream: false,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error("Compose failed");
      const data = await res.json();
      const text = data?.content ?? data?.rawText ?? "";
      if (text.trim()) setSuggestion(text.trim());
    } catch {
      // silent — suggestions are non-critical
    } finally {
      setIsComposing(false);
    }
  }, []);

  const accept = useCallback(() => {
    const s = suggestion;
    setSuggestion(null);
    return s;
  }, [suggestion]);

  const dismiss = useCallback(() => setSuggestion(null), []);

  return { getSuggestion, accept, dismiss, suggestion, isComposing };
}
