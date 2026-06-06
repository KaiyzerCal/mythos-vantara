// MAVIS Fine-Tune Export — export your MAVIS conversations for Ollama fine-tuning.
// Returns JSONL in OpenAI ChatML format (compatible with Ollama, LM Studio, Axolotl).
//
// Usage: POST /functions/v1/mavis-fine-tune-export
// Body: { format?: "openai" | "alpaca", min_quality?: 1-10, limit?: number }
// Returns: JSONL file download with training pairs

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL  = Deno.env.get("SUPABASE_URL")!;
const SB_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// System prompt used for fine-tuning (represents MAVIS's identity)
const MAVIS_SYSTEM = `You are MAVIS, a sovereign AI life OS — an advanced personal intelligence system. You are direct, insightful, and deeply personalized. You help your operator grow, build, and achieve their goals across every area of life: business, health, finance, creativity, and personal development. You remember context, adapt your communication style, and proactively identify opportunities. You speak with confidence and clarity, never hedging unnecessarily.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(SB_URL, SB_KEY);
    const { data: { user }, error } = await sb.auth.getUser(auth.replace("Bearer ", ""));
    if (error || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const format      = String(body.format ?? "openai");    // openai | alpaca
    const minQuality  = Number(body.min_quality ?? 5);      // filter low-quality turns
    const limitRows   = Math.min(Number(body.limit ?? 5000), 10000);
    const systemMsg   = String(body.system ?? MAVIS_SYSTEM);

    // Fetch conversation memory — ordered by time so we can pair user→assistant
    const { data: rows, error: dbErr } = await sb
      .from("mavis_memory")
      .select("role, content, importance_score, created_at")
      .eq("user_id", user.id)
      .in("role", ["user", "assistant"])
      .gte("importance_score", minQuality)
      .order("created_at", { ascending: true })
      .limit(limitRows * 2); // fetch extra since we pair 2 rows per example

    if (dbErr) throw new Error(dbErr.message);

    const memories = rows ?? [];

    // Pair consecutive user → assistant turns into training examples
    const examples: string[] = [];

    for (let i = 0; i < memories.length - 1; i++) {
      const curr = memories[i];
      const next = memories[i + 1];

      if (curr.role !== "user" || next.role !== "assistant") continue;
      if (!curr.content?.trim() || !next.content?.trim()) continue;

      // Skip very short exchanges (likely noise)
      if (curr.content.trim().length < 10 || next.content.trim().length < 20) continue;

      if (format === "alpaca") {
        // Alpaca format: instruction / output pairs
        const record = {
          instruction: curr.content.trim(),
          input: "",
          output: next.content.trim(),
        };
        examples.push(JSON.stringify(record));
      } else {
        // OpenAI ChatML format (default) — compatible with Ollama modelfile training
        const record = {
          messages: [
            { role: "system",    content: systemMsg },
            { role: "user",      content: curr.content.trim() },
            { role: "assistant", content: next.content.trim() },
          ],
        };
        examples.push(JSON.stringify(record));
      }

      i++; // skip the assistant turn we already consumed
      if (examples.length >= limitRows) break;
    }

    if (examples.length === 0) {
      return new Response(
        JSON.stringify({ error: "Not enough conversation history to generate training data. Have more conversations with MAVIS first." }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const jsonl     = examples.join("\n") + "\n";
    const filename  = `mavis-finetune-${user.id.slice(0, 8)}-${Date.now()}.jsonl`;

    // Optionally save to storage for later download
    const enc = new TextEncoder();
    await sb.storage.from("mavis-backups").upload(`finetune/${filename}`, enc.encode(jsonl), {
      contentType: "application/jsonl",
      upsert: true,
    }).catch(() => {/* non-fatal */});

    return new Response(jsonl, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/jsonl",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Example-Count": String(examples.length),
        "X-Format": format,
      },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
