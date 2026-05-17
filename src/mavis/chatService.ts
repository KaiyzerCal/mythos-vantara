import { supabase } from "@/integrations/supabase/client";
import { parseActions } from "./parseActions";
import { executeActions } from "./actionExecutor";
import type { ExecutionResult } from "./types";

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
