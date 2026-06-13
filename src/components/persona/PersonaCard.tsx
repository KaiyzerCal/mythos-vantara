import { useState, useEffect } from "react";
import { MessageCircle, Trash2, Clock, Bell, ChevronDown, ChevronUp, Cpu } from "lucide-react";
import { HudCard, ProgressBar } from "@/components/SharedUI";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { AvatarUploader } from "@/components/AvatarUploader";
import { cn } from "@/lib/utils";
import { usePersona } from "@/hooks/usePersona";
import { supabase } from "@/integrations/supabase/client";
import type { ForgedPersona } from "@/hooks/usePersonaForge";
import type { RelationshipState } from "@/hooks/usePersona";

export interface NaviNotification {
  id: string;
  message: string;
  created_at: string;
  is_read: boolean;
}

const MOOD_EMOJI: Record<string, string> = {
  happy: "😊", sad: "😔", excited: "⚡", frustrated: "😤",
  loving: "💜", distant: "🌫️", playful: "😏", neutral: "😐",
};

const ROLE_COLOR: Record<string, string> = {
  girlfriend: "text-neon-purple border-neon-purple/30 bg-neon-purple/10",
  friend: "text-neon-cyan border-neon-cyan/30 bg-neon-cyan/10",
  mentor: "text-primary border-primary/30 bg-primary/10",
  rival: "text-neon-red border-neon-red/30 bg-neon-red/10",
  companion: "text-neon-green border-neon-green/30 bg-neon-green/10",
  custom: "text-muted-foreground border-border bg-muted/20",
};

interface PersonaCardProps {
  persona: ForgedPersona;
  userId: string;
  onChat: (persona: ForgedPersona) => void;
  onDelete?: (personaId: string) => void;
  notification?: NaviNotification | null;
  onNotificationRead?: (notifId: string) => void;
}

