// mavis-flashcard-agent
// AI-powered language learning via MCQ flashcards.
// Vocabulary sourced from Google Sheets, inline array, or stored lists.
// Session state lives in mavis_memory. MCQ generation is pure logic (no LLM);
// Claude is used only for encouraging/corrective feedback messages.
//
// Actions: start_session | evaluate | get_current | get_stats
//          end_session | list_sessions | save_vocabulary | get_vocabulary

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL        = Deno.env.get("SUPABASE_URL")!;
const SB_SRK        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

// ── Types ──────────────────────────────────────────────────────

interface VocabItem {
  native:  string;  // e.g. English word/phrase
  target:  string;  // e.g. Chinese characters
  pinyin?: string;  // romanization (optional)
  notes?:  string;  // extra context
}

type Letter = "A" | "B" | "C" | "D";

interface CurrentQuestion {
  prompt:      string;
  word_native: string;
  word_target: string;
  pinyin?:     string;
  options:     Record<Letter, string>;
  correct:     Letter;
  asked_at:    string;
}

interface FlashcardSession {
  session_id:   string;
  language:     string;
  deck_name:    string;
  vocabulary:   VocabItem[];
  current_q:    CurrentQuestion | null;
  history:      string[];  // word_native values already asked this session
  stats:        { correct: number; wrong: number; streak: number; total: number };
  started_at:   string;
}

// ── Helpers ────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick<T>(arr: T[], exclude?: T): T {
  const pool = exclude !== undefined ? arr.filter(x => x !== exclude) : arr;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Build a new MCQ from the vocabulary list */
function generateQuestion(vocab: VocabItem[], recent: string[]): CurrentQuestion {
  // Prefer words not recently asked; fall back to full list
  const pool    = vocab.filter(v => !recent.slice(-5).includes(v.native));
  const chosen  = pick(pool.length ? pool : vocab);

  // Pick 3 wrong answers (targets only, different from correct)
  const wrongs = shuffle(vocab.filter(v => v.target !== chosen.target))
    .slice(0, 3)
    .map(v => v.target);

  const allOptions = shuffle([chosen.target, ...wrongs]);
  const letters: Letter[] = ["A", "B", "C", "D"];
  const options = {} as Record<Letter, string>;
  letters.forEach((l, i) => { options[l] = allOptions[i]; });

  const correct = letters.find(l => options[l] === chosen.target)!;

  return {
    prompt:      `What is the correct translation for "${chosen.native}"?`,
    word_native: chosen.native,
    word_target: chosen.target,
    pinyin:      chosen.pinyin,
    options,
    correct,
    asked_at:    new Date().toISOString(),
  };
}

/** Format question as readable text */
function formatQuestion(q: CurrentQuestion): string {
  return [
    q.prompt,
    `A) ${q.options.A}`,
    `B) ${q.options.B}`,
    `C) ${q.options.C}`,
    `D) ${q.options.D}`,
    "",
    "Reply with A, B, C, or D.",
  ].join("\n");
}

/** Load session from mavis_memory */
async function loadSession(sb: ReturnType<typeof createClient>, uid: string): Promise<FlashcardSession | null> {
  const { data } = await sb
    .from("mavis_memory")
    .select("content")
    .eq("user_id", uid)
    .contains("tags", ["flashcard_session_active"])
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!data?.content) return null;
  try {
    const parsed = JSON.parse(data.content);
    if (parsed.session_id) return parsed as FlashcardSession;
  } catch { /* corrupt */ }
  return null;
}

/** Persist session to mavis_memory */
async function saveSession(sb: ReturnType<typeof createClient>, uid: string, session: FlashcardSession) {
  // Upsert by deleting old and inserting fresh (memory doesn't have a unique session key)
  await sb.from("mavis_memory")
    .delete()
    .eq("user_id", uid)
    .contains("tags", ["flashcard_session_active"]);

  await sb.from("mavis_memory").insert({
    user_id:          uid,
    role:             "system",
    content:          JSON.stringify(session),
    importance_score: 3,
    tags:             ["flashcard_session_active", session.session_id, session.deck_name],
  });
}

/** Clear active session */
async function clearSession(sb: ReturnType<typeof createClient>, uid: string) {
  await sb.from("mavis_memory")
    .delete()
    .eq("user_id", uid)
    .contains("tags", ["flashcard_session_active"]);
}

