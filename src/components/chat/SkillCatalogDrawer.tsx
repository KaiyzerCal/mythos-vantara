import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Search, Zap } from "lucide-react";
import { getAllSkills } from "@/mavis/skills/_registry";
import type { SkillDefinition } from "@/mavis/skills/_registry";

// Skill category tags for grouping
const SKILL_CATEGORIES: Record<string, { label: string; keywords: string[] }> = {
  creative: {
    label: "Creative",
    keywords: ["image", "logo", "music", "poster", "video", "avatar", "design"],
  },
  intelligence: {
    label: "Intelligence",
    keywords: ["research", "intel", "news", "crypto", "market", "stock", "competitor", "company", "influencer", "youtube", "scrape", "web"],
  },
  business: {
    label: "Business",
    keywords: ["lead", "outreach", "email", "proposal", "revenue", "finance", "sales", "social", "content", "brief"],
  },
  personal: {
    label: "Personal",
    keywords: ["daily", "habit", "energy", "health", "goal", "reflect", "quest", "weekly", "meeting"],
  },
  system: {
    label: "System",
    keywords: ["agent", "capability", "doc", "code", "pdf", "data", "knowledge", "resume", "debate", "enterprise", "github"],
  },
};

function categorize(skill: SkillDefinition): string {
  const text = (skill.name + " " + skill.description + " " + skill.keywords.join(" ")).toLowerCase();
  for (const [cat, { keywords }] of Object.entries(SKILL_CATEGORIES)) {
    if (keywords.some((kw) => text.includes(kw))) return cat;
  }
  return "system";
}

interface SkillCatalogDrawerProps {
  open: boolean;
  onClose: () => void;
  onUseSkill: (trigger: string) => void;
}

export function SkillCatalogDrawer({ open, onClose, onUseSkill }: SkillCatalogDrawerProps) {
  const [skills, setSkills] = useState<SkillDefinition[]>([]);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  useEffect(() => {
    if (open) setSkills(getAllSkills());
  }, [open]);

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
            className="fixed right-0 top-0 h-full w-80 bg-sidebar border-l border-border z-50 flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <div>
                <h2 className="text-xs font-display font-bold text-primary tracking-widest uppercase">Skill Catalog</h2>
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
              {Object.entries(SKILL_CATEGORIES).map(([cat, { label }]) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
                  className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
                    activeCategory === cat ? "bg-primary/20 border-primary/40 text-primary" : "border-border/50 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Skills list */}
            <div className="flex-1 overflow-y-auto p-3 space-y-4 scrollbar-thin">
              {Object.entries(SKILL_CATEGORIES).map(([cat, { label }]) => {
                const catSkills = grouped[cat] ?? [];
                if (!catSkills.length) return null;
                return (
                  <div key={cat}>
                    <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-2 px-1">
                      {label}
                    </p>
                    <div className="space-y-1">
                      {catSkills.map((skill) => {
                        const trigger = skill.keywords[0] ?? skill.name;
                        return (
                          <div
                            key={skill.name}
                            className="group rounded-lg border border-border/50 hover:border-primary/30 bg-card hover:bg-primary/5 transition-all p-2.5"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-mono font-medium text-foreground leading-tight">
                                  {skill.name}
                                </p>
                                <p className="text-[10px] font-mono text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">
                                  {skill.description.split(".")[0]}.
                                </p>
                              </div>
                              <button
                                onClick={() => { onUseSkill(trigger); onClose(); }}
                                className="shrink-0 flex items-center gap-1 px-2 py-1 rounded border border-primary/30 bg-primary/10 text-primary text-[10px] font-mono opacity-0 group-hover:opacity-100 transition-all hover:bg-primary/20"
                              >
                                <Zap size={9} /> Use
                              </button>
                            </div>
                            {skill.keywords.length > 0 && (
                              <div className="flex gap-1 flex-wrap mt-1.5">
                                {skill.keywords.slice(0, 3).map((kw) => (
                                  <button
                                    key={kw}
                                    onClick={() => { onUseSkill(kw); onClose(); }}
                                    className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
                                  >
                                    {kw}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {filtered.length === 0 && (
                <p className="text-xs font-mono text-muted-foreground text-center py-8">
                  No skills match "{query}"
                </p>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
