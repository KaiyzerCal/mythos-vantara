import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-widget-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const OPENAI_KEY = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ── In-memory rate limiting per widget_id ────────────────────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 30; // requests per minute per widget

function checkRateLimit(widgetId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(widgetId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(widgetId, { count: 1, resetAt: now + 60000 });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// ── Load widget config from DB ────────────────────────────────────────────────
async function getWidgetConfig(widgetId: string): Promise<any> {
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data } = await sb
    .from("widget_instances")
    .select("config, business_context, widget_type, status")
    .eq("id", widgetId)
    .single();
  if (!data || data.status !== "active") throw new Error("Widget not found or inactive");
  return data;
}

// ── Gemini 2.5 Flash helper ──────────────────────────────────────────────────
async function callGemini(
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens = 512,
): Promise<string> {
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: maxTokens },
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini error: ${res.status}`);
  const data = await res.json();
  return (
    data.candidates?.[0]?.content?.parts?.[0]?.text ??
    "I apologize, I'm having trouble responding right now."
  );
}

// ── Main handler ─────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const {
      widget_id: widgetId,
      action,
      message,
      history,
      form_data,
      quote_inputs,
      roi_inputs,
      query,
    } = body as {
      widget_id: string;
      action: "chat" | "submit_lead" | "get_quote" | "get_roi" | "search_faq" | "book_appointment";
      message?: string;
      history?: Array<{ role: string; content: string }>;
      form_data?: Record<string, string>;
      quote_inputs?: Record<string, number | string>;
      roi_inputs?: Record<string, number>;
      query?: string;
    };

    if (!widgetId || !action) {
      return new Response(JSON.stringify({ error: "widget_id and action are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Rate limit check
    if (!checkRateLimit(widgetId)) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load widget config
    const widget = await getWidgetConfig(widgetId);
    const config = widget.config ?? {};
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Fire-and-forget usage tracking
    sb.from("widget_usage_stats").upsert(
      {
        widget_id: widgetId,
        date: new Date().toISOString().split("T")[0],
        action_type: action,
        request_count: 1,
      },
      { onConflict: "widget_id,date,action_type" },
    ).catch(() => {});

    let result: Record<string, unknown>;

    switch (action) {
      // ── Chat ───────────────────────────────────────────────────────────────
      case "chat": {
        if (!message) {
          return new Response(JSON.stringify({ error: "message is required for chat" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const systemPrompt = `You are ${config.name || "an AI assistant"} for ${config.business_name}.
${config.business_type ? `This is a ${config.business_type} business.` : ""}
${widget.business_context ?? ""}

RULES:
- Be helpful, friendly, and concise (2-4 sentences max per reply)
- Focus on answering questions about ${config.business_name}'s products, services, and policies
- If asked about pricing, give ranges if known or invite them to request a quote
- Always end responses that could convert with a subtle CTA (e.g., "Ready to get started? Click below to contact us")
- NEVER make up specific prices, availability, or policies you don't know
- If you don't know something, say "I'd recommend contacting our team directly for that"`;

        const reply = await callGemini(
          systemPrompt,
          [...(history ?? []), { role: "user", content: message }],
        );

        // Log chat to DB
        await sb.from("widget_chat_logs").insert({
          widget_id: widgetId,
          message,
          reply,
          session_id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
        });

        result = { reply };
        break;
      }

      // ── Submit Lead ────────────────────────────────────────────────────────
      case "submit_lead": {
        await sb.from("widget_leads").insert({
          widget_id: widgetId,
          name: form_data?.name ?? "",
          email: form_data?.email ?? "",
          phone: form_data?.phone ?? "",
          company: form_data?.company ?? "",
          message: form_data?.message ?? "",
          source_url: req.headers.get("Referer") ?? "",
        });

        const systemPrompt = `You are a helpful assistant for ${config.business_name}.
A potential customer just submitted a contact form. Write a warm, personalized thank-you message (3-5 sentences) that:
1. Acknowledges what they're looking for (based on their message)
2. Sets expectations (we'll respond within X hours)
3. Offers one immediate value (a tip, resource, or answer)
Keep it human, not robotic. No corporate speak.`;

        const aiResponse = await callGemini(
          systemPrompt,
          [
            {
              role: "user",
              content: `Their message: "${form_data?.message || "General inquiry"}" from ${form_data?.name}`,
            },
          ],
          256,
        );

        result = { success: true, message: aiResponse };
        break;
      }

      // ── Get Quote ─────────────────────────────────────────────────────────
      case "get_quote": {
        const inputSummary = Object.entries(quote_inputs ?? {})
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ");

        const systemPrompt = `You are a pricing specialist for ${config.business_name} (${config.service_name || config.business_type}).
Generate a professional quote estimate based on the provided inputs.

Return JSON:
{
  "estimated_min": number,
  "estimated_max": number,
  "currency": "USD",
  "breakdown": [{ "item": "string", "cost": number }],
  "timeline": "string (e.g. '2-3 weeks')",
  "notes": "string (important caveats or inclusions)",
  "next_step": "string (CTA)"
}`;

        const quoteJson = await callGemini(
          systemPrompt,
          [{ role: "user", content: `Project inputs: ${inputSummary}` }],
          512,
        );

        let quote: Record<string, unknown>;
        try {
          quote = JSON.parse(quoteJson);
        } catch {
          quote = { estimated_min: 0, estimated_max: 0, notes: quoteJson };
        }

        await sb.from("widget_leads").insert({
          widget_id: widgetId,
          lead_type: "quote",
          metadata: { quote_inputs, quote_result: quote },
        });

        result = { success: true, quote };
        break;
      }

      // ── Get ROI ───────────────────────────────────────────────────────────
      case "get_roi": {
        const inputSummary = Object.entries(roi_inputs ?? {})
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ");

        const systemPrompt = `You are an ROI analyst for ${config.business_name}.
Calculate the ROI and business value based on the provided inputs.
Return JSON: {
  "annual_savings": number,
  "annual_revenue_increase": number,
  "roi_percentage": number,
  "payback_months": number,
  "explanation": "2-3 sentence human explanation of the results",
  "key_benefits": ["benefit 1", "benefit 2", "benefit 3"]
}
ROI context: ${config.roi_formula || config.business_context || "standard business value calculation"}`;

        const roiJson = await callGemini(
          systemPrompt,
          [{ role: "user", content: `Inputs: ${inputSummary}` }],
          512,
        );

        let roi: Record<string, unknown>;
        try {
          roi = JSON.parse(roiJson);
        } catch {
          roi = { explanation: roiJson };
        }

        result = { success: true, roi };
        break;
      }

      // ── Search FAQ ────────────────────────────────────────────────────────
      case "search_faq": {
        const faqs = config.faqs ?? [];

        const systemPrompt = `You are a helpful assistant for ${config.business_name}.
Answer the customer's question based on these FAQs:
${faqs.map((f: any) => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n")}

If the answer is in the FAQs, summarize it naturally. If not, say you'll connect them with the team.
Keep response under 3 sentences.`;

        const answer = await callGemini(
          systemPrompt,
          [{ role: "user", content: query ?? message ?? "" }],
          256,
        );

        result = { answer };
        break;
      }

      // ── Book Appointment ──────────────────────────────────────────────────
      case "book_appointment": {
        await sb.from("widget_leads").insert({
          widget_id: widgetId,
          lead_type: "appointment",
          name: form_data?.name ?? "",
          email: form_data?.email ?? "",
          metadata: {
            service: form_data?.service,
            date: form_data?.date,
            time: form_data?.time,
            notes: form_data?.notes,
          },
        });

        const systemPrompt = `Write a warm appointment confirmation message for ${config.business_name}.
Service: ${form_data?.service}, Date: ${form_data?.date}, Time: ${form_data?.time}.
Keep it brief (2-3 sentences), professional, and include what they should expect next.`;

        const confirmation = await callGemini(
          systemPrompt,
          [{ role: "user", content: "Generate appointment confirmation" }],
          200,
        );

        result = { success: true, confirmation };
        break;
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[mavis-widget-api] error:", err);
    return new Response(
      JSON.stringify({ error: err?.message ?? "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