/** Optional Claude-generated feedback for variety */
async function claudeFeedback(correct: boolean, word: VocabItem, chosen?: string): Promise<string> {
  if (!ANTHROPIC_KEY) {
    if (correct) return `✅ Correct! **${word.target}**${word.pinyin ? ` (${word.pinyin})` : ""} means **${word.native}**.`;
    return `❌ Not quite! The correct answer was **${word.target}**${word.pinyin ? ` (${word.pinyin})` : ""} — meaning **${word.native}**.`;
  }

  const prompt = correct
    ? `The user correctly identified "${word.target}"${word.pinyin ? ` (${word.pinyin})` : ""} as "${word.native}". Give a short, enthusiastic 1-sentence congratulation that mentions the word. End with ✅.`
    : `The user chose "${chosen ?? "the wrong answer"}" but the correct answer was "${word.target}"${word.pinyin ? ` (${word.pinyin})` : ""} meaning "${word.native}". Give a brief, encouraging 1-sentence correction. End with ❌.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001", max_tokens: 150,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(8000),
  });
  const data = await res.json();
  return data.content?.[0]?.text ?? (correct
    ? `✅ Great job! **${word.target}** means **${word.native}**.`
    : `❌ The correct answer was **${word.target}** (${word.native}).`);
}

/** Fetch vocabulary from Google Sheets via mavis-sheets-agent */
async function fetchVocabFromSheets(
  uid: string,
  spreadsheetId: string,
  sheetName: string,
  nativeCol: string,
  targetCol: string,
  pinyinCol: string,
): Promise<VocabItem[]> {
  const res = await fetch(`${SB_URL}/functions/v1/mavis-sheets-agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SB_SRK}` },
    body: JSON.stringify({
      userId:         uid,
      action:         "get_range",
      spreadsheet_id: spreadsheetId,
      range:          `${sheetName}!A1:Z`,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  const values: string[][] = (data as any).values ?? [];
  if (values.length < 2) return [];

  const headers = values[0];
  const nIdx  = headers.findIndex(h => h.toLowerCase() === nativeCol.toLowerCase());
  const tIdx  = headers.findIndex(h => h.toLowerCase() === targetCol.toLowerCase());
  const pIdx  = pinyinCol ? headers.findIndex(h => h.toLowerCase() === pinyinCol.toLowerCase()) : -1;

  if (nIdx === -1 || tIdx === -1) throw new Error(`Columns "${nativeCol}" or "${targetCol}" not found in sheet. Available: ${headers.join(", ")}`);

  return values.slice(1)
    .filter(row => row[nIdx]?.trim() && row[tIdx]?.trim())
    .map(row => ({
      native: row[nIdx].trim(),
      target: row[tIdx].trim(),
      pinyin: pIdx >= 0 ? row[pIdx]?.trim() : undefined,
    }));
}

// ── Main ───────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (d: unknown, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    let uid: string | null = null;

    const sb = createClient(SB_URL, SB_SRK, { auth: { persistSession: false } });

    if (authHeader === `Bearer ${SB_SRK}`) {
      const body = await req.json().catch(() => ({}));
      uid = String(body.userId ?? body.user_id ?? "");
      if (!uid) return json({ error: "userId required for service-role calls" }, 400);
      (req as any)._body = body;
    } else if (authHeader.startsWith("Bearer eyJ")) {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
      const uc = createClient(SB_URL, anonKey, { global: { headers: { Authorization: authHeader } } });
      const { data: ud } = await uc.auth.getUser();
      if (!ud?.user?.id) return json({ error: "Unauthorized" }, 401);
      uid = ud.user.id;
    } else {
      return json({ error: "Unauthorized" }, 401);
    }

    const body   = (req as any)._body ?? await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    switch (action) {

      case "start_session": {
        // Load vocabulary + create session + return first question
        let vocab: VocabItem[] = [];

        if (Array.isArray(body.vocabulary)) {
          // Inline vocabulary array
          vocab = (body.vocabulary as any[]).map(v => ({
            native: String(v.native ?? v.english ?? v.word ?? ""),
            target: String(v.target ?? v.chinese ?? v.translation ?? ""),
            pinyin: v.pinyin ? String(v.pinyin) : undefined,
            notes:  v.notes ? String(v.notes) : undefined,
          })).filter(v => v.native && v.target);
        } else if (body.spreadsheet_id) {
          // Load from Google Sheets
          vocab = await fetchVocabFromSheets(
            uid,
            String(body.spreadsheet_id),
            String(body.sheet_name ?? "Sheet1"),
            String(body.native_column ?? body.native_col ?? "English"),
            String(body.target_column ?? body.target_col ?? "Chinese"),
            String(body.pinyin_column ?? body.pinyin_col ?? "Pinyin"),
          );
        } else if (body.deck_name) {
          // Load previously saved vocabulary by deck name
          const { data: stored } = await sb
            .from("mavis_memory")
            .select("content")
            .eq("user_id", uid)
            .contains("tags", ["flashcard_vocabulary", String(body.deck_name)])
            .single();
          if (stored?.content) {
            try { vocab = JSON.parse(stored.content) as VocabItem[]; } catch { /* ignore */ }
          }
        }

        if (vocab.length < 4) {
          return json({ error: `Need at least 4 vocabulary items to generate MCQs. Got ${vocab.length}. Provide vocabulary[], spreadsheet_id, or deck_name.` }, 400);
        }

        const sessionId = crypto.randomUUID();
        const q = generateQuestion(vocab, []);

        const session: FlashcardSession = {
          session_id: sessionId,
          language:   String(body.language ?? "Chinese"),
          deck_name:  String(body.deck_name ?? body.spreadsheet_id ?? "custom"),
          vocabulary: vocab,
          current_q:  q,
          history:    [q.word_native],
          stats:      { correct: 0, wrong: 0, streak: 0, total: 0 },
          started_at: new Date().toISOString(),
        };

        await saveSession(sb, uid, session);

        return json({
          session_id:    sessionId,
          deck_name:     session.deck_name,
          vocab_count:   vocab.length,
          question:      formatQuestion(q),
          question_data: q,
          message:       `Session started! ${vocab.length} words loaded. Here's your first question:`,
        });
      }

      case "evaluate": {
        const session = await loadSession(sb, uid);
        if (!session) return json({ error: "No active session. Call start_session first." }, 400);
        if (!session.current_q) return json({ error: "No current question. Something went wrong." }, 500);

        const q         = session.current_q;
        const userInput = String(body.answer ?? body.choice ?? "").trim().toUpperCase().replace(/[^A-D]/g, "") as Letter;

        if (!userInput || !["A", "B", "C", "D"].includes(userInput)) {
          return json({
            message:  "Please reply with **A**, **B**, **C**, or **D**.",
            question: formatQuestion(q),
          });
        }

        const isCorrect  = userInput === q.correct;
        const chosenText = q.options[userInput];

        // Get feedback
        const wordInfo: VocabItem = {
          native: q.word_native,
          target: q.word_target,
          pinyin: q.pinyin,
        };
        const feedback = await claudeFeedback(isCorrect, wordInfo, isCorrect ? undefined : chosenText);

        // Update stats
        session.stats.total++;
        if (isCorrect) {
          session.stats.correct++;
          session.stats.streak++;
        } else {
          session.stats.wrong++;
          session.stats.streak = 0;
        }

        // Generate next question
        const nextQ = generateQuestion(session.vocabulary, session.history);
        session.history.push(nextQ.word_native);
        if (session.history.length > 20) session.history = session.history.slice(-20);
        session.current_q = nextQ;

        await saveSession(sb, uid, session);

        const accuracyPct = session.stats.total > 0
          ? Math.round((session.stats.correct / session.stats.total) * 100)
          : 0;

        return json({
          correct:       isCorrect,
          correct_answer: q.correct,
          correct_text:   q.word_target,
          pinyin:         q.pinyin,
          feedback,
          stats: { ...session.stats, accuracy_pct: accuracyPct },
          next_question:  formatQuestion(nextQ),
          next_question_data: nextQ,
          full_message:   `${feedback}\n\n📊 Score: ${session.stats.correct}/${session.stats.total} (${accuracyPct}%)${session.stats.streak > 2 ? ` 🔥 ${session.stats.streak} streak!` : ""}\n\n${formatQuestion(nextQ)}`,
        });
      }

      case "get_current": {
        const session = await loadSession(sb, uid);
        if (!session?.current_q) return json({ error: "No active session or no current question." }, 400);
        return json({
          question:      formatQuestion(session.current_q),
          question_data: session.current_q,
          stats:         session.stats,
        });
      }

      case "get_stats": {
        const session = await loadSession(sb, uid);
        if (!session) return json({ error: "No active session." }, 400);
        const pct = session.stats.total > 0
          ? Math.round((session.stats.correct / session.stats.total) * 100)
          : 0;
        return json({
          session_id:   session.session_id,
          deck_name:    session.deck_name,
          vocab_count:  session.vocabulary.length,
          ...session.stats,
          accuracy_pct: pct,
          started_at:   session.started_at,
        });
      }

      case "end_session": {
        const session = await loadSession(sb, uid);
        if (!session) return json({ message: "No active session to end." });

        await clearSession(sb, uid);

        const pct = session.stats.total > 0
          ? Math.round((session.stats.correct / session.stats.total) * 100)
          : 0;

        // Store completed session summary in memory (higher importance than active session)
        await sb.from("mavis_memory").insert({
          user_id:          uid,
          role:             "assistant",
          content:          `[FLASHCARD SESSION COMPLETE] Deck: ${session.deck_name} | ${session.stats.correct}/${session.stats.total} correct (${pct}%) | Best streak: ${session.stats.streak}`,
          importance_score: 5,
          tags:             ["flashcard_history", session.deck_name, "language_learning"],
        });

        return json({
          message:      `Session complete! 🎉\n📚 Deck: ${session.deck_name}\n✅ ${session.stats.correct} correct\n❌ ${session.stats.wrong} wrong\n📊 Accuracy: ${pct}%\n🔥 Best streak: ${session.stats.streak}`,
          stats:        { ...session.stats, accuracy_pct: pct },
          deck_name:    session.deck_name,
          vocab_count:  session.vocabulary.length,
        });
      }

      case "save_vocabulary": {
        // Persist a vocabulary list as a named deck so future sessions can load it by deck_name
        const deckName = String(body.deck_name ?? "");
        if (!deckName) return json({ error: "deck_name required" }, 400);

        let vocab: VocabItem[] = [];
        if (Array.isArray(body.vocabulary)) {
          vocab = (body.vocabulary as any[]).map(v => ({
            native: String(v.native ?? v.english ?? ""),
            target: String(v.target ?? v.chinese ?? ""),
            pinyin: v.pinyin ? String(v.pinyin) : undefined,
          })).filter(v => v.native && v.target);
        } else if (body.spreadsheet_id) {
          vocab = await fetchVocabFromSheets(
            uid, String(body.spreadsheet_id),
            String(body.sheet_name ?? "Sheet1"),
            String(body.native_column ?? "English"),
            String(body.target_column ?? "Chinese"),
            String(body.pinyin_column ?? "Pinyin"),
          );
        }

        if (!vocab.length) return json({ error: "No vocabulary items to save" }, 400);

        await sb.from("mavis_memory")
          .delete()
          .eq("user_id", uid)
          .contains("tags", ["flashcard_vocabulary", deckName]);

        await sb.from("mavis_memory").insert({
          user_id:          uid,
          role:             "system",
          content:          JSON.stringify(vocab),
          importance_score: 4,
          tags:             ["flashcard_vocabulary", deckName, "language_learning"],
        });

        return json({ saved: true, deck_name: deckName, word_count: vocab.length });
      }

      case "get_vocabulary": {
        const deckName = String(body.deck_name ?? "");
        if (!deckName) return json({ error: "deck_name required" }, 400);

        const { data } = await sb
          .from("mavis_memory")
          .select("content")
          .eq("user_id", uid)
          .contains("tags", ["flashcard_vocabulary", deckName])
          .single();

        if (!data?.content) return json({ error: `Deck "${deckName}" not found.` }, 404);
        try {
          const vocab = JSON.parse(data.content) as VocabItem[];
          return json({ deck_name: deckName, word_count: vocab.length, vocabulary: vocab });
        } catch {
          return json({ error: "Deck data corrupt" }, 500);
        }
      }

      default:
        return json({
          error: `Unknown action: ${action}. Use: start_session | evaluate | get_current | get_stats | end_session | save_vocabulary | get_vocabulary`,
        }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-flashcard-agent]", message);
    return json({ error: message }, 500);
  }
});
