import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Search, Zap, Star, Clock, Pin, AlertCircle, Wrench } from "lucide-react";
import { getAllSkills } from "@/mavis/skills/_registry";
import type { SkillDefinition } from "@/mavis/skills/_registry";
import { EmptyState } from "@/components/EmptyState";

// Skill category tags for grouping
const SKILL_CATEGORIES: Record<string, { label: string; keywords: string[]; color: string }> = {
  creative: {
    label: "Creative",
    keywords: ["image", "logo", "music", "poster", "video", "avatar", "design", "comic", "meme", "thumbnail", "ad"],
    color: "text-pink-400",
  },
  intelligence: {
    label: "Intelligence",
    keywords: ["research", "intel", "news", "crypto", "market", "stock", "competitor", "company", "influencer", "youtube", "scrape", "web", "sec", "patent", "reddit"],
    color: "text-cyan-400",
  },
  business: {
    label: "Business",
    keywords: ["lead", "outreach", "email", "proposal", "revenue", "finance", "sales", "social", "content", "brief", "invoice", "contract", "crm"],
    color: "text-emerald-400",
  },
  personal: {
    label: "Personal",
    keywords: ["daily", "habit", "energy", "health", "goal", "reflect", "quest", "weekly", "meeting", "travel", "expense"],
    color: "text-amber-400",
  },
  system: {
    label: "System",
    keywords: ["agent", "capability", "doc", "code", "pdf", "data", "knowledge", "resume", "debate", "enterprise", "github", "skill", "model", "prompt"],
    color: "text-violet-400",
  },
};

// Simple heuristic status indicators for skills
function getSkillStatus(skill: SkillDefinition): { label: string; variant: "ready" | "beta" | "key" } {
  const name = skill.name.toLowerCase();
  const desc = skill.description.toLowerCase();
  const text = name + " " + desc;
  const keySkills = ["image", "video", "voice", "phone", "telegram", "slack", "gmail", "calendar", "notion", "airtable", "shopify", "stripe"];
  if (keySkills.some((k) => text.includes(k))) return { label: "API key", variant: "key" };
  if (name.startsWith("experimental") || name.includes("beta") || name.includes("v2")) return { label: "Beta", variant: "beta" };
  return { label: "Ready", variant: "ready" };
}

function categorize(skill: SkillDefinition): string {
  const text = (skill.name + " " + skill.description + " " + skill.keywords.join(" ")).toLowerCase();
  for (const [cat, { keywords }] of Object.entries(SKILL_CATEGORIES)) {
    if (keywords.some((kw) => text.includes(kw))) return cat;
  }
  return "system";
}

const FAVORITES_KEY = "mavis_skill_favorites";
const RECENT_KEY = "mavis_skill_recent";

interface SkillCatalogDrawerProps {
  open: boolean;
  onClose: () => void;
  onUseSkill: (trigger: string) => void;
}

