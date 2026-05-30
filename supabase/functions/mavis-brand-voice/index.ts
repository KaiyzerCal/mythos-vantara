import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await anonClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { action, samples, content, platform = "general" } = body;
    const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

    if (action === "train") {
      if (!samples || !Array.isArray(samples) || samples.length === 0) {
        return new Response(JSON.stringify({ error: "samples array required for train" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const combined = samples.join("\n---\n");

      const profileRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1024,
          system: "You are a writing style analyst. Return ONLY valid JSON, no markdown fences.",
          messages: [{
            role: "user",
            content: `Analyze these writing samples and return ONLY valid JSON with this exact shape:
{
  "tone": "string (e.g. confident, casual, authoritative)",
  "vocabulary_level": "string (e.g. simple, technical, academic)",
  "avg_sentence_length": "string (e.g. short, medium, long, mixed)",
  "punctuation_style": "string (e.g. minimal, heavy em-dashes, ellipsis-heavy)",
  "humor_level": "string (e.g. none, subtle, frequent)",
  "formality": "string (e.g. very casual, semi-formal, professional)",
  "common_phrases": ["array of recurring phrases or words"],
  "structural_patterns": ["array of structural habits"],
  "platform_notes": "string — any platform-specific observations",
  "summary": "2-3 sentence summary of voice"
}

SAMPLES:
${combined}`,
          }],
        }),
      });

      const profileData = await profileRes.json();
      const raw = profileData.content?.[0]?.text ?? "{}";
      let profile: Record<string, unknown> = {};
      try { profile = JSON.parse(raw); } catch { profile = { summary: raw }; }

      const noteContent = `${profile.summary ?? "Brand voice profile"}\n\n${JSON.stringify(profile, null, 2)}`;

      const { data: note, error: noteErr } = await supabase
        .from("mavis_notes")
        .upsert({
          user_id: user.id,
          title: "[BrandVoice] Profile",
          content: noteContent,
          tags: ["brand-voice", "style-profile"],
          properties: { voice_profile: profile, sample_count: samples.length, trained_at: new Date().toISOString() },
        }, { onConflict: "user_id,title" })
        .select("id")
        .single();

      return new Response(JSON.stringify({ profile, note_id: note?.id ?? null, error: noteErr?.message ?? null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "apply") {
      if (!content) {
        return new Response(JSON.stringify({ error: "content required for apply" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: notes } = await supabase
        .from("mavis_notes")
        .select("properties")
        .eq("user_id", user.id)
        .contains("tags", ["brand-voice"])
        .order("created_at", { ascending: false })
        .limit(1);

      if (!notes || notes.length === 0 || !(notes[0].properties as any)?.voice_profile) {
        return new Response(JSON.stringify({ error: "No brand voice profile found. Train first." }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const voiceProfile = (notes[0].properties as any).voice_profile;

      const rewriteRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1024,
          system: `You are a ghostwriter. Rewrite content to match this exact voice profile: ${JSON.stringify(voiceProfile)}. Preserve the meaning, transform the style.`,
          messages: [{
            role: "user",
            content: `Rewrite the following for ${platform}:\n\n${content}`,
          }],
        }),
      });

      const rewriteData = await rewriteRes.json();
      const rewritten = rewriteData.content?.[0]?.text ?? content;

      return new Response(JSON.stringify({ rewritten, voice_profile: voiceProfile }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "action must be 'train' or 'apply'" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
