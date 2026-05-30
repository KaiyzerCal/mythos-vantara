// Nightly memory consolidation — Felix-equivalent pattern.
// Reads unconsolidated Layer 2 messages, extracts Layer 1 (knowledge) + Layer 3 (tacit),
// marks messages consolidated, and logs the run.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

async function callClaude(systemPrompt: string, userContent: string): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  const data = await response.json();
  return data?.content?.[0]?.text ?? "";
}

const EXTRACTION_PROMPT = `You are MAVIS's memory consolidation system. Analyze this conversation transcript and extract durable knowledge.

Respond with ONLY valid JSON in this exact structure:
{
  "knowledge": [
    {"category": "project|area|resource|archive", "title": "...", "content": "...", "tags": ["..."]}
  ],
  "tacit": [
    {"category": "preference|hard_rule|lesson_learned|workflow_habit|communication_style", "key": "...", "value": "...", "confidence": 1-10}
  ],
  "summary": "One paragraph summary of this session"
}

Rules:
- Only include entries with real, durable signal
- Skip routine exchanges and small talk
- knowledge.title must be unique and descriptive
- tacit.key must be concise (under 60 chars)
- If nothing useful to extract, return empty arrays`;

Deno.serve(async (req) => {
  // Allow both scheduled invocations and manual triggers
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // Find all users with unconsolidated messages
    const { data: rawUsers } = await supabase
      .from("mavis_memory")
      .select("user_id")
      .eq("consolidated", false)
      .limit(200);

    const uniqueUsers = [...new Set((rawUsers ?? []).map((u: any) => u.user_id))];
    const results: Record<string, unknown>[] = [];

    for (const userId of uniqueUsers) {
      try {
        const { data: messages } = await supabase
          .from("mavis_memory")
          .select("*")
          .eq("user_id", userId)
          .eq("consolidated", false)
          .order("timestamp", { ascending: true })
          .limit(100);

        if (!messages || messages.length < 3) continue;

        const transcript = messages
          .map((m: any) => `[${m.role.toUpperCase()}]: ${m.content}`)
          .join("\n\n");

        const rawResult = await callClaude(EXTRACTION_PROMPT, transcript);

        let parsed: {
          knowledge: Array<{ category: string; title: string; content: string; tags: string[] }>;
          tacit: Array<{ category: string; key: string; value: string; confidence: number }>;
          summary: string;
        };

        try {
          const clean = rawResult.replace(/```json|```/g, "").trim();
          parsed = JSON.parse(clean);
        } catch {
          console.error(`[Consolidation] JSON parse failed for user ${userId}`);
          continue;
        }

        // Write Layer 1 — knowledge graph
        for (const entry of parsed.knowledge ?? []) {
          await supabase.from("mavis_knowledge").upsert({
            user_id: userId,
            category: entry.category,
            title: entry.title,
            content: entry.content,
            tags: entry.tags ?? [],
            updated_at: new Date().toISOString(),
          }, { onConflict: "user_id,title" });
        }

        // Write Layer 3 — tacit knowledge
        for (const entry of parsed.tacit ?? []) {
          await supabase.from("mavis_tacit").upsert({
            user_id: userId,
            category: entry.category,
            key: entry.key,
            value: entry.value,
            confidence: entry.confidence ?? 5,
            source: "nightly_consolidation",
            updated_at: new Date().toISOString(),
          }, { onConflict: "user_id,key" });
        }

        // Mark messages as consolidated
        await supabase
          .from("mavis_memory")
          .update({ consolidated: true })
          .in("id", messages.map((m: any) => m.id));

        // Log the run
        await supabase.from("mavis_consolidation_log").insert({
          user_id: userId,
          session_date: new Date().toISOString().split("T")[0],
          messages_processed: messages.length,
          knowledge_entries_created: parsed.knowledge?.length ?? 0,
          tacit_entries_created: parsed.tacit?.length ?? 0,
          summary: parsed.summary,
        });

        results.push({
          userId,
          messagesProcessed: messages.length,
          knowledgeCreated: parsed.knowledge?.length ?? 0,
          tacitCreated: parsed.tacit?.length ?? 0,
        });
      } catch (err) {
        console.error(`[Consolidation] Failed for user ${userId}:`, err);
        results.push({ userId, error: String(err) });
      }
    }

    return new Response(JSON.stringify({
      status: "consolidation complete",
      usersProcessed: uniqueUsers.length,
      results,
    }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
