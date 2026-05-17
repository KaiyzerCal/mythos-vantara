import { supabase } from "@/integrations/supabase/client";
import { parseActions } from "./parseActions";
import { executeActions } from "./actionExecutor";
import type { ExecutionResult } from "./types";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

/**
 * Low-level AI invocation — calls the mavis-chat edge function and returns
 * the raw text response. Used by CouncilBoard and other multi-agent flows.
 */
export async function invokeAI(
  systemPrompt: string,
  messages: { role: string; content: string }[],
  mode = "PRIME",
  chatKind = "council",
): Promise<string> {
  const { data: fnData, error } = await supabase.functions.invoke("mavis-chat", {
    body: {
      messages,
      systemPrompt,
      mode,
      chatKind,
      threadRef: "council-board",
      attachmentIds: [],
    },
  });
  if (error) throw error;
  return (fnData as any)?.content ?? "[No response]";
}

export interface ChatServiceOptions {
  mode: string;
  conversationId?: string | null;
  appState?: string;
  chatKind?: string;
  threadRef?: string;
  attachmentIds?: string[];
}

export interface ChatServiceResult {
  rawText: string;
  cleanText: string;
  executionResults: ExecutionResult[];
  conversationId: string | null;
  searched: boolean;
  imageUrl: string | null;
  fnData: Record<string, unknown> | null;
}

// Streaming variant — calls the edge function with stream:true and reads SSE.
// onToken is called for each text chunk as it arrives.
// Returns the same ChatServiceResult shape as sendChatMessage for drop-in use.
export async function streamChatMessage(
  userText: string,
  systemPrompt: string,
  history: Array<{ role: string; content: string }>,
  options: ChatServiceOptions,
  onToken: (token: string, accumulated: string) => void,
): Promise<ChatServiceResult> {
  const messages = [...history, { role: "user", content: userText }];
  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token ?? "";

  const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      messages,
      systemPrompt,
      mode: options.mode,
      conversationId: options.conversationId ?? null,
      appState: options.appState ?? "",
      chatKind: options.chatKind ?? "mavis",
      threadRef: options.threadRef ?? "main",
      attachmentIds: options.attachmentIds ?? [],
      stream: true,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`Stream request failed (${res.status}): ${errText}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";
  let buf = "";
  let metadata: Record<string, unknown> = {};

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      try {
        const j = JSON.parse(raw);
        if (j.t) { accumulated += j.t; onToken(j.t, accumulated); }
        if (j.done) metadata = j;
        if (j.error) throw new Error(j.error);
      } catch (parseErr: any) {
        if (parseErr.message?.includes("unavailable") || parseErr.message?.includes("providers")) throw parseErr;
        /* skip malformed SSE lines */
      }
    }
  }

  const { cleanText, actions: parsedActions } = parseActions(accumulated);
  const executionResults: ExecutionResult[] = parsedActions.length > 0
    ? await executeActions(parsedActions)
    : [];

  return {
    rawText: accumulated,
    cleanText,
    executionResults,
    conversationId: (metadata.conversationId as string | null) ?? options.conversationId ?? null,
    searched: metadata.searched === true,
    imageUrl: (metadata.imageUrl as string | null) ?? null,
    fnData: metadata as Record<string, unknown>,
  };
}

export async function sendChatMessage(
  userText: string,
  systemPrompt: string,
  history: Array<{ role: string; content: string }>,
  options: ChatServiceOptions,
): Promise<ChatServiceResult> {
  const messages = [...history, { role: "user", content: userText }];

  const { data: fnData, error } = await supabase.functions.invoke("mavis-chat", {
    body: {
      messages,
      systemPrompt,
      mode: options.mode,
      conversationId: options.conversationId ?? null,
      appState: options.appState ?? "",
      chatKind: options.chatKind ?? "mavis",
      threadRef: options.threadRef ?? "main",
      attachmentIds: options.attachmentIds ?? [],
    },
  });

  if (error) throw error;

  const rawText: string = (fnData as any)?.content ?? "Systems error — unable to process request.";

  const { cleanText, actions: parsedActions } = parseActions(rawText);
  const inferredActions = Array.isArray((fnData as any)?.actions) ? (fnData as any).actions : [];
  const actionsToRun = parsedActions.length > 0 ? parsedActions : inferredActions;

  const executionResults: ExecutionResult[] = actionsToRun.length > 0
    ? await executeActions(actionsToRun)
    : [];

  return {
    rawText,
    cleanText,
    executionResults,
    conversationId: (fnData as any)?.conversationId ?? options.conversationId ?? null,
    searched: (fnData as any)?.searched === true,
    imageUrl: (fnData as any)?.imageUrl ?? null,
    fnData: fnData as Record<string, unknown> | null,
  };
}
