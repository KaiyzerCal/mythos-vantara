import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { motion, AnimatePresence } from "framer-motion";
import {
  Database, Search, Plus, Trash2, Pencil, Sparkles,
  ChevronRight, Loader2, X, Check, RefreshCw, ExternalLink,
  Table2, AlertCircle, Key, Copy,
} from "lucide-react";
import { toast } from "sonner";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function callAirtable(action: string, extra: Record<string, unknown> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mavis-airtable-agent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ action, ...extra }),
    },
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

function fieldVal(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(item => (typeof item === "object" && item !== null ? (item as any).name ?? JSON.stringify(item) : String(item))).join(", ");
  if (typeof v === "object") return JSON.stringify(v).slice(0, 80);
  return String(v);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface AirtableBase { id: string; name: string; permission?: string }
interface AirtableRecord { id: string; createdTime?: string; fields: Record<string, unknown> }

// ── Sub-components ────────────────────────────────────────────────────────────

function EnrichModal({
  record, baseId, table, onClose,
}: { record: AirtableRecord; baseId: string; table: string; onClose: () => void }) {
  const [prompt, setPrompt] = useState("Analyze this record and provide a concise summary with key insights.");
  const [outputField, setOutputField] = useState("AI_Output");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setResult(null);
    try {
      const data = await callAirtable("enrich_record", {
        base_id: baseId, table, record_id: record.id, prompt, output_field: outputField,
      });
      setResult(data.ai_output ?? data.ai_preview ?? "Done");
      toast.success(`Enriched and written to "${outputField}"`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  const fieldKeys = Object.keys(record.fields);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="relative z-10 w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-2xl p-5 shadow-2xl space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-violet-400" />
            <span className="font-semibold text-white text-sm">AI Enrich Record</span>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300"><X size={16} /></button>
        </div>

        <div className="text-xs text-zinc-400 bg-zinc-800/50 rounded-lg p-3 space-y-1">
          {fieldKeys.slice(0, 5).map(k => (
            <div key={k} className="flex gap-2">
              <span className="text-zinc-500 shrink-0 w-28 truncate">{k}:</span>
              <span className="text-zinc-300 truncate">{fieldVal(record.fields[k])}</span>
            </div>
          ))}
          {fieldKeys.length > 5 && <span className="text-zinc-600 text-[10px]">+{fieldKeys.length - 5} more fields</span>}
        </div>

        <div className="space-y-2">
          <label className="text-xs text-zinc-400">AI Prompt</label>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={3}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-violet-500/50 resize-none"
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1 space-y-1">
            <label className="text-xs text-zinc-400">Write result to field</label>
            <input
              value={outputField}
              onChange={e => setOutputField(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-violet-500/50"
            />
          </div>
          <button
            onClick={run}
            disabled={loading || !prompt.trim()}
            className="mt-5 flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-medium transition-colors"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {loading ? "Running…" : "Run"}
          </button>
        </div>

        {result && (
          <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-lg p-3 text-xs text-zinc-300 whitespace-pre-wrap max-h-40 overflow-y-auto">
            {result}
          </div>
        )}
      </motion.div>
    </div>
  );
}

function CreateRecordModal({
  baseId, table, sampleFields, onClose, onCreated,
}: {
  baseId: string; table: string; sampleFields: string[];
  onClose: () => void; onCreated: () => void;
}) {
  const [rows, setRows] = useState<{ key: string; value: string }[]>(
    sampleFields.slice(0, 6).map(k => ({ key: k, value: "" }))
  );
  const [loading, setLoading] = useState(false);

  async function save() {
    setLoading(true);
    try {
      const fields: Record<string, string> = {};
      for (const { key, value } of rows) {
        if (key.trim() && value.trim()) fields[key.trim()] = value.trim();
      }
      await callAirtable("create_record", { base_id: baseId, table, fields });
      toast.success("Record created");
      onCreated();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="relative z-10 w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-2xl p-5 shadow-2xl space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="font-semibold text-white text-sm">New Record — {table}</span>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300"><X size={16} /></button>
        </div>

        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {rows.map((r, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input
                value={r.key}
                onChange={e => setRows(prev => prev.map((x, j) => j === i ? { ...x, key: e.target.value } : x))}
                placeholder="Field name"
                className="w-32 shrink-0 bg-zinc-800 border border-zinc-700/60 rounded px-2 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-violet-500/40"
              />
              <input
                value={r.value}
                onChange={e => setRows(prev => prev.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                placeholder="Value"
                className="flex-1 bg-zinc-800 border border-zinc-700/60 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-violet-500/40"
              />
              <button
                onClick={() => setRows(prev => prev.filter((_, j) => j !== i))}
                className="text-zinc-600 hover:text-zinc-400"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <button
            onClick={() => setRows(prev => [...prev, { key: "", value: "" }])}
            className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1"
          >
            <Plus size={12} /> Add field
          </button>
        </div>

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-400 text-xs hover:border-zinc-600">Cancel</button>
          <button
            onClick={save}
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium disabled:opacity-40 transition-colors"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Create
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AirtablePage() {
  const [bases, setBases] = useState<AirtableBase[]>([]);
  const [basesLoading, setBasesLoading] = useState(true);
  const [basesError, setBasesError] = useState<string | null>(null);

  const [selectedBase, setSelectedBase] = useState<AirtableBase | null>(null);
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);

  const [records, setRecords] = useState<AirtableRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);

  const [enrichTarget, setEnrichTarget] = useState<AirtableRecord | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // ── Load bases ──────────────────────────────────────────────────────────────
  useEffect(() => {
    setBasesLoading(true);
    callAirtable("list_bases")
      .then(d => { setBases(d.bases ?? []); setBasesError(null); })
      .catch(e => setBasesError(e.message))
      .finally(() => setBasesLoading(false));
  }, []);

  // ── Load records when table selected ───────────────────────────────────────
  const loadRecords = useCallback(async (baseId: string, table: string) => {
    setRecordsLoading(true);
    setSearch("");
    try {
      const d = await callAirtable("list_records", { base_id: baseId, table, max_records: 100 });
      setRecords(d.records ?? []);
    } catch (e: any) {
      toast.error(e.message);
      setRecords([]);
    } finally {
      setRecordsLoading(false);
    }
  }, []);

  // Derive table list from first record's fields (Airtable meta API isn't in our function)
  async function selectBase(base: AirtableBase) {
    setSelectedBase(base);
    setSelectedTable(null);
    setRecords([]);
    setTables([]);
    // Probe common table names — user can type a custom one
    setTables(["Tasks", "Projects", "Contacts", "Content", "Ideas", "Leads", "CRM"]);
  }

  function selectTable(table: string) {
    setSelectedTable(table);
    if (selectedBase) loadRecords(selectedBase.id, table);
  }

  // ── Search ──────────────────────────────────────────────────────────────────
  async function runSearch() {
    if (!selectedBase || !selectedTable || !search.trim()) return;
    setSearching(true);
    try {
      const d = await callAirtable("search_records", {
        base_id: selectedBase.id, table: selectedTable, term: search.trim(),
      });
      setRecords(d.records ?? []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSearching(false);
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────
  async function deleteRecord(id: string) {
    if (!selectedBase || !selectedTable) return;
    setDeletingId(id);
    try {
      await callAirtable("delete_record", { base_id: selectedBase.id, table: selectedTable, record_id: id });
      setRecords(prev => prev.filter(r => r.id !== id));
      toast.success("Record deleted");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeletingId(null);
    }
  }

  function copyId(id: string) {
    navigator.clipboard.writeText(id).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  }

  // ── Visible columns (top 6 field keys from first record) ──────────────────
  const visibleCols: string[] = records.length > 0
    ? Object.keys(records[0].fields).slice(0, 6)
    : [];

  const sampleFields = records.length > 0 ? Object.keys(records[0].fields) : [];

  return (
    <div className="flex h-full bg-zinc-950 text-white overflow-hidden">

      {/* ── Left sidebar ──────────────────────────────────────────────────── */}
      <div className="w-56 shrink-0 flex flex-col border-r border-zinc-800/60 bg-zinc-900/40">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800/50">
          <Database size={14} className="text-green-400" />
          <span className="font-mono font-semibold text-xs tracking-widest text-white">AIRTABLE</span>
        </div>

        {/* Bases */}
        <div className="flex-1 overflow-y-auto p-2">
          {basesLoading ? (
            <div className="flex items-center gap-2 text-zinc-600 text-xs p-3">
              <Loader2 size={12} className="animate-spin" /> Loading bases…
            </div>
          ) : basesError ? (
            <div className="p-3 space-y-2">
              <div className="flex items-start gap-1.5 text-red-400 text-xs">
                <AlertCircle size={12} className="mt-0.5 shrink-0" />
                <span>{basesError}</span>
              </div>
              {basesError.includes("not configured") && (
                <div className="text-[10px] text-zinc-500 flex items-center gap-1">
                  <Key size={10} /> Set <code className="text-zinc-400">AIRTABLE_API_KEY</code> in Supabase secrets
                </div>
              )}
            </div>
          ) : bases.length === 0 ? (
            <p className="text-zinc-600 text-xs p-3">No bases found</p>
          ) : (
            <>
              <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-wider px-2 mb-1">Bases</p>
              {bases.map(base => (
                <button
                  key={base.id}
                  onClick={() => selectBase(base)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition-colors flex items-center gap-2 ${
                    selectedBase?.id === base.id
                      ? "bg-green-500/10 text-green-300 border border-green-500/20"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                  }`}
                >
                  <Table2 size={11} className="shrink-0" />
                  <span className="truncate">{base.name}</span>
                </button>
              ))}
            </>
          )}

          {/* Tables for selected base */}
          {selectedBase && (
            <div className="mt-3">
              <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-wider px-2 mb-1">Tables</p>
              {tables.map(t => (
                <button
                  key={t}
                  onClick={() => selectTable(t)}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors flex items-center gap-2 ${
                    selectedTable === t
                      ? "bg-zinc-800 text-white"
                      : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30"
                  }`}
                >
                  <ChevronRight size={10} className="shrink-0" />
                  {t}
                </button>
              ))}
              {/* Custom table input */}
              <form
                className="mt-1 flex"
                onSubmit={e => {
                  e.preventDefault();
                  const val = (e.currentTarget.elements.namedItem("custom") as HTMLInputElement).value.trim();
                  if (val) { setTables(prev => prev.includes(val) ? prev : [...prev, val]); selectTable(val); }
                  (e.currentTarget.elements.namedItem("custom") as HTMLInputElement).value = "";
                }}
              >
                <input
                  name="custom"
                  placeholder="Other table…"
                  className="flex-1 bg-zinc-800/60 border border-zinc-700/40 rounded-l px-2 py-1 text-[10px] text-zinc-300 placeholder:text-zinc-600 focus:outline-none"
                />
                <button type="submit" className="bg-zinc-700 hover:bg-zinc-600 px-2 rounded-r text-zinc-300 transition-colors">
                  <ChevronRight size={10} />
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Airtable link */}
        <a
          href="https://airtable.com"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 px-4 py-2.5 border-t border-zinc-800/50 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          <ExternalLink size={10} /> Open Airtable
        </a>
      </div>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-zinc-800/50 bg-zinc-950/70 shrink-0">
          {selectedTable ? (
            <>
              <span className="font-mono font-semibold text-sm text-white">{selectedTable}</span>
              {selectedBase && (
                <span className="text-xs text-zinc-600 font-mono">{selectedBase.name}</span>
              )}
              <div className="flex-1" />

              {/* Search */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") runSearch(); }}
                    placeholder="Search records…"
                    className="pl-7 pr-3 py-1.5 bg-zinc-800/60 border border-zinc-700/50 rounded-lg text-xs text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500/50 w-48"
                  />
                </div>
                <button
                  onClick={runSearch}
                  disabled={!search.trim() || searching}
                  className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs transition-colors disabled:opacity-40"
                >
                  {searching ? <Loader2 size={12} className="animate-spin" /> : "Search"}
                </button>
                {search && (
                  <button
                    onClick={() => { setSearch(""); if (selectedBase && selectedTable) loadRecords(selectedBase.id, selectedTable); }}
                    className="text-zinc-600 hover:text-zinc-400"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              <button
                onClick={() => { if (selectedBase && selectedTable) loadRecords(selectedBase.id, selectedTable); }}
                className="text-zinc-500 hover:text-zinc-300 p-1.5 rounded hover:bg-zinc-800/60 transition-colors"
                title="Refresh"
              >
                <RefreshCw size={13} />
              </button>
              <button
                onClick={() => setCreateOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white text-xs font-medium transition-colors"
              >
                <Plus size={13} /> New Record
              </button>
            </>
          ) : (
            <span className="text-zinc-500 text-sm">
              {selectedBase ? "Select a table →" : "Select a base →"}
            </span>
          )}
        </div>

        {/* Records table */}
        <div className="flex-1 overflow-auto">
          {!selectedTable ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-600 gap-3">
              <Database size={40} className="opacity-30" />
              <p className="text-sm">Choose a base and table from the left</p>
            </div>
          ) : recordsLoading ? (
            <div className="flex items-center justify-center h-full gap-2 text-zinc-500">
              <Loader2 size={16} className="animate-spin" /> Loading records…
            </div>
          ) : records.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-600 gap-3">
              <Table2 size={36} className="opacity-30" />
              <p className="text-sm">No records found in "{selectedTable}"</p>
              <button
                onClick={() => setCreateOpen(true)}
                className="text-xs text-green-400 hover:text-green-300 flex items-center gap-1"
              >
                <Plus size={12} /> Add first record
              </button>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800/60 bg-zinc-900/60 sticky top-0">
                  <th className="text-left px-4 py-2.5 font-mono text-[10px] text-zinc-500 uppercase tracking-wider w-32">Record ID</th>
                  {visibleCols.map(col => (
                    <th key={col} className="text-left px-3 py-2.5 font-mono text-[10px] text-zinc-500 uppercase tracking-wider">
                      {col}
                    </th>
                  ))}
                  <th className="text-right px-4 py-2.5 font-mono text-[10px] text-zinc-500 uppercase tracking-wider w-28">Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map(record => (
                  <tr
                    key={record.id}
                    className="border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors"
                  >
                    {/* Record ID */}
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => copyId(record.id)}
                        className="flex items-center gap-1 font-mono text-zinc-600 hover:text-zinc-400 transition-colors"
                        title={record.id}
                      >
                        {copiedId === record.id
                          ? <Check size={10} className="text-green-400" />
                          : <Copy size={10} />
                        }
                        <span>{record.id.slice(0, 10)}…</span>
                      </button>
                    </td>

                    {/* Field values */}
                    {visibleCols.map(col => (
                      <td key={col} className="px-3 py-2.5 text-zinc-300 max-w-[200px]">
                        <span className="line-clamp-2 block">{fieldVal(record.fields[col])}</span>
                      </td>
                    ))}

                    {/* Actions */}
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => setEnrichTarget(record)}
                          className="p-1 rounded hover:bg-violet-500/10 text-zinc-500 hover:text-violet-400 transition-colors"
                          title="AI Enrich"
                        >
                          <Sparkles size={13} />
                        </button>
                        <button
                          onClick={() => deleteRecord(record.id)}
                          disabled={deletingId === record.id}
                          className="p-1 rounded hover:bg-red-500/10 text-zinc-600 hover:text-red-400 transition-colors disabled:opacity-40"
                          title="Delete"
                        >
                          {deletingId === record.id
                            ? <Loader2 size={13} className="animate-spin" />
                            : <Trash2 size={13} />
                          }
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        {records.length > 0 && (
          <div className="px-5 py-2 border-t border-zinc-800/40 bg-zinc-950/50 text-[10px] font-mono text-zinc-600">
            {records.length} records · {visibleCols.length} visible columns · {selectedBase?.name} / {selectedTable}
          </div>
        )}
      </div>

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {enrichTarget && selectedBase && selectedTable && (
          <EnrichModal
            key="enrich"
            record={enrichTarget}
            baseId={selectedBase.id}
            table={selectedTable}
            onClose={() => setEnrichTarget(null)}
          />
        )}
        {createOpen && selectedBase && selectedTable && (
          <CreateRecordModal
            key="create"
            baseId={selectedBase.id}
            table={selectedTable}
            sampleFields={sampleFields}
            onClose={() => setCreateOpen(false)}
            onCreated={() => loadRecords(selectedBase.id, selectedTable)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
