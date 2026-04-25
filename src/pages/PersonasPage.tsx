import { useState, useEffect, useCallback } from "react";
import { Plus, Users, Loader2, AlertCircle, Wand2 } from "lucide-react";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { PersonaCard } from "@/components/persona/PersonaCard";
import { PersonaChat } from "@/components/persona/PersonaChat";
import { usePersonaForge } from "@/hooks/usePersonaForge";
import { useAuth } from "@/contexts/AuthContext";
import type { ForgedPersona } from "@/hooks/usePersonaForge";

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

  const loadPersonas = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    const list = await listPersonas(user.id);
    setPersonas(list);
    setIsLoading(false);
  }, [user, listPersonas]);

  useEffect(() => { loadPersonas(); }, [loadPersonas]);

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
            <PersonaCard
              key={persona.id}
              persona={persona}
              userId={user.id}
              onChat={setActiveChat}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