export function PersonaCard({ persona, userId, onChat, onDelete, notification, onNotificationRead }: PersonaCardProps) {
  const [relState, setRelState] = useState<RelationshipState | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(persona.avatar_key ?? null);
  const [reasonExpanded, setReasonExpanded] = useState(false);
  const [cardExpanded, setCardExpanded] = useState(false);
  const [msgCount, setMsgCount] = useState<number>(0);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const { loadRelationshipState, loadConversationCount } = usePersona(persona.id, userId);

  // Initial fetch
  useEffect(() => {
    loadRelationshipState().then(setRelState);
    loadConversationCount().then(setMsgCount);
  }, [loadRelationshipState, loadConversationCount]);

  // Live updates — bond/trust/mood reflect the current state of the
  // relationship as the user chats with this persona anywhere in the app.
  useEffect(() => {
    const channel = supabase
      .channel(`relstate-${persona.id}-${userId}`)
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

  const handleAvatarChange = async (url: string | null) => {
    setAvatarUrl(url);
    await supabase.from("personas").update({ avatar_key: url }).eq("id", persona.id);
  };

  const mood = relState?.current_mood ?? "neutral";
  const bond = relState?.bond_level ?? 0;
  const trust = relState?.trust_level ?? 50;
  const roleStyle = ROLE_COLOR[persona.role] ?? ROLE_COLOR.custom;

  const lastSeen = relState?.last_interaction_at
    ? new Date(relState.last_interaction_at).toLocaleDateString()
    : "Never";

  return (
    <HudCard glowColor={persona.role === "girlfriend" || persona.role === "companion" ? "purple" : "none"}>
      <div
        className="cursor-pointer"
        onClick={() => setCardExpanded((v) => !v)}
        title={cardExpanded ? "Click to collapse" : "Click to see full details"}
      >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div onClick={(e) => e.stopPropagation()}>
            <AvatarUploader
              value={avatarUrl}
              onChange={handleAvatarChange}
              scope={`persona/${persona.id}`}
              fallback={persona.name}
              sizeClass="w-10 h-10"
              ringClass={cn("border-2", roleStyle.split(" ").find((c) => c.startsWith("border-")) ?? "border-border")}
            />
          </div>
          <div>
            <p className="font-display font-bold text-sm text-foreground">{persona.name}</p>
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">{persona.archetype}</p>
          </div>
        </div>

        {/* Mood indicator */}
        <div className="flex flex-col items-end gap-1">
          <span className="text-lg leading-none" title={mood}>{MOOD_EMOJI[mood] ?? "😐"}</span>
          <span className={cn(
            "text-[9px] font-mono px-1.5 py-0.5 rounded border",
            roleStyle
          )}>
            {persona.role}
          </span>
          {cardExpanded ? <ChevronUp size={10} className="text-muted-foreground mt-0.5" /> : <ChevronDown size={10} className="text-muted-foreground mt-0.5" />}
        </div>
      </div>

      {/* Bond + Trust bars */}
      <div className="space-y-2 mb-3">
        <ProgressBar
          value={bond}
          max={100}
          label="BOND"
          colorClass="bg-neon-purple"
          showPercent
          height="xs"
        />
        <ProgressBar
          value={trust}
          max={100}
          label="TRUST"
          colorClass="bg-primary"
          showPercent
          height="xs"
        />
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-3 mb-3 text-[10px] font-mono text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1">
          <MessageCircle size={10} />
          {msgCount} msgs
        </span>
        <span className="flex items-center gap-1">
          <Clock size={10} />
          {lastSeen}
        </span>
        <span className="flex items-center gap-1">
          <Cpu size={10} />
          {persona.model}
        </span>
      </div>
      </div>

      {/* Expanded details */}
      {cardExpanded && (
        <div className="mb-3 pt-2 border-t border-border/40 space-y-2">
          <div>
            <p className="text-[9px] font-mono text-muted-foreground uppercase mb-0.5">Archetype</p>
            <p className="text-[11px] font-body text-foreground">{persona.archetype}</p>
          </div>
          <div>
            <p className="text-[9px] font-mono text-muted-foreground uppercase mb-0.5">Role · Model</p>
            <p className="text-[11px] font-mono text-foreground">{persona.role} · {persona.model}</p>
          </div>
          <div>
            <p className="text-[9px] font-mono text-muted-foreground uppercase mb-0.5">Total Interactions</p>
            <p className="text-[11px] font-mono text-foreground">{relState?.total_interactions ?? 0} (rel) · {msgCount} (logged)</p>
          </div>
          {persona.personality && Object.keys(persona.personality).length > 0 && (
            <div>
              <p className="text-[9px] font-mono text-muted-foreground uppercase mb-0.5">Personality</p>
              <pre className="text-[10px] font-mono text-foreground/80 whitespace-pre-wrap break-words bg-muted/30 rounded p-1.5">{JSON.stringify(persona.personality, null, 2)}</pre>
            </div>
          )}
          {persona.system_prompt && (
            <div>
              <p className="text-[9px] font-mono text-muted-foreground uppercase mb-0.5">System Prompt</p>
              <p className="text-[10px] font-body text-foreground/80 whitespace-pre-wrap">{persona.system_prompt}</p>
            </div>
          )}
          <div>
            <p className="text-[9px] font-mono text-muted-foreground uppercase mb-0.5">Forged</p>
            <p className="text-[10px] font-mono text-foreground">{new Date(persona.created_at).toLocaleString()}</p>
          </div>
        </div>
      )}

      {/* Mood reason if present — click to expand/collapse full summary */}
      {relState?.mood_reason && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setReasonExpanded((v) => !v);
          }}
          className={cn(
            "w-full text-left text-[10px] font-mono text-muted-foreground italic mb-3 cursor-pointer hover:text-foreground transition-colors",
            !reasonExpanded && "line-clamp-2"
          )}
          title={reasonExpanded ? "Click to collapse" : "Click to read full summary"}
        >
          "{relState.mood_reason}"
        </button>
      )}

      {/* Heartbeat notification preview */}
      {notification && !notification.is_read && (
        <div className="flex items-start gap-1.5 mb-3 px-2 py-1.5 rounded bg-neon-purple/10 border border-neon-purple/20">
          <Bell size={10} className="text-neon-purple mt-0.5 shrink-0 animate-pulse" />
          <p className="text-[10px] font-mono text-neon-purple/90 line-clamp-2 flex-1">
            {notification.message}
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 mt-auto">
        <button
          onClick={() => {
            if (notification && !notification.is_read && onNotificationRead) {
              onNotificationRead(notification.id);
            }
            onChat(persona);
          }}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded border border-primary/30 bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
        >
          <MessageCircle size={12} />
          Chat
          {notification && !notification.is_read && (
            <span className="w-1.5 h-1.5 rounded-full bg-neon-purple animate-pulse" />
          )}
        </button>
        {onDelete && (
          <>
            <button
              onClick={() => setConfirmDeleteOpen(true)}
              className="p-1.5 rounded border border-border text-muted-foreground hover:text-neon-red hover:border-neon-red/30 transition-colors"
              title="Deactivate persona"
            >
              <Trash2 size={12} />
            </button>
            <ConfirmDialog
              open={confirmDeleteOpen}
              title={`Deactivate "${persona.name}"?`}
              description="This will permanently remove the persona and all associated memories."
              onConfirm={() => { setConfirmDeleteOpen(false); onDelete(persona.id); }}
              onCancel={() => setConfirmDeleteOpen(false)}
            />
          </>
        )}
      </div>
    </HudCard>
  );
}
