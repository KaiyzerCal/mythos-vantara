// NAVI Fine-Tune Check
// Polls all personas whose finetune_status is "training", checks the OpenAI
// fine-tuning job status, and updates personas.model + finetune_status when
// a job succeeds or fails. Designed to be called by a Supabase cron job every
// 30 minutes, but can also be invoked manually from the UI.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const openaiKey = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
    if (!openaiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Allow checking a single persona (from UI) or all training personas (from cron)
    let personaId: string | null = null;
    try {
      const body = await req.json().catch(() => ({}));
      personaId = body?.persona_id ?? null;
    } catch { /* no body — cron mode */ }

    // Load personas that are currently training
    const query = supabase
      .from("personas")
      .select("id, name, finetune_job_id, finetune_status")
      .eq("finetune_status", "training")
      .not("finetune_job_id", "is", null);

    if (personaId) query.eq("id", personaId);

    const { data: trainingPersonas } = await query;

    if (!trainingPersonas?.length) {
      return new Response(
        JSON.stringify({ checked: 0, message: "No personas currently training" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const results: { id: string; name: string; status: string; model?: string }[] = [];

    for (const persona of trainingPersonas) {
      try {
        const jobRes = await fetch(
          `https://api.openai.com/v1/fine_tuning/jobs/${persona.finetune_job_id}`,
          { headers: { "Authorization": `Bearer ${openaiKey}` } },
        );

        if (!jobRes.ok) {
          console.warn(`[navi-finetune-check] ${persona.name}: job fetch returned ${jobRes.status}`);
          results.push({ id: persona.id, name: persona.name, status: "check_failed" });
          continue;
        }

        const job = await jobRes.json();
        const jobStatus: string = job.status; // "validating_files" | "queued" | "running" | "succeeded" | "failed" | "cancelled"

        if (jobStatus === "succeeded") {
          const fineTunedModel: string = job.fine_tuned_model;

          await supabase
            .from("personas")
            .update({
              finetune_status: "deployed",
              finetune_model: fineTunedModel,
              last_finetuned_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", persona.id);

          console.log(`[navi-finetune-check] ${persona.name}: deployed → ${fineTunedModel}`);
          results.push({ id: persona.id, name: persona.name, status: "deployed", model: fineTunedModel });

        } else if (jobStatus === "failed" || jobStatus === "cancelled") {
          const errorMsg = job.error?.message ?? jobStatus;

          await supabase
            .from("personas")
            .update({
              finetune_status: "failed",
              updated_at: new Date().toISOString(),
            })
            .eq("id", persona.id);

          console.error(`[navi-finetune-check] ${persona.name}: job ${jobStatus} — ${errorMsg}`);
          results.push({ id: persona.id, name: persona.name, status: jobStatus });

        } else {
          // Still running: validating_files | queued | running
          results.push({ id: persona.id, name: persona.name, status: jobStatus });
        }
      } catch (err: any) {
        console.error(`[navi-finetune-check] ${persona.name} error:`, err?.message);
        results.push({ id: persona.id, name: persona.name, status: "error" });
      }
    }

    return new Response(
      JSON.stringify({ checked: results.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("navi-finetune-check error:", err?.message ?? err);
    return new Response(JSON.stringify({ error: err?.message ?? "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
