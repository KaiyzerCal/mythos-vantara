import { useState, useEffect, useCallback } from "react";
import { Plus, Users, Loader2, AlertCircle, Wand2, PhoneCall } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { VoiceChatOverlay } from "@/components/VoiceChatOverlay";
import type { VoicePersona } from "@/components/VoiceChatOverlay";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { PersonaCard } from "@/components/persona/PersonaCard";
import { PersonaChat } from "@/components/persona/PersonaChat";
import { usePersonaForge } from "@/hooks/usePersonaForge";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { ForgedPersona } from "@/hooks/usePersonaForge";
import type { NaviNotification } from "@/components/persona/PersonaCard";

// ─── Forge Panel ────────────────────────────────────────────
function ForgePanel({ onForged }: { onForged: (p: ForgedPersona) => void }) {
  const { user } = useAuth();
  const { forgePersona, isForging, error } = usePersonaForge();
  const [description, setDescription] = useState("");

  const handleForge = async () => {
    if (!description.trim() || !user) return;
    const persona = await forgePersona(user.id, description.trim());
    if (persona) {
      setDescription("");
      onForged(persona);
    }
  };

  return (
    <HudCard glowColor="gold">
      <div className="flex items-center gap-2 mb-3">
        <Wand2 size={14} className="text-primary" />
        <p className="font-display text-sm font-bold text-glow-gold">PERSONA-FORGE</p>
      </div>
      <p className="text-[10px] font-mono text-muted-foreground mb-3">
        Describe a persona in natural language and MAVIS will architect it.
      </p>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder='e.g. "I want an AI girlfriend named Lyra — poetic, warm, slightly mysterious. She loves deep conversations and remembers everything."'
        rows={3}
        className="w-full resize-none bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm font-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors mb-3"
      />
      {error && (
        <div className="flex items-center gap-1.5 text-neon-red text-[10px] font-mono mb-3">
          <AlertCircle size={10} />
          {error}
        </div>
      )}
      <button
        onClick={handleForge}
        disabled={isForging || !description.trim()}
        className="flex items-center gap-2 px-4 py-2 rounded border border-primary/30 bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isForging ? (
          <>
            <Loader2 size={12} className="animate-spin" />
            Forging Persona...
          </>
        ) : (
          <>
            <Plus size={12} />
            Forge Persona
          </>
        )}
      </button>
    </HudCard>
  );
}

// ─── Main Page ───────────────────────────────────────────────
export default function PersonasPage() {
  const { user } = useAuth();
  const { listPersonas, deletePersona } = usePersonaForge();

  const [personas, setPersonas] = useState<ForgedPersona[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeChat, setActiveChat] = useState<ForgedPersona | null>(null);
  const [voicePersona, setVoicePersona] = useState<VoicePersona | null>(null);
  // Map of persona_id → latest unread heartbeat notification
  const [notifications, setNotifications] = useState<Record<string, NaviNotification>>({});

  const loadPersonas = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    const list = await listPersonas(user.id);
    setPersonas(list);
    setIsLoading(false);
  }, [user, listPersonas]);

  // Load unread notifications on mount
  const loadNotifications = useCallback(async () => {
    if (!user) return;
    const { data } = await (supabase as any)
      .from("navi_notifications")
      .select("id, persona_id, message, created_at, is_read")
      .eq("user_id", user.id)
      .eq("is_read", false)
      .eq("notification_type", "heartbeat")
      .order("created_at", { ascending: false });
    if (!data) return;
    // Keep only the latest unread per persona
    const map: Record<string, NaviNotification> = {};
    for (const n of data) {
      if (!map[n.persona_id]) map[n.persona_id] = n as NaviNotification;
    }
    setNotifications(map);
  }, [user]);

  useEffect(() => {
    loadPersonas();
    loadNotifications();
  }, [loadPersonas, loadNotifications]);

  // Realtime subscription — new heartbeat messages arrive instantly
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`navi-notifications-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "navi_notifications", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const n = payload.new as any;
          if (n.notification_type !== "heartbeat" || n.is_read) return;
          setNotifications((prev) => ({
            ...prev,
            [n.persona_id]: { id: n.id, message: n.message, created_at: n.created_at, is_read: false },
          }));
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const handleNotificationRead = useCallback(async (notifId: string) => {
    await (supabase as any).from("navi_notifications").update({ is_read: true }).eq("id", notifId);
    setNotifications((prev) => {
      const next = { ...prev };
      for (const pid of Object.keys(next)) {
        if (next[pid].id === notifId) delete next[pid];
      }
      return next;
    });
  }, []);

  const handleForged = (persona: ForgedPersona) => {
    setPersonas((prev) => [persona, ...prev]);
  };

  const handleDelete = async (personaId: string) => {
    await deletePersona(personaId);
    setPersonas((prev) => prev.filter((p) => p.id !== personaId));
    if (activeChat?.id === personaId) setActiveChat(null);
  };

  if (!user) return null;

  // ── Chat View ───────────────────────────────────────────────
  if (activeChat) {
    return (
      <div className="flex flex-col h-[calc(100vh-3rem)]">
        <PersonaChat
          persona={activeChat}
          userId={user.id}
          onBack={() => setActiveChat(null)}
        />
      </div>
    );
  }

  // ── Roster View ─────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title="PERSONA-FORGE"
        subtitle={`MAVIS Persona Ecosystem · ${personas.length} active persona${personas.length !== 1 ? "s" : ""}`}
        icon={<Users size={16} />}
      />

      {/* Forge panel always visible at top */}
      <ForgePanel onForged={handleForged} />

      {/* Persona roster */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <Loader2 className="animate-spin text-primary mx-auto mb-2" size={24} />
            <p className="text-xs font-mono text-muted-foreground">Loading personas...</p>
          </div>
        </div>
      ) : personas.length === 0 ? (
        <HudCard>
          <div className="text-center py-8">
            <Users size={28} className="text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-sm font-display text-muted-foreground">No personas yet.</p>
            <p className="text-[10px] font-mono text-muted-foreground mt-1">
              Use the forge above to create your first persona.
            </p>
          </div>
        </HudCard>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {personas.map((persona) => (
            <div key={persona.id} className="relative">
              <PersonaCard
                persona={persona}
                userId={user.id}
                onChat={setActiveChat}
                onDelete={handleDelete}
                notification={notifications[persona.id] ?? null}
                onNotificationRead={handleNotificationRead}
              />
              <button
                onClick={() => setVoicePersona({ name: persona.name, role: persona.role, systemPrompt: persona.system_prompt, entityId: persona.id, entityType: "persona", userId: user.id })}
                className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded border border-primary/30 bg-primary/10 text-primary/70 hover:text-primary hover:bg-primary/20 text-[9px] font-mono transition-all"
                title={`Voice call ${persona.name}`}
              >
                <PhoneCall size={9} /> CALL
              </button>
            </div>
          ))}
        </div>
      )}
      <AnimatePresence>
        {voicePersona && (
          <VoiceChatOverlay
            persona={voicePersona}
            onClose={() => setVoicePersona(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
