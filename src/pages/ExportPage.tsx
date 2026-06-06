// ============================================================
// VANTARA.EXE — ExportPage
// Data portability: download all MAVIS data as JSON
// ============================================================
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  BookLock, BookOpen, Target, CheckSquare, Crosshair, UserCheck, Cpu, DollarSign,
  Download, Loader2, ShieldAlert,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";

// ─── Icon map ────────────────────────────────────────────────
const ICONS: Record<string, React.ElementType> = {
  BookLock,
  BookOpen,
  Target,
  CheckSquare,
  Crosshair,
  UserCheck,
  Cpu,
  DollarSign,
};

// ─── Export type definitions ─────────────────────────────────
const EXPORT_TYPES = [
  { id: "notes",    label: "Vault Notes",     table: "mavis_notes",     icon: "BookLock",    description: "All vault entries with content, tags, and links" },
  { id: "journal",  label: "Journal Entries", table: "journal_entries", icon: "BookOpen",    description: "All journal entries with mood and timestamps" },
  { id: "quests",   label: "Quests",          table: "quests",          icon: "Target",      description: "All quests with status, deadline, and metadata" },
  { id: "tasks",    label: "Tasks & Habits",  table: "tasks",           icon: "CheckSquare", description: "Tasks and habits with streak data" },
  { id: "goals",    label: "Goals",           table: "mavis_goals",     icon: "Crosshair",   description: "Active and completed goals" },
  { id: "contacts", label: "Contacts",        table: "contacts",        icon: "UserCheck",   description: "Contact profiles and interaction notes" },
  { id: "memory",   label: "MAVIS Memory",    table: "mavis_memory",    icon: "Cpu",         description: "Episodic memory entries" },
  { id: "finance",  label: "Finance",         table: "mavis_revenue",   icon: "DollarSign",  description: "Revenue entries (expenses exported separately)" },
] as const;

type ExportId = typeof EXPORT_TYPES[number]["id"];

