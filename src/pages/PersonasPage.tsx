import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, Users, Loader2, AlertCircle, Wand2, PhoneCall, Edit2, X, Save, Download, Upload, ChevronDown, ChevronUp, Send } from "lucide-react";
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
  // ElizaOS character.json fields
  const [bio, setBio] = useState((persona as any).bio ?? "");
  const [loreText, setLoreText] = useState(((persona as any).lore ?? []).join("\n"));
  const [domains, setDomains] = useState(((persona as any).knowledge_domains ?? []).join(", "));
  const [adjectives, setAdjectives] = useState(((persona as any).adjectives ?? []).join(", "));
  const [topics, setTopics] = useState(((persona as any).topics ?? []).join(", "));
  const [msgExamplesText, setMsgExamplesText] = useState(
    JSON.stringify((persona as any).message_examples ?? [], null, 2)
  );
  const [showCharacter, setShowCharacter] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const handleSave = async () => {
    let parsedPersonality: Record<string, any> = {};
    try {
      parsedPersonality = JSON.parse(personalityText);
    } catch {
      setPersonalityError("Invalid JSON — please fix the personality field.");
      return;
    }
    let parsedMsgExamples: any[] = [];
    try {
      parsedMsgExamples = JSON.parse(msgExamplesText);
    } catch { /* ignore */ }
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
          bio: bio.trim(),
          lore: loreText.split("\n").map(s => s.trim()).filter(Boolean),
          knowledge_domains: domains.split(",").map(s => s.trim()).filter(Boolean),
          adjectives: adjectives.split(",").map(s => s.trim()).filter(Boolean),
          topics: topics.split(",").map(s => s.trim()).filter(Boolean),
          message_examples: parsedMsgExamples,
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

  const exportCharacterJson = () => {
    let parsedPersonality: Record<string, any> = {};
    try { parsedPersonality = JSON.parse(personalityText); } catch { /* skip */ }
    let parsedMsgExamples: any[] = [];
    try { parsedMsgExamples = JSON.parse(msgExamplesText); } catch { /* skip */ }

    const character = {
      name:             name.trim(),
      role:             role.trim(),
      archetype:        archetype.trim(),
      bio:              bio.trim(),
      lore:             loreText.split("\n").map(s => s.trim()).filter(Boolean),
      knowledge_domains: domains.split(",").map(s => s.trim()).filter(Boolean),
      adjectives:       adjectives.split(",").map(s => s.trim()).filter(Boolean),
      topics:           topics.split(",").map(s => s.trim()).filter(Boolean),
      message_examples: parsedMsgExamples,
      personality:      parsedPersonality,
      system_prompt:    systemPrompt,
      model:            model.trim(),
    };
    const blob = new Blob([JSON.stringify(character, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${name.trim().replace(/\s+/g, "_")}_character.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const importCharacterJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const c = JSON.parse(ev.target?.result as string);
        if (c.name)             setName(c.name);
        if (c.role)             setRole(c.role);
        if (c.archetype)        setArchetype(c.archetype);
        if (c.bio)              setBio(c.bio);
        if (Array.isArray(c.lore))              setLoreText(c.lore.join("\n"));
        if (Array.isArray(c.knowledge_domains)) setDomains(c.knowledge_domains.join(", "));
        if (Array.isArray(c.adjectives))        setAdjectives(c.adjectives.join(", "));
        if (Array.isArray(c.topics))            setTopics(c.topics.join(", "));
        if (Array.isArray(c.message_examples))  setMsgExamplesText(JSON.stringify(c.message_examples, null, 2));
        if (c.personality)    setPersonalityText(JSON.stringify(c.personality, null, 2));
        if (c.system_prompt)  setSystemPrompt(c.system_prompt);
        if (c.model)          setModel(c.model);
        toast.success("Character imported — review and save.");
      } catch {
        toast.error("Invalid character.json file.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
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

        {/* Character.json (ElizaOS-style) — collapsible section */}
        <div className="border border-border/50 rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setShowCharacter(v => !v)}
            className="w-full flex items-center justify-between px-3 py-2 text-xs font-mono text-muted-foreground hover:text-foreground bg-muted/10 hover:bg-muted/20 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <span className="text-primary">{ }</span>
              Character Config (ElizaOS-style)
            </span>
            {showCharacter ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>

          {showCharacter && (
            <div className="p-3 space-y-3 bg-muted/5">
              {/* Bio */}
              <div>
                <label className="block text-xs font-mono text-muted-foreground uppercase mb-1">Bio (1–3 sentences)</label>
                <textarea
                  value={bio}
                  onChange={e => setBio(e.target.value)}
                  rows={2}
                  placeholder="A brief overview of who this persona is, their background and energy."
                  className="w-full resize-none bg-muted/30 border border-border rounded px-3 py-2 text-xs font-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>

              {/* Lore */}
              <div>
                <label className="block text-xs font-mono text-muted-foreground uppercase mb-1">Lore (one fact per line)</label>
                <textarea
                  value={loreText}
                  onChange={e => setLoreText(e.target.value)}
                  rows={3}
                  placeholder="Grew up in Tokyo&#10;Survived a betrayal at 23&#10;Has a photographic memory for patterns"
                  className="w-full resize-none bg-muted/30 border border-border rounded px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>

              {/* Knowledge domains */}
              <div>
                <label className="block text-xs font-mono text-muted-foreground uppercase mb-1">Knowledge Domains (comma-separated)</label>
                <input
                  value={domains}
                  onChange={e => setDomains(e.target.value)}
                  placeholder="psychology, systems thinking, startup strategy"
                  className="w-full bg-muted/30 border border-border rounded px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>

              {/* Adjectives */}
              <div>
                <label className="block text-xs font-mono text-muted-foreground uppercase mb-1">Adjectives (comma-separated)</label>
                <input
                  value={adjectives}
                  onChange={e => setAdjectives(e.target.value)}
                  placeholder="warm, sharp, slightly mysterious, direct"
                  className="w-full bg-muted/30 border border-border rounded px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>

              {/* Topics */}
              <div>
                <label className="block text-xs font-mono text-muted-foreground uppercase mb-1">Topics (comma-separated)</label>
                <input
                  value={topics}
                  onChange={e => setTopics(e.target.value)}
                  placeholder="consciousness, pattern recognition, dark humor, human connection"
                  className="w-full bg-muted/30 border border-border rounded px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>

              {/* Message examples */}
              <div>
                <label className="block text-xs font-mono text-muted-foreground uppercase mb-1">Message Examples (JSON array)</label>
                <textarea
                  value={msgExamplesText}
                  onChange={e => setMsgExamplesText(e.target.value)}
                  rows={4}
                  placeholder='[{"user": "How are you?", "persona": "Sharper than yesterday, which is all I ask."}]'
                  className="w-full resize-none bg-muted/30 border border-border rounded px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 mt-4 flex-wrap">
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
        <div className="ml-auto flex items-center gap-1.5">
          <input ref={importRef} type="file" accept=".json" className="hidden" onChange={importCharacterJson} />
          <button
            type="button"
            onClick={() => importRef.current?.click()}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded border border-border text-muted-foreground text-xs hover:text-foreground hover:border-border/80 transition-colors"
            title="Import character.json"
          >
            <Upload size={10} /> Import
          </button>
          <button
            type="button"
            onClick={exportCharacterJson}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded border border-border text-muted-foreground text-xs hover:text-foreground hover:border-border/80 transition-colors"
            title="Export character.json"
          >
            <Download size={10} /> Export
          </button>
        </div>
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
  const [postingPersona, setPostingPersona] = useState<ForgedPersona | null>(null);
  const [postContent, setPostContent] = useState("");
  const [postPlatform, setPostPlatform] = useState<"twitter" | "linkedin" | "instagram" | "discord">("twitter");
  const [postSending, setPostSending] = useState(false);
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

  const handlePersonaPost = async () => {
    if (!user || !postingPersona || !postContent.trim()) return;
    setPostSending(true);
    try {
      const fnMap: Record<string, string> = {
        twitter:   "mavis-nora-post",
        linkedin:  "mavis-nora-linkedin",
        instagram: "mavis-nora-instagram",
        discord:   "mavis-nora-discord",
      };
      const { error } = await (supabase as any).functions.invoke(fnMap[postPlatform], {
        body: {
          user_id:  user.id,
          content:  postContent.trim(),
          persona:  { name: postingPersona.name, role: postingPersona.role, bio: (postingPersona as any).bio ?? "" },
        },
      });
      if (error) throw error;
      toast.success(`Posted as ${postingPersona.name} on ${postPlatform}`);
      setPostContent("");
      setPostingPersona(null);
    } catch (e: any) {
      toast.error(`Post failed: ${e?.message ?? "Unknown error"}`);
    } finally {
      setPostSending(false);
    }
  };

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
              <button
                onClick={() => { setPostingPersona(persona); setPostContent(""); }}
                className="absolute top-18 right-2 flex items-center gap-1 px-2 py-1 rounded border border-violet-500/30 bg-violet-500/10 text-violet-400/70 hover:text-violet-300 hover:bg-violet-500/20 text-xs font-mono transition-all opacity-0 group-hover:opacity-100"
                title={`Post as ${persona.name}`}
              >
                <Send size={9} /> POST
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

      {/* ── Post as Persona panel ──────────────────────────────── */}
      <AnimatePresence>
        {postingPersona && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-md bg-card border border-border rounded-xl p-5 space-y-3 shadow-xl mx-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-display font-bold text-primary">Post as {postingPersona.name}</p>
                <button onClick={() => setPostingPersona(null)} className="text-muted-foreground hover:text-foreground">
                  <X size={14} />
                </button>
              </div>
              <div className="flex gap-1.5">
                {(["twitter", "linkedin", "instagram", "discord"] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPostPlatform(p)}
                    className={`px-2.5 py-1 rounded text-xs font-mono border transition-colors capitalize ${postPlatform === p ? "bg-violet-500/20 border-violet-500/40 text-violet-300" : "border-border/40 text-muted-foreground hover:text-foreground"}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <textarea
                value={postContent}
                onChange={(e) => setPostContent(e.target.value)}
                rows={4}
                placeholder={`Write as ${postingPersona.name}…`}
                className="w-full resize-none bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm font-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-violet-500/50 transition-colors"
              />
              <p className="text-xs font-mono text-muted-foreground">
                {postingPersona.name} · {postingPersona.role} · posting on {postPlatform}
              </p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setPostingPersona(null)} className="px-3 py-1.5 text-xs font-mono border border-border rounded text-muted-foreground hover:text-foreground transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handlePersonaPost}
                  disabled={postSending || !postContent.trim()}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-mono bg-violet-500/10 border border-violet-500/30 text-violet-300 rounded hover:bg-violet-500/20 disabled:opacity-50 transition-colors"
                >
                  {postSending ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                  Post
                </button>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
