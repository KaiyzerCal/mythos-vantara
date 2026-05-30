import { useState, useEffect, useRef, useCallback } from "react";
import { Send, ArrowLeft, Zap, RefreshCw, Brain, Loader2, Database, Square, PhoneCall } from "lucide-react";
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
    const response = await sendMessage(trimmed, attachmentIds);
    if (cancelledRef.current) return;
    if (response) {
      // Strip proposal blocks before display, queue them in approvals.
      const { cleanText, proposals } = parseProposedActions(response);
      if (proposals.length > 0) {
        const queued = await submitProposalsForApproval(userId, persona.name, proposals);
        if (queued > 0) toast.success(`${persona.name} proposed ${queued} action${queued > 1 ? "s" : ""} — awaiting approval in Inbox`);
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
          <p className="text-[9px] font-mono text-muted-foreground truncate">{persona.archetype} · {persona.role}</p>
        </div>

        {/* Bond / Trust mini bars */}
        <div className="hidden sm:flex flex-col gap-1 items-end w-28 shrink-0">
          <div className="flex items-center gap-1.5 w-full">
            <span className="text-[8px] font-mono text-muted-foreground w-8 shrink-0">BOND</span>
            <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-neon-purple rounded-full transition-all duration-500" style={{ width: `${bond}%` }} />
            </div>
            <span className="text-[8px] font-mono text-muted-foreground w-6 text-right">{bond}</span>
          </div>
          <div className="flex items-center gap-1.5 w-full">
            <span className="text-[8px] font-mono text-muted-foreground w-8 shrink-0">TRUST</span>
            <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${trust}%` }} />
            </div>
            <span className="text-[8px] font-mono text-muted-foreground w-6 text-right">{trust}</span>
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
          className="flex items-center gap-1 px-2 py-1 rounded border border-cyan-900/40 text-cyan-400 text-[9px] font-mono hover:border-cyan-400/50 transition-colors disabled:opacity-40"
          title="OmniSync — snapshot this thread to memory"
        >
          {isSyncing ? <Loader2 size={9} className="animate-spin" /> : <Database size={9} />}
          SYNC
        </button>

        <button
          onClick={handleClear}
          className="px-2 py-1 rounded border border-border text-[9px] font-mono text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors"
          title="Archive thread to memory and clear"
        >
          CLEAR
        </button>

        <button
          onClick={() => setVoiceOpen(true)}
          className="flex items-center gap-1 px-2 py-1 rounded border border-primary/30 bg-primary/5 text-primary/70 hover:text-primary hover:bg-primary/15 text-[9px] font-mono transition-all"
          title={`Voice call ${persona.name}`}
        >
          <PhoneCall size={9} /> CALL
        </button>

        {/* Fine-tune controls */}
        {finetuneStatus === "training" ? (
          <button
            onClick={handleCheckTraining}
            className="flex items-center gap-1 px-2 py-1 rounded border border-amber-500/30 text-amber-400 text-[9px] font-mono hover:border-amber-400/50 transition-colors"
            title="Check training status"
          >
            <Loader2 size={9} className="animate-spin" />
            TRAINING
          </button>
        ) : finetuneStatus === "deployed" ? (
          <span
            className="flex items-center gap-1 px-2 py-1 rounded border border-neon-green/30 text-neon-green text-[9px] font-mono"
            title={`Running on fine-tuned model (${persona.finetune_examples ?? "?"} examples)`}
          >
            <Brain size={9} />
            TRAINED
          </span>
        ) : convCount >= 50 ? (
          <button
            onClick={handleTrain}
            disabled={isFinetuning}
            className="flex items-center gap-1 px-2 py-1 rounded border border-primary/30 text-primary text-[9px] font-mono hover:border-primary/50 hover:bg-primary/5 transition-colors disabled:opacity-40"
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
                  "w-6 h-6 rounded-full border flex items-center justify-center font-display text-[10px] font-bold shrink-0 mr-2 mt-0.5",
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
                <CopyButton
                  content={msg.content}
                  className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 focus:opacity-100 bg-card border border-border"
                />
              </div>
            </div>
          ))}

          {!isLoading && messages.length > 0 && (
            <EndOfFeed messageCount={messages.length} />
          )}

          {isLoading && (
            <div className="flex justify-start">
              <div className={cn("w-6 h-6 rounded-full border flex items-center justify-center font-display text-[10px] font-bold shrink-0 mr-2 mt-0.5 border-current", roleColor)}>
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
          <AttachButton isUploading={isUploading} onUpload={upload} />
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
              }),
              voiceId: (persona as unknown as Record<string, unknown>).voice_id as string | undefined,
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
