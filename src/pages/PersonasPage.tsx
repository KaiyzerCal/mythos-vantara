import { useState, useEffect, useCallback } from "react";
import { Plus, Users, Loader2, AlertCircle, Wand2, PhoneCall, Edit2, X, Save } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
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
      <p className="text-xs font-mono text-muted-foreground mb-3">
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
        <div className="flex items-center gap-1.5 text-neon-red text-xs font-mono mb-3">
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

// ─── Edit Persona Panel ──────────────────────────────────────
interface EditPersonaPanelProps {
  persona: ForgedPersona;
  onSaved: (updated: ForgedPersona) => void;
  onCancel: () => void;
}

function EditPersonaPanel({ persona, onSaved, onCancel }: EditPersonaPanelProps) {
  const [name, setName] = useState(persona.name);
  const [role, setRole] = useState(persona.role);
  const [archetype, setArchetype] = useState(persona.archetype);
  const [systemPrompt, setSystemPrompt] = useState(persona.system_prompt);
  const [personalityText, setPersonalityText] = useState(
    JSON.stringify(persona.personality ?? {}, null, 2)
  );
  const [model, setModel] = useState(persona.model);
  const [personalityError, setPersonalityError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    // Validate personality JSON
    let parsedPersonality: Record<string, any> = {};
    try {
      parsedPersonality = JSON.parse(personalityText);
    } catch {
      setPersonalityError("Invalid JSON — please fix the personality field.");
      return;
    }
    setPersonalityError(null);

    if (!name.trim()) return;

    setIsSaving(true);
    try {
      const { data, error } = await supabase
        .from("personas")
        .update({
          name: name.trim(),
          role: role.trim(),
          archetype: archetype.trim(),
          system_prompt: systemPrompt,
          personality: parsedPersonality,
          model: model.trim(),
        })
        .eq("id", persona.id)
        .select()
        .single();

      if (error) throw new Error(error.message);

      toast.success(`"${name.trim()}" updated successfully.`);
      onSaved(data as unknown as ForgedPersona);
    } catch (e: any) {
      toast.error("Failed to save: " + (e.message ?? "Unknown error"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <HudCard glowColor="gold">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Edit2 size={14} className="text-primary" />
          <p className="font-display text-sm font-bold text-glow-gold">EDIT PERSONA</p>
        </div>
        <button
          onClick={onCancel}
          className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
          title="Cancel editing"
        >
          <X size={14} />
        </button>
      </div>

      <div className="space-y-3">
        {/* Name */}
        <div>
          <label className="block text-xs font-mono text-muted-foreground uppercase mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm font-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
          />
        </div>

        {/* Role */}
        <div>
          <label className="block text-xs font-mono text-muted-foreground uppercase mb-1">Role</label>
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="girlfriend, friend, mentor, rival, companion, custom"
            className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm font-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
          />
        </div>

        {/* Archetype */}
        <div>
          <label className="block text-xs font-mono text-muted-foreground uppercase mb-1">Archetype</label>
          <input
            value={archetype}
            onChange={(e) => setArchetype(e.target.value)}
            className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm font-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
          />
        </div>

        {/* Model */}
        <div>
          <label className="block text-xs font-mono text-muted-foreground uppercase mb-1">Model</label>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
          />
        </div>

        {/* Personality JSON */}
        <div>
          <label className="block text-xs font-mono text-muted-foreground uppercase mb-1">Personality (JSON)</label>
          <textarea
            value={personalityText}
            onChange={(e) => { setPersonalityText(e.target.value); setPersonalityError(null); }}
            rows={5}
            className="w-full resize-none bg-muted/30 border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
          />
          {personalityError && (
            <div className="flex items-center gap-1.5 text-neon-red text-xs font-mono mt-1">
              <AlertCircle size={10} />
              {personalityError}
            </div>
          )}
        </div>

        {/* System Prompt */}
        <div>
          <label className="block text-xs font-mono text-muted-foreground uppercase mb-1">System Prompt</label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={6}
            className="w-full resize-none bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm font-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 mt-4">
        <button
          onClick={handleSave}
          disabled={isSaving || !name.trim()}
          className="flex items-center gap-2 px-4 py-2 rounded border border-primary/30 bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isSaving ? (
            <>
              <Loader2 size={12} className="animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save size={12} />
              Save Changes
            </>
          )}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded border border-border text-muted-foreground text-xs font-medium hover:text-foreground hover:border-border/80 transition-colors"
        >
          Cancel
        </button>
      </div>
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
  const [editingPersona, setEditingPersona] = useState<ForgedPersona | null>(null);
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
    if (editingPersona?.id === personaId) setEditingPersona(null);
  };

  const handleEditSaved = (updated: ForgedPersona) => {
    setPersonas((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    setEditingPersona(null);
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

      {/* Forge panel always visible at top (hidden while editing) */}
      {editingPersona ? (
        <EditPersonaPanel
          persona={editingPersona}
          onSaved={handleEditSaved}
          onCancel={() => setEditingPersona(null)}
        />
      ) : (
        <ForgePanel onForged={handleForged} />
      )}

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
            <p className="text-xs font-mono text-muted-foreground mt-1">
              Use the forge above to create your first persona.
            </p>
          </div>
        </HudCard>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {personas.map((persona) => (
            <div key={persona.id} className="relative group">
              <PersonaCard
                persona={persona}
                userId={user.id}
                onChat={setActiveChat}
                onDelete={handleDelete}
                notification={notifications[persona.id] ?? null}
                onNotificationRead={handleNotificationRead}
              />
              {/* Edit button — visible on hover */}
              <button
                onClick={() => setEditingPersona(persona)}
                className="absolute top-10 right-2 flex items-center gap-1 px-2 py-1 rounded border border-primary/30 bg-primary/10 text-primary/70 hover:text-primary hover:bg-primary/20 text-xs font-mono transition-all opacity-0 group-hover:opacity-100"
                title={`Edit ${persona.name}`}
              >
                <Edit2 size={9} />
              </button>
              <button
                onClick={() => setVoicePersona({ name: persona.name, role: persona.role, systemPrompt: persona.system_prompt, entityId: persona.id, entityType: "persona", userId: user.id, avatarUrl: persona.avatar_key ?? undefined })}
                className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded border border-primary/30 bg-primary/10 text-primary/70 hover:text-primary hover:bg-primary/20 text-xs font-mono transition-all"
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
