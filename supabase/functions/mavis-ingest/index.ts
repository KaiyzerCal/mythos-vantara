import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { Anthropic } from "https://esm.sh/@anthropic-ai/sdk@0.39.0";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface MavisAction {
  source: string;
  task_type: string;
  payload: Record<string, any>;
}

async function classifyIntent(payload: Record<string, any>): Promise<string> {
  const message = payload.message || JSON.stringify(payload);
  const response = await anthropic.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 100,
    system: "You are MAVIS intent classifier. Classify the intent in ONE WORD: create|decide|upgrade|lore|execute|unknown",
    messages: [{ role: "user", content: message }],
  });
  return (response.content[0] as any).text.toLowerCase().trim().split("\n")[0];
}

async function handleAction(action: MavisAction): Promise<Record<string, any>> {
  const intent = await classifyIntent(action.payload);

  if (intent === "create") {
    return { action: "approve_creation", type: action.task_type, reason: "Creation intent detected" };
  }
  if (intent === "decide") {
    return { action: "council_decision", type: action.task_type, reason: "Strategic decision required" };
  }
  if (intent === "upgrade") {
    return { action: "shard_upgrade", type: action.task_type, reason: "Narrative progression" };
  }
  return { action: "acknowledge", type: action.task_type, reason: "Task received and queued" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const action: MavisAction = await req.json();

    const { data: inserted, error: insertError } = await supabase
      .from("mavis_actions")
      .insert({ source: action.source, task_type: action.task_type, payload: action.payload, status: "processing" })
      .select()
      .single();

    if (insertError) throw insertError;

    const mavisResponse = await handleAction(action);

    const { data: updated, error: updateError } = await supabase
      .from("mavis_actions")
      .update({ status: "complete", mavis_response: mavisResponse, completed_at: new Date().toISOString() })
      .eq("id", inserted.id)
      .select()
      .single();

    if (updateError) throw updateError;

    return new Response(
      JSON.stringify({ success: true, action_id: inserted.id, mavis_response: mavisResponse }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("mavis-ingest error:", error);
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
