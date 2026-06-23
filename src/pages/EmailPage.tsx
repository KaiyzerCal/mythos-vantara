// ============================================================
// VANTARA.EXE — EmailPage
// Email compose interface with MAVIS drafting capability
// ============================================================
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mail,
  Plus,
  Loader2,
  X,
  Send,
  Sparkles,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Info,
} from "lucide-react";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

// ─── Types ──────────────────────────────────────────────────
interface EmailOutbox {
  id: string;
  user_id: string;
  to_address: string;
  subject: string;
  body: string;
  resend_id: string | null;
  status: string;
  created_at: string;
}

interface ComposeForm {
  to: string;
  subject: string;
  body: string;
  generate_prompt: string;
  useGenerate: boolean;
}

interface DraftPreview {
  subject: string;
  body: string;
}

// ─── Helpers ────────────────────────────────────────────────
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

const STATUS_STYLES: Record<string, string> = {
  sent: "bg-green-900/40 text-green-300 border-green-700",
  failed: "bg-red-900/40 text-red-300 border-red-700",
  pending: "bg-amber-900/40 text-amber-300 border-amber-700",
  draft: "bg-zinc-800/50 text-zinc-300 border-zinc-600",
};

// ─── EmailPage ──────────────────────────────────────────────
export function EmailPage() {
  const { session } = useAuth();

  const [outbox, setOutbox] = useState<EmailOutbox[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCompose, setShowCompose] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [draftPreview, setDraftPreview] = useState<DraftPreview | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [form, setForm] = useState<ComposeForm>({
    to: "",
    subject: "",
    body: "",
    generate_prompt: "",
    useGenerate: false,
  });

  // ─── Load Outbox ───────────────────────────────────────────
  const loadOutbox = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("email_outbox")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) {
      toast.error("Failed to load outbox");
    } else {
      setOutbox((data as EmailOutbox[]) || []);
    }
    setLoading(false);
  }, [session]);

  useEffect(() => {
    loadOutbox();
  }, [loadOutbox]);

  // ─── Reset compose form ────────────────────────────────────
  function resetForm() {
    setForm({
      to: "",
      subject: "",
      body: "",
      generate_prompt: "",
      useGenerate: false,
    });
    setDraftPreview(null);
  }

  // ─── Handle Draft (generate & preview) ────────────────────
  async function handleDraft() {
    if (!session) return;
    if (!form.generate_prompt.trim()) {
      toast.error("Describe the email you want to generate");
      return;
    }
    setGeneratingDraft(true);
    setDraftPreview(null);
    try {
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/mavis-email-send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            to: form.to || "preview@example.com",
            subject: form.subject || undefined,
            generate: true,
            generate_prompt: form.generate_prompt,
            preview_only: true,
          }),
        }
      );
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setDraftPreview({
        subject: data.subject ?? form.subject,
        body: data.body ?? data.content ?? "",
      });
    } catch (e: any) {
      toast.error(e.message || "Draft generation failed");
    } finally {
      setGeneratingDraft(false);
    }
  }

  // ─── Handle Send ──────────────────────────────────────────
  async function handleSend(overridePreview?: DraftPreview) {
    if (!session) return;
    if (!form.to.trim()) {
      toast.error("To address is required");
      return;
    }

    const usePreview = overridePreview ?? draftPreview;

    setSendingEmail(true);
    const sendId = toast.loading("Sending...");
    try {
      const payload: Record<string, unknown> = {
        to: form.to.trim(),
        subject: usePreview?.subject ?? form.subject,
        body: usePreview?.body ?? form.body,
      };
      if (form.useGenerate && !usePreview) {
        payload.generate = true;
        payload.generate_prompt = form.generate_prompt;
      }

      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/mavis-email-send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) throw new Error(await res.text());
      toast.dismiss(sendId);
      toast.success("Sent!");
      resetForm();
      setShowCompose(false);
      loadOutbox();
    } catch (e: any) {
      toast.dismiss(sendId);
      toast.error(e.message || "Send failed");
    } finally {
      setSendingEmail(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Email"
        subtitle="Compose and send with MAVIS drafting"
        icon={<Mail size={18} />}
        actions={
          <button
            onClick={() => {
              setShowCompose((v) => !v);
              if (showCompose) resetForm();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 transition-colors"
          >
            {showCompose ? <X size={12} /> : <Plus size={12} />}
            {showCompose ? "Cancel" : "Compose"}
          </button>
        }
      />

      {/* ── Compose Panel ────────────────────────────────────── */}
      <AnimatePresence>
        {showCompose && (
          <motion.div
            key="compose"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <HudCard glowColor="gold">
              {/* Mode toggle */}
              <div className="flex items-center gap-1 mb-4 p-0.5 rounded-md bg-muted/30 border border-border w-fit">
                <button
                  onClick={() => {
                    setForm((f) => ({ ...f, useGenerate: false }));
                    setDraftPreview(null);
                  }}
                  className={`px-3 py-1 text-xs font-mono rounded transition-colors ${
                    !form.useGenerate
                      ? "bg-primary/20 text-primary border border-primary/30"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Write manually
                </button>
                <button
                  onClick={() => {
                    setForm((f) => ({ ...f, useGenerate: true }));
                    setDraftPreview(null);
                  }}
                  className={`flex items-center gap-1 px-3 py-1 text-xs font-mono rounded transition-colors ${
                    form.useGenerate
                      ? "bg-primary/20 text-primary border border-primary/30"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Sparkles size={9} /> MAVIS Draft
                </button>
              </div>

              <div className="space-y-2.5">
                {/* To */}
                <div>
                  <label className="text-xs font-mono text-muted-foreground block mb-0.5">
                    To *
                  </label>
                  <input
                    type="email"
                    value={form.to}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, to: e.target.value }))
                    }
                    placeholder="recipient@example.com"
                    className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                  />
                </div>

                {!form.useGenerate ? (
                  <>
                    {/* Subject */}
                    <div>
                      <label className="text-xs font-mono text-muted-foreground block mb-0.5">
                        Subject
                      </label>
                      <input
                        type="text"
                        value={form.subject}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, subject: e.target.value }))
                        }
                        placeholder="Email subject..."
                        className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                      />
                    </div>
                    {/* Body */}
                    <div>
                      <label className="text-xs font-mono text-muted-foreground block mb-0.5">
                        Body
                      </label>
                      <textarea
                        rows={6}
                        value={form.body}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, body: e.target.value }))
                        }
                        placeholder="Write your email content..."
                        className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono resize-y focus:outline-none focus:border-primary/40"
                      />
                    </div>
                    {/* Send */}
                    <div className="flex justify-end">
                      <button
                        onClick={() => handleSend()}
                        disabled={sendingEmail || !form.to.trim()}
                        className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 disabled:opacity-50 transition-colors"
                      >
                        {sendingEmail ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : (
                          <Send size={11} />
                        )}
                        Send
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Subject (optional for MAVIS) */}
                    <div>
                      <label className="text-xs font-mono text-muted-foreground block mb-0.5">
                        Subject{" "}
                        <span className="text-muted-foreground">
                          (optional — MAVIS can generate)
                        </span>
                      </label>
                      <input
                        type="text"
                        value={form.subject}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, subject: e.target.value }))
                        }
                        placeholder="Leave blank to let MAVIS decide..."
                        className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                      />
                    </div>
                    {/* Prompt */}
                    <div>
                      <label className="text-xs font-mono text-muted-foreground block mb-0.5">
                        Describe the email *
                      </label>
                      <textarea
                        rows={3}
                        value={form.generate_prompt}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            generate_prompt: e.target.value,
                          }))
                        }
                        placeholder="e.g. A follow-up to a sales call, warm tone, mention the proposal we discussed..."
                        className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono resize-y focus:outline-none focus:border-primary/40"
                      />
                    </div>
                    {/* Generate & Preview */}
                    {!draftPreview && (
                      <div className="flex justify-end">
                        <button
                          onClick={handleDraft}
                          disabled={
                            generatingDraft ||
                            !form.generate_prompt.trim()
                          }
                          className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 disabled:opacity-50 transition-colors"
                        >
                          {generatingDraft ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <Sparkles size={11} />
                          )}
                          Generate & Preview
                        </button>
                      </div>
                    )}

                    {/* Draft Preview Card */}
                    <AnimatePresence>
                      {draftPreview && (
                        <motion.div
                          key="preview"
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="border border-primary/20 rounded-md p-3 bg-primary/5 space-y-2"
                        >
                          <p className="text-xs font-mono text-primary uppercase tracking-widest">
                            Generated Preview
                          </p>
                          <div>
                            <p className="text-xs font-mono text-muted-foreground mb-0.5">
                              Subject
                            </p>
                            <p className="text-xs font-mono text-foreground">
                              {draftPreview.subject}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs font-mono text-muted-foreground mb-0.5">
                              Body
                            </p>
                            <p className="text-xs font-mono text-foreground whitespace-pre-wrap leading-relaxed">
                              {draftPreview.body}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 pt-1">
                            <button
                              onClick={() => handleSend(draftPreview)}
                              disabled={sendingEmail || !form.to.trim()}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-green-900/40 border border-green-700/50 text-green-300 rounded hover:bg-green-900/60 disabled:opacity-50 transition-colors"
                            >
                              {sendingEmail ? (
                                <Loader2 size={10} className="animate-spin" />
                              ) : (
                                <Send size={10} />
                              )}
                              Send This
                            </button>
                            <button
                              onClick={() => {
                                setDraftPreview(null);
                                handleDraft();
                              }}
                              disabled={generatingDraft}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-muted/30 border border-border text-muted-foreground rounded hover:text-foreground disabled:opacity-50 transition-colors"
                            >
                              {generatingDraft ? (
                                <Loader2 size={10} className="animate-spin" />
                              ) : (
                                <RefreshCw size={10} />
                              )}
                              Re-generate
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </>
                )}
              </div>
            </HudCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Info Banner ──────────────────────────────────────── */}
      <div className="flex items-start gap-2 px-3 py-2.5 rounded border border-blue-800/40 bg-blue-950/20">
        <Info size={12} className="text-blue-400 shrink-0 mt-0.5" />
        <span className="text-xs font-mono text-blue-400/80 leading-relaxed">
          Powered by Resend. Set{" "}
          <code className="text-blue-300">RESEND_API_KEY</code> in Supabase
          secrets to enable sending.
        </span>
      </div>

      {/* ── Outbox ──────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-mono text-primary uppercase tracking-widest">
            Outbox
          </h2>
          <button
            onClick={loadOutbox}
            disabled={loading}
            className="flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {loading ? (
              <Loader2 size={10} className="animate-spin" />
            ) : (
              <RefreshCw size={10} />
            )}
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="animate-spin text-primary" size={20} />
          </div>
        ) : outbox.length === 0 ? (
          <HudCard className="text-center py-8">
            <Mail size={28} className="text-muted-foreground mx-auto mb-2" />
            <p className="text-xs font-mono text-muted-foreground">
              No emails sent yet.
            </p>
          </HudCard>
        ) : (
          <div className="space-y-1.5">
            {outbox.map((email, i) => {
              const statusStyle =
                STATUS_STYLES[email.status] ?? STATUS_STYLES.pending;
              const isExpanded = expandedId === email.id;

              return (
                <motion.div
                  key={email.id}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.025 }}
                >
                  <HudCard className="cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : email.id)}>
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-mono text-foreground truncate">
                            {email.to_address}
                          </span>
                          <span
                            className={`text-xs font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border ${statusStyle}`}
                          >
                            {email.status}
                          </span>
                        </div>
                        {email.subject && (
                          <p className="text-xs font-mono text-muted-foreground mt-0.5 truncate">
                            {email.subject}
                          </p>
                        )}
                        <p className="text-xs font-mono text-muted-foreground mt-0.5">
                          {fmtDateTime(email.created_at)}
                        </p>
                      </div>
                      <span className="text-muted-foreground shrink-0 mt-0.5">
                        {isExpanded ? (
                          <ChevronUp size={12} />
                        ) : (
                          <ChevronDown size={12} />
                        )}
                      </span>
                    </div>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          key="body"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.15 }}
                          className="overflow-hidden"
                        >
                          <div className="mt-3 pt-3 border-t border-border/40">
                            <p className="text-xs font-mono text-muted-foreground mb-1 uppercase tracking-widest">
                              Body
                            </p>
                            <p className="text-xs font-mono text-muted-foreground whitespace-pre-wrap leading-relaxed">
                              {email.body}
                            </p>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </HudCard>
                </motion.div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
