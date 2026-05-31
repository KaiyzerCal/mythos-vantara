// MAVIS Khanmigo — Socratic Tutoring Engine
// Khan Academy content + MAVIS LLM for Socratic dialogue.
// Never gives direct answers. Guides students to discover solutions themselves.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const KA_API_BASE = "https://www.khanacademy.org/api/v1";
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const OPENAI_KEY = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ─────────────────────────────────────────────────────────────
// Socratic system prompt — the core teaching philosophy
// ─────────────────────────────────────────────────────────────

const SOCRATIC_SYSTEM_PROMPT = `You are a Socratic tutor. Your role is to guide students to discover answers themselves through questions.
NEVER give direct answers. Instead:
1. Ask what they already know about the topic
2. Break the problem into smaller pieces
3. Ask guiding questions that lead to the next insight
4. Celebrate partial correct thinking
5. Only confirm correct answers, never reveal wrong ones directly`;

// ─────────────────────────────────────────────────────────────
// Khan Academy content fetcher
// ─────────────────────────────────────────────────────────────

async function kaFetch(path: string): Promise<unknown> {
  const res = await fetch(`${KA_API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`KA API ${res.status}: ${res.statusText}`);
  return res.json();
}

async function getTopic(topicId: string): Promise<unknown> {
  return kaFetch(`/topic/${topicId}`);
}

async function getExercise(topicId: string): Promise<unknown> {
  return kaFetch(`/exercises?limit=5&topic_id=${encodeURIComponent(topicId)}`);
}

// ─────────────────────────────────────────────────────────────
// LLM caller — Gemini primary, OpenAI fallback
// ─────────────────────────────────────────────────────────────

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

async function callGemini(systemPrompt: string, messages: Message[]): Promise<string> {
  const GEMINI_URL =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

  // Merge system prompt into first user message for Gemini
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: {
        maxOutputTokens: 512,
        temperature: 0.7,
      },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

async function callOpenAI(systemPrompt: string, messages: Message[]): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
      max_tokens: 512,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

async function callLLM(systemPrompt: string, messages: Message[]): Promise<string> {
  // Try Gemini first, fall back to OpenAI
  if (GEMINI_KEY) {
    try {
      return await callGemini(systemPrompt, messages);
    } catch (err) {
      console.warn("[mavis-khanmigo] Gemini failed, trying OpenAI:", err instanceof Error ? err.message : String(err));
    }
  }

  if (OPENAI_KEY) {
    return await callOpenAI(systemPrompt, messages);
  }

  throw new Error("No LLM provider configured. Set GEMINI_API_KEY or OPENAI_API_KEY.");
}

// ─────────────────────────────────────────────────────────────
// Session management
// ─────────────────────────────────────────────────────────────

interface TutoringSession {
  id: string;
  user_id: string;
  subject: string;
  topic_id: string | null;
  messages: Message[];
  current_problem: string | null;
  solved: boolean;
  hints_used: number;
  time_spent_seconds: number;
}

async function getOrCreateSession(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  subject: string,
  topicId?: string,
  sessionId?: string,
): Promise<TutoringSession> {
  // Try to resume existing session
  if (sessionId) {
    const { data } = await supabase
      .from("tutoring_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .single();
    if (data) return data as TutoringSession;
  }

  // Find active unsolved session for this subject
  const { data: existing } = await supabase
    .from("tutoring_sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("subject", subject)
    .eq("solved", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (existing) return existing as TutoringSession;

  // Create new session
  const { data: newSession, error } = await supabase
    .from("tutoring_sessions")
    .insert({
      user_id: userId,
      subject,
      topic_id: topicId ?? null,
      messages: [],
      current_problem: null,
      solved: false,
      hints_used: 0,
      time_spent_seconds: 0,
    })
    .select()
    .single();

  if (error || !newSession) throw new Error("Failed to create tutoring session");
  return newSession as TutoringSession;
}

async function updateSession(
  supabase: ReturnType<typeof createClient>,
  sessionId: string,
  updates: Partial<TutoringSession>,
): Promise<void> {
  await supabase
    .from("tutoring_sessions")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", sessionId);
}

// ─────────────────────────────────────────────────────────────
// Action handlers
// ─────────────────────────────────────────────────────────────

async function tutor(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  subject: string,
  question: string,
  studentWork: string,
  topicId?: string,
  sessionId?: string,
): Promise<unknown> {
  const session = await getOrCreateSession(supabase, userId, subject, topicId, sessionId);

  const SOCRATIC_PROMPT = `You are a Socratic tutor assistant in the MAVIS life-OS. Help the user learn through guided questions, never direct answers. Keep responses concise (2-3 sentences max). Topic: ${subject}`;

  // Build conversation history
  const messages: Message[] = [
    ...(session.messages as Message[]),
  ];

  // Add current student input
  const userMessage = studentWork
    ? `Question: ${question}\n\nWhat I've tried so far: ${studentWork}`
    : question;

  messages.push({ role: "user", content: userMessage });

  // Get Socratic response
  const response = await callLLM(
    `${SOCRATIC_SYSTEM_PROMPT}\n\n${SOCRATIC_PROMPT}`,
    messages,
  );

  // Append assistant response to history
  messages.push({ role: "assistant", content: response });

  // Update session
  await updateSession(supabase, session.id, {
    messages,
    current_problem: question,
    updated_at: new Date().toISOString(),
  } as Partial<TutoringSession> & { updated_at: string });

  return {
    session_id: session.id,
    response,
    hints_used: session.hints_used,
    message_count: messages.length,
  };
}

async function generateHint(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  subject: string,
  question: string,
  studentWork: string,
  sessionId?: string,
): Promise<unknown> {
  const session = await getOrCreateSession(supabase, userId, subject, undefined, sessionId);

  const hintPrompt = `The student is working on this problem: "${question}"

What they've tried: ${studentWork || "Nothing yet"}

Generate a single, targeted hint that nudges them in the right direction WITHOUT revealing the answer. The hint should be one sentence that asks a guiding question or points to a specific concept they should recall.`;

  const messages: Message[] = [{ role: "user", content: hintPrompt }];
  const hint = await callLLM(SOCRATIC_SYSTEM_PROMPT, messages);

  // Increment hints_used counter
  await updateSession(supabase, session.id, {
    hints_used: (session.hints_used ?? 0) + 1,
    updated_at: new Date().toISOString(),
  } as Partial<TutoringSession> & { updated_at: string });

  return {
    session_id: session.id,
    hint,
    hints_used: (session.hints_used ?? 0) + 1,
  };
}

async function explainSolution(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  subject: string,
  question: string,
  studentWork: string,
  sessionId?: string,
): Promise<unknown> {
  const session = await getOrCreateSession(supabase, userId, subject, undefined, sessionId);

  const explainPrompt = `The student has successfully solved this problem: "${question}"

Their solution: ${studentWork}

Now provide a clear, encouraging post-solution explanation that:
1. Confirms what they got right
2. Explains the underlying concept in depth
3. Connects it to related topics they might explore next
4. Keep it under 4 sentences.`;

  const messages: Message[] = [{ role: "user", content: explainPrompt }];
  const explanation = await callLLM(
    "You are an encouraging tutor providing post-solution reinforcement. Be clear, specific, and motivating.",
    messages,
  );

  // Mark session as solved
  await updateSession(supabase, session.id, {
    solved: true,
    updated_at: new Date().toISOString(),
  } as Partial<TutoringSession> & { updated_at: string });

  return {
    session_id: session.id,
    explanation,
    solved: true,
  };
}

// ─────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      action,
      subject,
      topic_id,
      question,
      student_work,
      user_id,
      session_id,
    }: {
      action: string;
      subject?: string;
      topic_id?: string;
      question?: string;
      student_work?: string;
      user_id: string;
      session_id?: string;
    } = body;

    if (!action || !user_id) {
      return new Response(
        JSON.stringify({ error: "action and user_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    let result: unknown;

    switch (action) {
      case "get_topic": {
        if (!topic_id) {
          return new Response(
            JSON.stringify({ error: "topic_id required for get_topic" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        result = await getTopic(topic_id);
        break;
      }

      case "get_exercise": {
        if (!topic_id) {
          return new Response(
            JSON.stringify({ error: "topic_id required for get_exercise" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        result = await getExercise(topic_id);
        break;
      }

      case "tutor": {
        if (!subject || !question) {
          return new Response(
            JSON.stringify({ error: "subject and question required for tutor" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        result = await tutor(
          supabase,
          user_id,
          subject,
          question,
          student_work ?? "",
          topic_id,
          session_id,
        );
        break;
      }

      case "hint": {
        if (!subject || !question) {
          return new Response(
            JSON.stringify({ error: "subject and question required for hint" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        result = await generateHint(
          supabase,
          user_id,
          subject,
          question,
          student_work ?? "",
          session_id,
        );
        break;
      }

      case "explain": {
        if (!subject || !question) {
          return new Response(
            JSON.stringify({ error: "subject and question required for explain" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        result = await explainSolution(
          supabase,
          user_id,
          subject,
          question,
          student_work ?? "",
          session_id,
        );
        break;
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }

    return new Response(
      JSON.stringify({ status: "ok", action, data: result }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-khanmigo]", message);

    // Surface LLM provider configuration error clearly
    if (message.includes("No LLM provider configured")) {
      return new Response(
        JSON.stringify({
          error: "No LLM provider configured",
          message: "Set GEMINI_API_KEY or OPENAI_API_KEY to enable Socratic tutoring.",
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