export function SkillCatalogDrawer({ open, onClose, onUseSkill }: SkillCatalogDrawerProps) {
  const [skills, setSkills] = useState<SkillDefinition[]>([]);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setSkills(getAllSkills());
      try {
        setFavorites(JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]"));
        setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"));
      } catch {
        // ignore
      }
    }
  }, [open]);

  const saveFavorites = useCallback((next: string[]) => {
    setFavorites(next);
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(next)); } catch {}
  }, []);

  const saveRecent = useCallback((next: string[]) => {
    setRecent(next);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next.slice(0, 10))); } catch {}
  }, []);

  const toggleFavorite = useCallback((name: string) => {
    saveFavorites(favorites.includes(name) ? favorites.filter((n) => n !== name) : [...favorites, name]);
  }, [favorites, saveFavorites]);

  const handleUseSkill = useCallback((skill: SkillDefinition, trigger: string) => {
    if (!recent.includes(skill.name)) {
      saveRecent([skill.name, ...recent.filter((n) => n !== skill.name)].slice(0, 10));
    }
    onUseSkill(trigger);
  }, [onUseSkill, recent, saveRecent]);

  const filtered = skills.filter((s) => {
    const matchesQuery =
      !query ||
      s.name.toLowerCase().includes(query.toLowerCase()) ||
      s.description.toLowerCase().includes(query.toLowerCase()) ||
      s.keywords.some((kw) => kw.toLowerCase().includes(query.toLowerCase()));
    const matchesCat = !activeCategory || categorize(s) === activeCategory;
    return matchesQuery && matchesCat;
  });

  const grouped = Object.entries(SKILL_CATEGORIES).reduce(
    (acc, [cat]) => {
      acc[cat] = filtered.filter((s) => categorize(s) === cat);
      return acc;
    },
    {} as Record<string, SkillDefinition[]>
  );

  const favoriteSkills = skills.filter((s) => favorites.includes(s.name)).sort((a, b) => a.name.localeCompare(b.name));
  const recentSkills = recent
    .map((name) => skills.find((s) => s.name === name))
    .filter((s): s is SkillDefinition => Boolean(s));

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-40"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, x: 320 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 320 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="fixed right-0 top-0 h-full w-96 bg-sidebar border-l border-border z-50 flex flex-col shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <div>
                <h2 className="text-xs font-display font-bold text-primary tracking-widest uppercase flex items-center gap-2">
                  <Wrench size={13} /> Skill Catalog
                </h2>
                <p className="text-[10px] font-mono text-muted-foreground">{skills.length} skills registered</p>
              </div>
              <button
                onClick={onClose}
                className="w-7 h-7 rounded border border-border/50 flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
              >
                <X size={13} />
              </button>
            </div>

            {/* Search */}
            <div className="px-3 py-2 border-b border-border shrink-0">
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search skills..."
                  className="w-full pl-7 pr-3 py-1.5 text-xs font-mono bg-card border border-border rounded focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground"
                  autoFocus
                />
              </div>
            </div>

            {/* Category filters */}
            <div className="flex gap-1 px-3 py-2 border-b border-border flex-wrap shrink-0">
              <button
                onClick={() => setActiveCategory(null)}
                className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
                  !activeCategory ? "bg-primary/20 border-primary/40 text-primary" : "border-border/50 text-muted-foreground hover:text-foreground"
                }`}
              >
                All
              </button>
              {Object.entries(SKILL_CATEGORIES).map(([cat, { label, color }]) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
                  className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
                    activeCategory === cat ? "bg-primary/20 border-primary/40 text-primary" : "border-border/50 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className={activeCategory === cat ? "" : color}>{label}</span>
                </button>
              ))}
            </div>

            {/* Skills list */}
            <div className="flex-1 overflow-y-auto p-3 space-y-5 scrollbar-thin">
              {/* Favorites */}
              {favoriteSkills.length > 0 && !query && !activeCategory && (
                <div>
                  <p className="text-[10px] font-mono text-primary uppercase tracking-widest mb-2 px-1 flex items-center gap-1">
                    <Pin size={10} /> Pinned
                  </p>
                  <div className="space-y-1">
                    {favoriteSkills.map((skill) => (
                      <SkillCard
                        key={`fav-${skill.name}`}
                        skill={skill}
                        isFavorite={true}
                        onToggleFavorite={toggleFavorite}
                        onUse={handleUseSkill}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Recent */}
              {recentSkills.length > 0 && !query && !activeCategory && (
                <div>
                  <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-2 px-1 flex items-center gap-1">
                    <Clock size={10} /> Recently Used
                  </p>
                  <div className="space-y-1">
                    {recentSkills.map((skill) => (
                      <SkillCard
                        key={`recent-${skill.name}`}
                        skill={skill}
                        isFavorite={favorites.includes(skill.name)}
                        onToggleFavorite={toggleFavorite}
                        onUse={handleUseSkill}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Grouped catalog */}
              {Object.entries(SKILL_CATEGORIES).map(([cat, { label, color }]) => {
                const catSkills = grouped[cat] ?? [];
                if (!catSkills.length) return null;
                return (
                  <div key={cat}>
                    <p className={`text-[10px] font-mono uppercase tracking-widest mb-2 px-1 flex items-center gap-1 ${color}`}>
                      {label} <span className="text-muted-foreground">({catSkills.length})</span>
                    </p>
                    <div className="space-y-1">
                      {catSkills.map((skill) => (
                        <SkillCard
                          key={skill.name}
                          skill={skill}
                          isFavorite={favorites.includes(skill.name)}
                          onToggleFavorite={toggleFavorite}
                          onUse={handleUseSkill}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}

              {filtered.length === 0 && (
                <EmptyState
                  icon={Search}
                  title="No skills match"
                  description={`Try a different search or category for "${query}"`}
                />
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function SkillCard({
  skill,
  isFavorite,
  onToggleFavorite,
  onUse,
}: {
  skill: SkillDefinition;
  isFavorite: boolean;
  onToggleFavorite: (name: string) => void;
  onUse: (skill: SkillDefinition, trigger: string) => void;
}) {
  const status = getSkillStatus(skill);
  const trigger = skill.keywords[0] ?? skill.name;
  return (
    <div className="group rounded-lg border border-border/50 hover:border-primary/30 bg-card hover:bg-primary/5 transition-all p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-xs font-mono font-medium text-foreground leading-tight">{skill.name}</p>
            <span
              className={`text-[9px] font-mono px-1 py-0 rounded border ${
                status.variant === "ready"
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                  : status.variant === "beta"
                  ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                  : "bg-blue-500/10 border-blue-500/30 text-blue-400"
              }`}
              title={status.variant === "key" ? "May require an external API key" : undefined}
            >
              {status.label}
            </span>
          </div>
          <p className="text-[10px] font-mono text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">
            {skill.description.split(".")[0]}.
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onToggleFavorite(skill.name)}
            className={`p-1 rounded transition-colors ${
              isFavorite ? "text-primary hover:text-primary/80" : "text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-primary"
            }`}
            title={isFavorite ? "Unpin" : "Pin to top"}
          >
            <Star size={12} fill={isFavorite ? "currentColor" : "none"} />
          </button>
          <button
            onClick={() => onUse(skill, trigger)}
            className="shrink-0 flex items-center gap-1 px-2 py-1 rounded border border-primary/30 bg-primary/10 text-primary text-[10px] font-mono opacity-0 group-hover:opacity-100 transition-all hover:bg-primary/20"
          >
            <Zap size={9} /> Use
          </button>
        </div>
      </div>
      {skill.keywords.length > 0 && (
        <div className="flex gap-1 flex-wrap mt-1.5">
          {skill.keywords.slice(0, 3).map((kw) => (
            <button
              key={kw}
              onClick={() => onUse(skill, kw)}
              className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
            >
              {kw}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