// ─── Helpers ─────────────────────────────────────────────────
function triggerDownload(json: string, filename: string) {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ─── ExportPage ──────────────────────────────────────────────
export function ExportPage() {
  const { user } = useAuth();

  const [exporting, setExporting] = useState<Record<string, boolean>>({});
  const [exportStats, setExportStats] = useState<Record<string, number>>({});
  const [statsLoading, setStatsLoading] = useState(true);

  // ─── Load row counts on mount ─────────────────────────────
  useEffect(() => {
    if (!user) return;

    async function loadStats() {
      setStatsLoading(true);
      const results = await Promise.all(
        EXPORT_TYPES.map(({ id, table }) =>
          supabase
            .from(table as Parameters<typeof supabase.from>[0])
            .select("*", { count: "exact", head: true })
            .eq("user_id", user!.id)
            .then(({ count }) => ({ id, count: count ?? 0 }))
        )
      );
      const stats: Record<string, number> = {};
      for (const { id, count } of results) stats[id] = count;
      setExportStats(stats);
      setStatsLoading(false);
    }

    loadStats();
  }, [user]);

  // ─── Export single type ───────────────────────────────────
  async function exportOne(exportType: typeof EXPORT_TYPES[number]) {
    if (!user) return;
    const { id, label, table } = exportType;

    setExporting((prev) => ({ ...prev, [id]: true }));
    try {
      const { data, error } = await supabase
        .from(table as Parameters<typeof supabase.from>[0])
        .select("*")
        .eq("user_id", user.id);

      if (error) throw error;

      const rows = data ?? [];
      const json = JSON.stringify(
        { exported_at: new Date().toISOString(), type: label, count: rows.length, data: rows },
        null,
        2
      );
      triggerDownload(json, `mavis-${id}-${today()}.json`);
      toast.success(`Downloaded ${rows.length} ${label} records`);
    } catch {
      toast.error(`Failed to export ${label}`);
    } finally {
      setExporting((prev) => ({ ...prev, [id]: false }));
    }
  }

  // ─── Export all ───────────────────────────────────────────
  async function exportAll() {
    if (!user) return;

    setExporting((prev) => ({ ...prev, all: true }));
    try {
      const results = await Promise.all(
        EXPORT_TYPES.map(({ id, table }) =>
          supabase
            .from(table as Parameters<typeof supabase.from>[0])
            .select("*")
            .eq("user_id", user.id)
            .then(({ data }) => ({ id, rows: data ?? [] }))
        )
      );

      const sections: Record<string, { count: number; data: unknown[] }> = {};
      let totalCount = 0;
      for (const { id, rows } of results) {
        sections[id] = { count: rows.length, data: rows };
        totalCount += rows.length;
      }

      const json = JSON.stringify(
        { exported_at: new Date().toISOString(), operator_id: user.id, sections },
        null,
        2
      );
      triggerDownload(json, `mavis-full-export-${today()}.json`);
      toast.success(`Downloaded full export — ${totalCount} total records`);
    } catch {
      toast.error("Failed to export all data");
    } finally {
      setExporting((prev) => ({ ...prev, all: false }));
    }
  }

  // ─── Derived state ────────────────────────────────────────
  const anyExporting = Object.values(exporting).some(Boolean);
  const totalRecords = Object.values(exportStats).reduce((sum, n) => sum + n, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data Export"
        subtitle="Download your MAVIS data for backup or portability"
        icon={<Download size={18} />}
      />

      {/* ── Info Banner ──────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="flex items-start gap-3 px-4 py-3 rounded-lg border border-cyan-700/40 bg-cyan-900/10 text-cyan-300">
          <ShieldAlert size={15} className="mt-0.5 shrink-0" />
          <p className="text-xs font-mono leading-relaxed">
            All data exported as JSON. Re-importable via MAVIS API. Your data, your control.
          </p>
        </div>
      </motion.div>

      {/* ── Export Everything Button ──────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
      >
        <button
          onClick={exportAll}
          disabled={anyExporting}
          className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-lg border border-primary/40 bg-primary/10 text-primary font-mono font-bold text-sm hover:bg-primary/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
        >
          {exporting.all ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Download size={16} />
          )}
          Export Everything
          {!statsLoading && (
            <span className="ml-1 text-xs font-mono text-primary/70">
              ({totalRecords.toLocaleString()} records)
            </span>
          )}
        </button>
      </motion.div>

      {/* ── Per-type Export Grid ──────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {EXPORT_TYPES.map((et, i) => {
          const IconComp = ICONS[et.icon];
          const count = exportStats[et.id];
          const isExporting = !!exporting[et.id];

          return (
            <motion.div
              key={et.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: 0.08 + i * 0.04 }}
            >
              <HudCard className="flex flex-col gap-3 h-full">
                {/* Card Header */}
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                    {IconComp && <IconComp size={15} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-display font-bold text-foreground leading-tight">
                      {et.label}
                    </p>
                    <p className="text-[10px] font-mono text-muted-foreground mt-0.5 leading-snug">
                      {et.description}
                    </p>
                  </div>
                </div>

                {/* Footer: record count + download button */}
                <div className="flex items-center justify-between mt-auto">
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {statsLoading
                      ? "— records"
                      : `${(count ?? 0).toLocaleString()} record${count !== 1 ? "s" : ""}`}
                  </span>
                  <button
                    onClick={() => exportOne(et)}
                    disabled={anyExporting}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-muted/30 border border-border rounded hover:bg-muted/60 hover:border-primary/40 hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150"
                  >
                    {isExporting ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Download size={11} />
                    )}
                    Download
                  </button>
                </div>
              </HudCard>
            </motion.div>
          );
        })}
      </div>

      {/* ── Privacy Note ─────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.45 }}
      >
        <HudCard>
          <div className="flex items-start gap-3">
            <ShieldAlert size={15} className="text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-mono text-amber-400 uppercase tracking-widest mb-1">
                Privacy Note
              </p>
              <p className="text-xs font-mono text-muted-foreground leading-relaxed">
                API keys and secrets stored in{" "}
                <span className="font-bold text-foreground/80">mavis_user_integrations</span>{" "}
                are <span className="font-bold text-amber-400">not</span> included in any export for
                security. Re-configure integrations manually after a restore.
              </p>
            </div>
          </div>
        </HudCard>
      </motion.div>
    </div>
  );
}
