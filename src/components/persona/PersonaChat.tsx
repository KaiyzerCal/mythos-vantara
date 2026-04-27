import { useState, useEffect, useRef, useCallback } from "react";
import { Send, ArrowLeft, Zap, RefreshCw, Brain, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { HudCard } from "@/components/SharedUI";
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

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);

    const attachmentIds = attachments.map((a) => a.id);
    const response = await sendMessage(trimmed, attachmentIds);
    if (response) {
      setMessages((prev) => [...prev, { role: "assistant", content: response }]);
      if (ttsEnabled) {
        const gender = findVoice(voiceId)?.gender ?? "female";
        // Pass the previous assistant turn so ElevenLabs stitches prosody —
        // the conversation flows like a continuous human exchange instead
        // of disjointed one-off reads.
        const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")?.content;
        speak(response, {
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
                  "max-w-[75%] rounded-lg px-3 py-2 text-sm font-body leading-relaxed",
                  msg.role === "user"
                    ? "bg-primary/15 border border-primary/25 text-foreground rounded-tr-none"
                    : "hud-border text-foreground rounded-tl-none"
                )}
              >
                {msg.content}
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
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="p-2.5 rounded-lg border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
