import { useState, useEffect } from "react";
import { Heart, Shield, MessageCircle, Trash2, Clock } from "lucide-react";
import { HudCard, ProgressBar } from "@/components/SharedUI";
import { AvatarUploader } from "@/components/AvatarUploader";
import { cn } from "@/lib/utils";
import { usePersona } from "@/hooks/usePersona";
import { supabase } from "@/integrations/supabase/client";
import type { ForgedPersona } from "@/hooks/usePersonaForge";
import type { RelationshipState } from "@/hooks/usePersona";

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
}

export function PersonaCard({ persona, userId, onChat, onDelete }: PersonaCardProps) {
  const [relState, setRelState] = useState<RelationshipState | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(persona.avatar_key ?? null);
  const { loadRelationshipState } = usePersona(persona.id, userId);

  // Initial fetch
  useEffect(() => {
    loadRelationshipState().then(setRelState);
  }, [loadRelationshipState]);

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
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <AvatarUploader
            value={avatarUrl}
            onChange={handleAvatarChange}
            scope={`persona/${persona.id}`}
            fallback={persona.name}
            sizeClass="w-10 h-10"
            ringClass={cn("border-2", roleStyle.split(" ").find((c) => c.startsWith("border-")) ?? "border-border")}
          />
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
      <div className="flex items-center gap-3 mb-3 text-[10px] font-mono text-muted-foreground">
        <span className="flex items-center gap-1">
          <MessageCircle size={10} />
          {relState?.total_interactions ?? 0} interactions
        </span>
        <span className="flex items-center gap-1">
          <Clock size={10} />
          {lastSeen}
        </span>
      </div>

      {/* Mood reason if present */}
      {relState?.mood_reason && (
        <p className="text-[10px] font-mono text-muted-foreground italic mb-3 line-clamp-2">
          "{relState.mood_reason}"
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 mt-auto">
        <button
          onClick={() => onChat(persona)}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded border border-primary/30 bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
        >
          <MessageCircle size={12} />
          Chat
        </button>
        {onDelete && (
          <button
            onClick={() => onDelete(persona.id)}
            className="p-1.5 rounded border border-border text-muted-foreground hover:text-neon-red hover:border-neon-red/30 transition-colors"
            title="Deactivate persona"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </HudCard>
  );
}
