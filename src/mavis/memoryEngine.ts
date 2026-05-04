import type { MavisMessage } from "./types";

let _messages: MavisMessage[] = [];

export function getMessages(): MavisMessage[] { return [..._messages]; }
export function addMessage(msg: MavisMessage): void { _messages = [..._messages, msg]; }
export function clearMessages(): void { _messages = []; }
export function getLastN(n: number): MavisMessage[] { return _messages.slice(-n); }

export function serializeMessages(): string { return JSON.stringify(_messages); }
export function loadMessages(serialized: string): void {
  try {
    const parsed = JSON.parse(serialized) as MavisMessage[];
    if (Array.isArray(parsed)) _messages = parsed;
  } catch { console.warn("[MAVIS:MemoryEngine] Failed to load messages"); }
}

export function makeMessage(role: MavisMessage["role"], content: string): MavisMessage {
  return { id: crypto.randomUUID(), role, content, timestamp: Date.now() };
}
