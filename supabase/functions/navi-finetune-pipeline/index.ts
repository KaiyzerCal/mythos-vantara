// NAVI Fine-Tune Pipeline
// Collects a NAVI's conversation history, formats it as OpenAI fine-tuning JSONL,
// uploads to the Files API, and submits a gpt-4o-mini fine-tune job.
// The persona's finetune_status is set to "training" and the job ID persisted so
// navi-finetune-check can poll for completion and swap in the new model.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MIN_EXAMPLES = 50;   // refuse if fewer training pairs than this
const MAX_EXAMPLES = 1000; // cap to keep fine-tune cost predictable

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const { persona_id, user_id } = await req.json();
    if (!persona_id || !user_id) {
      return new Response(JSON.stringify({ error: "persona_id and user_id are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const openaiKey = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
    if (!openaiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load persona
    const { data: persona, error: personaErr } = await supabase
      .from("personas")
      .select("id, name, system_prompt, model, finetune_status")
      .eq("id", persona_id)
      .eq("user_id", user_id)
      .single();

    if (personaErr || !persona) {
      return new Response(JSON.stringify({ error: "Persona not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (persona.finetune_status === "training") {
      return new Response(JSON.stringify({ error: "Fine-tune job already in progress" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load full conversation history for this persona
    const { data: convos } = await supabase
      .from("persona_conversations")
      .select("role, content, created_at")
      .eq("persona_id", persona_id)
      .eq("user_id", user_id)
      .order("created_at", { ascending: true })
      .limit(MAX_EXAMPLES + 50); // slight over-fetch to allow filtering

    if (!convos || convos.length < 2) {
      return new Response(JSON.stringify({ error: "insufficient_data", count: convos?.length ?? 0 }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build training pairs: sliding window over consecutive user→assistant turns.
    // Skips pairs where the assistant response is too short (likely an error) or
    // where we exceed MAX_EXAMPLES.
    const trainingExamples: { messages: { role: string; content: string }[] }[] = [];

    for (let i = 0; i < convos.length - 1 && trainingExamples.length < MAX_EXAMPLES; i++) {
      const curr = convos[i];
      const next = convos[i + 1];

      if (curr.role !== "user" || next.role !== "assistant") continue;
      if (next.content.length < 30) continue; // skip near-empty or error responses

      trainingExamples.push({
        messages: [
          { role: "system",    content: persona.system_prompt },
          { role: "user",      content: curr.content },
          { role: "assistant", content: next.content },
        ],
      });
    }

    if (trainingExamples.length < MIN_EXAMPLES) {
      return new Response(
        JSON.stringify({ error: "insufficient_examples", count: trainingExamples.length, required: MIN_EXAMPLES }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Encode as JSONL
    const jsonl = trainingExamples.map((ex) => JSON.stringify(ex)).join("\n");
    const encoder = new TextEncoder();
    const bytes = encoder.encode(jsonl);

    // Upload file to OpenAI Files API (multipart form)
    const formData = new FormData();
    formData.append("purpose", "fine-tune");
    formData.append(
      "file",
      new Blob([bytes], { type: "application/jsonl" }),
      `navi-${persona.name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}.jsonl`,
    );

    const uploadRes = await fetch("https://api.openai.com/v1/files", {
      method: "POST",
      headers: { "Authorization": `Bearer ${openaiKey}` },
      body: formData,
    });

    if (!uploadRes.ok) {
      const txt = await uploadRes.text();
      console.error("OpenAI file upload failed:", uploadRes.status, txt);
      return new Response(JSON.stringify({ error: "file_upload_failed", detail: txt.slice(0, 300) }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const uploadData = await uploadRes.json();
    const fileId: string = uploadData.id;

    // Submit fine-tune job
    const suffix = persona.name.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 18);
    const ftRes = await fetch("https://api.openai.com/v1/fine_tuning/jobs", {
      method: "POST",
      headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        training_file: fileId,
        model: "gpt-4o-mini-2024-07-18",
        suffix,
      }),
    });

    if (!ftRes.ok) {
      const txt = await ftRes.text();
      console.error("OpenAI fine-tune submission failed:", ftRes.status, txt);
      return new Response(JSON.stringify({ error: "finetune_submission_failed", detail: txt.slice(0, 300) }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ftData = await ftRes.json();
    const jobId: string = ftData.id;

    // Persist job ID and set status → training
    await supabase
      .from("personas")
      .update({
        finetune_job_id: jobId,
        finetune_status: "training",
        finetune_examples: trainingExamples.length,
        updated_at: new Date().toISOString(),
      })
      .eq("id", persona_id);

    console.log(`[navi-finetune-pipeline] ${persona.name}: job ${jobId} submitted with ${trainingExamples.length} examples`);

    return new Response(
      JSON.stringify({
        success: true,
        job_id: jobId,
        examples: trainingExamples.length,
        status: "training",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("navi-finetune-pipeline error:", err?.message ?? err);
    return new Response(JSON.stringify({ error: err?.message ?? "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
