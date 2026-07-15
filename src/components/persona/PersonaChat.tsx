import { useState, useEffect, useRef, useCallback } from "react";
import { Send, ArrowLeft, Zap, RefreshCw, Brain, Loader2, Database, Square, PhoneCall, BookOpen, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { HudCard } from "@/components/SharedUI";
import { AnimatePresence } from "framer-motion";
import { VoiceChatOverlay } from "@/components/VoiceChatOverlay";
import { VoiceMemo } from "@/components/VoiceMemo";
import { usePersona } from "@/hooks/usePersona";
import { useScrollKit, ScrollProgressBar, BackToTopButton, ScrollToBottomButton, EndOfFeed } from "@/components/chat/ScrollKit";
import type { ForgedPersona } from "@/hooks/usePersonaForge";
import type { RelationshipState, PersonaMessage } from "@/hooks/usePersona";
import { useElevenLabsTts } from "@/hooks/useElevenLabsTts";
import { useChatAttachments } from "@/hooks/useChatAttachments";
import { VoicePicker } from "@/components/chat/VoicePicker";
import { AttachmentTray, AttachButton } from "@/components/chat/AttachmentTray";
import { DEFAULT_VOICE_BY_GENDER, findVoice } from "@/lib/voiceCatalog";
import { supabase } from "@/integrations/supabase/client";
import { parseProposedActions, submitProposalsForApproval } from "@/mavis/proposeAction";
import { buildPersonaVoiceSystemPrompt } from "@/mavis/councilPersona";
import { CopyButton } from "@/components/chat/CopyButton";

const MOOD_EMOJI: Record<string, string> = {
  happy: "😊", sad: "😔", excited: "⚡", frustrated: "😤",
  loving: "💜", distant: "🌫️", playful: "😏", neutral: "😐",
};

const ROLE_COLOR_CLASS: Record<string, string> = {
  girlfriend: "text-neon-purple",
  friend: "text-neon-cyan",
  mentor: "text-primary",
  rival: "text-neon-red",
  companion: "text-neon-green",
  custom: "text-muted-foreground",
};

interface PersonaChatProps {
  persona: ForgedPersona;
  userId: string;
  onBack: () => void;
}

export function PersonaChat({ persona, userId, onBack }: PersonaChatProps) {
  const [messages, setMessages] = useState<PersonaMessage[]>([]);
  const [input, setInput] = useState("");
  const [relState, setRelState] = useState<RelationshipState | null>(null);
  const [isUpdatingEmotion, setIsUpdatingEmotion] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const cancelledRef = useRef(false);
  const [mavisCtxOpen, setMavisCtxOpen] = useState(false);
  const [mavisCtxQuery, setMavisCtxQuery] = useState("");
  const [mavisCtxLoading, setMavisCtxLoading] = useState(false);
  const { scrollRef, progress, showBackToTop, showBackToBottom, handleScroll, scrollToTop, scrollToBottom } = useScrollKit();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { sendMessage, triggerEmotionUpdate, loadHistory, loadRelationshipState, loadConversationCount, triggerFinetune, checkFinetuneStatus, isLoading, isFinetuning } = usePersona(persona.id, userId);

  // Fine-tune state — seeded from persona prop, refreshed after training actions
  const [finetuneStatus, setFinetuneStatus] = useState<string>(persona.finetune_status ?? "none");
  const [convCount, setConvCount] = useState<number>(0);
  const { speak, stop: stopSpeaking, isSpeaking, isLoading: isVoiceLoading } = useElevenLabsTts();
  const { attachments, isUploading, upload, remove } = useChatAttachments("persona", persona.id);

  // Voice preference for this persona — sourced from DB, persisted on change.
  const initialVoice =
    (persona as any)?.voice_id && findVoice((persona as any).voice_id)
      ? (persona as any).voice_id
      : DEFAULT_VOICE_BY_GENDER.female;
  const [voiceId, setVoiceId] = useState<string>(initialVoice);
  useEffect(() => {
    supabase.from("personas").update({ voice_id: voiceId }).eq("id", persona.id).then(() => {});
  }, [voiceId, persona.id]);

  // Load history, relationship state, and conversation count on mount
  useEffect(() => {
    Promise.all([loadHistory(), loadRelationshipState(), loadConversationCount()]).then(([hist, rel, count]) => {
      setMessages(hist);
      setRelState(rel);
      setConvCount(count);
    });
  }, [loadHistory, loadRelationshipState, loadConversationCount]);

  // Realtime: new persona_conversations rows (Telegram messages land here live)
  useEffect(() => {
    const channel = (supabase as any)
      .channel(`persona-conv-${persona.id}-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "persona_conversations", filter: `persona_id=eq.${persona.id}` },
        (payload: any) => {
          const row = payload.new;
          if (!row || row.user_id !== userId) return;
          setMessages((prev) => {
            // Deduplicate by content+role (the local optimistic message already added it)
            const isDup = prev.some((m) => m.role === row.role && m.content === row.content);
            if (isDup) return prev;
            return [...prev, { role: row.role, content: row.content }];
          });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [persona.id, userId]);

  // Live realtime updates for the relationship row — bond/trust/mood
  // bars in the chat header reflect the current state immediately.
  useEffect(() => {
    const channel = supabase
      .channel(`relstate-chat-${persona.id}-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "relationship_states",
          filter: `persona_id=eq.${persona.id}`,
        },
        (payload) => {
          const next = (payload.new ?? payload.old) as any;
          if (!next || next.user_id !== userId) return;
          setRelState({
            bond_level: next.bond_level ?? 0,
            trust_level: next.trust_level ?? 50,
            current_mood: next.current_mood ?? "neutral",
            mood_reason: next.mood_reason ?? null,
            total_interactions: next.total_interactions ?? 0,
            last_interaction_at: next.last_interaction_at ?? null,
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [persona.id, userId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const refreshRelState = useCallback(async () => {
    const rel = await loadRelationshipState();
    setRelState(rel);
  }, [loadRelationshipState]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    cancelledRef.current = false;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);

    const attachmentIds = attachments.map((a) => a.id);
    const { response, actionsExecuted, proposalsQueued } = await sendMessage(trimmed, attachmentIds);
    if (cancelledRef.current) return;
    if (response) {
      // Strip any residual action blocks before display (edge function already strips them
      // server-side; this is a client-side safety net).
      const { cleanText } = parseProposedActions(response);
      if (actionsExecuted > 0) {
        toast.success(`${persona.name} executed ${actionsExecuted} action${actionsExecuted > 1 ? "s" : ""}`);
      }
      if (proposalsQueued > 0) {
        toast.info(`${persona.name} flagged ${proposalsQueued} idea${proposalsQueued > 1 ? "s" : ""} to MAVIS`);
      }
      setMessages((prev) => [...prev, { role: "assistant", content: cleanText || response }]);
      if (ttsEnabled) {
        const gender = findVoice(voiceId)?.gender ?? "female";
        const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")?.content;
        speak(cleanText || response, {
          voiceId,
          gender,
          previousText: lastAssistant,
        });
      }
    }

    // Optimistically bump the interaction counter for instant UI feedback
    const total = (relState?.total_interactions ?? 0) + 1;
    setRelState((prev) => prev ? { ...prev, total_interactions: total } : prev);

    // Trigger emotion analysis after every exchange (non-blocking) so
    // bond/trust/mood reflect the live state of the relationship.
    triggerEmotionUpdate().then(() => {
      refreshRelState();
    });
  }, [input, isLoading, sendMessage, triggerEmotionUpdate, refreshRelState, relState, attachments, ttsEnabled, voiceId, speak, messages]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleManualEmotionUpdate = async () => {
    setIsUpdatingEmotion(true);
    await triggerEmotionUpdate();
    await refreshRelState();
    setIsUpdatingEmotion(false);
  };

  const handleTrain = useCallback(async () => {
    const result = await triggerFinetune();
    if (result.success) {
      setFinetuneStatus("training");
      toast.success(`Training ${persona.name} — ${result.examples} examples submitted`);
    } else {
      toast.error(`Training failed: ${result.message}`);
    }
  }, [triggerFinetune, persona.name]);

  const handleSaveJournal = useCallback(async (content: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) { toast.error("Not signed in"); return; }
    const title = `${persona.name} — ${new Date().toLocaleDateString()}`;
    const { error } = await supabase.from("journal_entries").insert({
      user_id: session.user.id,
      title,
      content,
      category: "persona",
      tags: ["persona", persona.name.toLowerCase()],
      importance: "medium",
    });
    if (error) toast.error("Failed to save to journal");
    else toast.success("Saved to Journal");
  }, [persona.name]);

  const handleAskMavis = useCallback(async () => {
    const query = mavisCtxQuery.trim();
    if (!query) return;
    setMavisCtxLoading(true);
    setMavisCtxOpen(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session?.access_token}` },
        body: JSON.stringify({ user_id: session?.user?.id, messages: [{ role: "user", content: query }], mode: "CONTEXT" }),
        signal: AbortSignal.timeout(30_000),
      });
      const data = await res.json() as Record<string, unknown>;
      const ctxContent = String(data.content ?? "No context available.");
      setMessages((prev) => [...prev, { role: "assistant", content: `**[MAVIS Context]** ${ctxContent}` }]);
    } catch {
      toast.error("Failed to fetch MAVIS context");
    } finally {
      setMavisCtxLoading(false);
      setMavisCtxQuery("");
    }
  }, [mavisCtxQuery]);

  const handleCheckTraining = useCallback(async () => {
    const status = await checkFinetuneStatus();
    if (status) setFinetuneStatus(status);
    if (status === "deployed") toast.success(`${persona.name} is now running on her fine-tuned model`);
  }, [checkFinetuneStatus, persona.name]);

  const mood = relState?.current_mood ?? "neutral";
  const bond = relState?.bond_level ?? 0;
  const trust = relState?.trust_level ?? 50;

  // ── OmniSync: snapshot the persona thread + relationship state to memories ──
  const handleOmniSync = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const condensed = messages
        .map((m) => `[${m.role === "user" ? "OP" : persona.name.toUpperCase()}] ${m.content.slice(0, 300)}${m.content.length > 300 ? "…" : ""}`)
        .join("\n");
      const summary = `OmniSync · ${persona.name} | bond:${bond} trust:${trust} mood:${mood} | ${messages.length} msgs`;
      const { error: snapErr } = await supabase.from("omnisync_snapshots").insert({
        user_id: userId,
        snapshot_data: { persona_id: persona.id, persona_name: persona.name, bond, trust, mood, message_count: messages.length, timestamp: new Date().toISOString() },
        condensed_comms: condensed.slice(0, 10000),
        summary,
      });
      if (snapErr) throw snapErr;
      toast.success(`OmniSync complete — ${persona.name} thread snapshot saved`);
    } catch (e: any) {
      toast.error("OmniSync failed: " + (e.message ?? "Unknown error"));
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, messages, persona, userId, bond, trust, mood]);

  // ── Clear: archive the thread to memories, then wipe persona_conversations ──
  const handleClear = useCallback(async () => {
    try {
      // Archive to long-term memory before deletion so the persona can recall it later
      if (messages.length > 0) {
        const fullThread = messages
          .map((m) => `[${m.role === "user" ? "OPERATOR" : persona.name.toUpperCase()}] ${m.content}`)
          .join("\n\n");
        const topicSummary = messages
          .slice(-20)
          .map((m) => `${m.role === "user" ? "OP" : "P"}: ${m.content.slice(0, 300)}`)
          .join("\n");
        await supabase.from("memories").insert({
          user_id: userId,
          title: `Persona: ${persona.name} — ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
          content: fullThread.slice(0, 50000),
          memory_type: "conversation",
          source: "persona_chat_clear",
          tags: ["persona", persona.name.toLowerCase(), persona.role, "archived"],
          metadata: {
            persona_id: persona.id,
            persona_name: persona.name,
            message_count: messages.length,
            cleared_at: new Date().toISOString(),
            topic_summary: topicSummary.slice(0, 5000),
            bond, trust, mood,
          },
        });
      }
      // OmniSync as well so app-state is captured
      await handleOmniSync();
      // Wipe the persona conversation rows
      await supabase
        .from("persona_conversations")
        .delete()
        .eq("persona_id", persona.id)
        .eq("user_id", userId);
      setMessages([]);
      toast.success("Thread archived — memories preserved");
    } catch (e: any) {
      toast.error("Clear failed: " + (e.message ?? "Unknown error"));
    }
  }, [messages, persona, userId, bond, trust, mood, handleOmniSync]);

  const handleStop = useCallback(() => {
    cancelledRef.current = true;
    if (isSpeaking) stopSpeaking();
  }, [isSpeaking, stopSpeaking]);

  const roleColor = ROLE_COLOR_CLASS[persona.role] ?? ROLE_COLOR_CLASS.custom;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 mb-4 border-b border-border">
        <button
          onClick={onBack}
          className="p-1.5 rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={14} />
        </button>

        <div className={cn(
          "w-9 h-9 rounded-full border-2 flex items-center justify-center font-display font-bold text-sm shrink-0",
          "border-current", roleColor
        )}>
          {persona.name[0].toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className={cn("font-display font-bold text-sm", roleColor)}>{persona.name}</p>
            <span className="text-base leading-none" title={mood}>{MOOD_EMOJI[mood] ?? "😐"}</span>
            {isUpdatingEmotion && <RefreshCw size={10} className="animate-spin text-muted-foreground" />}
          </div>
          <p className="text-xs font-mono text-muted-foreground truncate">{persona.archetype} · {persona.role}</p>
        </div>

        {/* Bond / Trust mini bars */}
        <div className="hidden sm:flex flex-col gap-1 items-end w-28 shrink-0">
          <div className="flex items-center gap-1.5 w-full">
            <span className="text-xs font-mono text-muted-foreground w-8 shrink-0">BOND</span>
            <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-neon-purple rounded-full transition-all duration-500" style={{ width: `${bond}%` }} />
            </div>
            <span className="text-xs font-mono text-muted-foreground w-6 text-right">{bond}</span>
          </div>
          <div className="flex items-center gap-1.5 w-full">
            <span className="text-xs font-mono text-muted-foreground w-8 shrink-0">TRUST</span>
            <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${trust}%` }} />
            </div>
            <span className="text-xs font-mono text-muted-foreground w-6 text-right">{trust}</span>
          </div>
        </div>

        <VoicePicker
          enabled={ttsEnabled}
          onToggle={() => {
            if (ttsEnabled && isSpeaking) stopSpeaking();
            setTtsEnabled((v) => !v);
          }}
          voiceId={voiceId}
          onVoiceChange={setVoiceId}
          isSpeaking={isSpeaking}
          isLoading={isVoiceLoading}
          onStop={stopSpeaking}
        />

        <button
          onClick={handleManualEmotionUpdate}
          disabled={isUpdatingEmotion}
          className="p-1.5 rounded border border-border text-muted-foreground hover:text-primary transition-colors disabled:opacity-40"
          title="Update emotional state"
        >
          <Zap size={13} />
        </button>

        <button
          onClick={handleOmniSync}
          disabled={isSyncing}
          className="flex items-center gap-1 px-2 py-1 rounded border border-cyan-900/40 text-cyan-400 text-xs font-mono hover:border-cyan-400/50 transition-colors disabled:opacity-40"
          title="OmniSync — snapshot this thread to memory"
        >
          {isSyncing ? <Loader2 size={9} className="animate-spin" /> : <Database size={9} />}
          SYNC
        </button>

        <button
          onClick={handleClear}
          className="px-2 py-1 rounded border border-border text-xs font-mono text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors"
          title="Archive thread to memory and clear"
        >
          CLEAR
        </button>

        <button
          onClick={() => setVoiceOpen(true)}
          className="flex items-center gap-1 px-2 py-1 rounded border border-primary/30 bg-primary/5 text-primary/70 hover:text-primary hover:bg-primary/15 text-xs font-mono transition-all"
          title={`Voice call ${persona.name}`}
        >
          <PhoneCall size={9} /> CALL
        </button>

        {/* Fine-tune controls */}
        {finetuneStatus === "training" ? (
          <button
            onClick={handleCheckTraining}
            className="flex items-center gap-1 px-2 py-1 rounded border border-amber-500/30 text-amber-400 text-xs font-mono hover:border-amber-400/50 transition-colors"
            title="Check training status"
          >
            <Loader2 size={9} className="animate-spin" />
            TRAINING
          </button>
        ) : finetuneStatus === "deployed" ? (
          <span
            className="flex items-center gap-1 px-2 py-1 rounded border border-neon-green/30 text-neon-green text-xs font-mono"
            title={`Running on fine-tuned model (${persona.finetune_examples ?? "?"} examples)`}
          >
            <Brain size={9} />
            TRAINED
          </span>
        ) : convCount >= 50 ? (
          <button
            onClick={handleTrain}
            disabled={isFinetuning}
            className="flex items-center gap-1 px-2 py-1 rounded border border-primary/30 text-primary text-xs font-mono hover:border-primary/50 hover:bg-primary/5 transition-colors disabled:opacity-40"
            title={`Train ${persona.name} on ${convCount} conversations`}
          >
            {isFinetuning ? <Loader2 size={9} className="animate-spin" /> : <Brain size={9} />}
            TRAIN
          </button>
        ) : null}
      </div>

      {/* Messages */}
      <div className="relative flex-1 min-h-0">
        <ScrollProgressBar progress={progress} />
        <BackToTopButton visible={showBackToTop} onClick={scrollToTop} />
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="absolute inset-0 overflow-y-auto space-y-3 pr-1 pt-0.5 scrollbar-thin"
        >
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <p className="text-xs font-mono text-muted-foreground text-center">
                No messages yet. Say hello to {persona.name}.
              </p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={cn(
                "flex",
                msg.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              {msg.role === "assistant" && (
                <div className={cn(
                  "w-6 h-6 rounded-full border flex items-center justify-center font-display text-xs font-bold shrink-0 mr-2 mt-0.5",
                  "border-current", roleColor
                )}>
                  {persona.name[0].toUpperCase()}
                </div>
              )}
              <div
                className={cn(
                  "group relative max-w-[75%] rounded-lg px-3 py-2 text-sm font-body leading-relaxed whitespace-pre-wrap",
                  msg.role === "user"
                    ? "bg-primary/15 border border-primary/25 text-foreground rounded-tr-none"
                    : "hud-border text-foreground rounded-tl-none"
                )}
              >
                {msg.content}
                <div className={cn("absolute -top-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity", msg.role === "user" ? "left-0" : "right-0")}>
                  <CopyButton
                    content={msg.content}
                    className="bg-card border border-border"
                  />
                  {msg.role === "assistant" && (
                    <button
                      onClick={() => handleSaveJournal(msg.content)}
                      className="w-5 h-5 rounded bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-primary transition-colors"
                      title="Save to Journal"
                    >
                      <BookOpen size={9} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}

          {!isLoading && messages.length > 0 && (
            <EndOfFeed messageCount={messages.length} />
          )}

          {isLoading && (
            <div className="flex justify-start">
              <div className={cn("w-6 h-6 rounded-full border flex items-center justify-center font-display text-xs font-bold shrink-0 mr-2 mt-0.5 border-current", roleColor)}>
                {persona.name[0].toUpperCase()}
              </div>
              <div className="hud-border rounded-lg rounded-tl-none px-3 py-2">
                <span className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "300ms" }} />
                </span>
              </div>
            </div>
          )}
        </div>
        <ScrollToBottomButton visible={showBackToBottom} onClick={scrollToBottom} />
      </div>

      {/* Input */}
      <div className="pt-4 mt-4 border-t border-border space-y-2">
        {mavisCtxOpen && (
          <div className="flex gap-2 items-center bg-cyan-950/20 border border-cyan-500/20 rounded-lg px-2 py-1.5">
            <Brain size={12} className="text-cyan-400 shrink-0" />
            <input
              autoFocus
              value={mavisCtxQuery}
              onChange={(e) => setMavisCtxQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAskMavis(); if (e.key === "Escape") setMavisCtxOpen(false); }}
              placeholder="What should MAVIS look up for context? (Enter to send)"
              className="flex-1 bg-transparent text-xs font-mono text-cyan-200 placeholder:text-cyan-700 focus:outline-none"
            />
            <button onClick={() => setMavisCtxOpen(false)} className="text-muted-foreground hover:text-foreground"><X size={10} /></button>
          </div>
        )}
        {(attachments.length > 0 || isUploading) && (
          <AttachmentTray
            attachments={attachments}
            isUploading={isUploading}
            onUpload={upload}
            onRemove={remove}
            compact
          />
        )}
        <div className="flex items-end gap-2">
          <div className="flex flex-col items-center gap-1">
            <button
              onClick={() => setMavisCtxOpen(v => !v)}
              disabled={mavisCtxLoading}
              className="flex items-center justify-center w-7 h-7 rounded border border-cyan-900/40 hover:border-cyan-400/40 text-cyan-400 hover:text-cyan-300 transition-all disabled:opacity-40"
              title="Ask MAVIS for context"
            >
              {mavisCtxLoading ? <Loader2 size={12} className="animate-spin" /> : <Brain size={12} />}
            </button>
            <VoiceMemo inline />
            <AttachButton isUploading={isUploading} onUpload={upload} />
          </div>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${persona.name}...`}
            rows={1}
            className={cn(
              "flex-1 resize-none bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm font-body text-foreground",
              "placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors",
              "max-h-32 scrollbar-thin"
            )}
            style={{ minHeight: "40px" }}
            onInput={(e) => {
              const t = e.currentTarget;
              t.style.height = "auto";
              t.style.height = Math.min(t.scrollHeight, 128) + "px";
            }}
          />
          {isLoading ? (
            <button
              onClick={handleStop}
              className="p-2.5 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors shrink-0"
              title="Stop"
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="p-2.5 rounded-lg border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              <Send size={14} />
            </button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {voiceOpen && (
          <VoiceChatOverlay
            persona={{
              name: persona.name,
              role: persona.role,
              systemPrompt: buildPersonaVoiceSystemPrompt({
                name: persona.name,
                role: persona.role,
                archetype: persona.archetype,
                personality: persona.personality as Record<string, unknown> | string | null | undefined,
                system_prompt: persona.system_prompt,
                agent_folders: (persona as any).agent_folders as Record<string, string> | null,
              }),
              voiceId: voiceId,
              entityId: persona.id,
              entityType: "persona",
              userId,
            }}
            
            onClose={() => setVoiceOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
