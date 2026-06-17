// mavis-vision-agent
// Image analysis using Claude's native vision (no external API key required —
// uses the project's ANTHROPIC_API_KEY). Accepts images as public URLs,
// base64 data, or Supabase Storage paths.
//
// Actions: analyze | ocr | describe | extract_license_plate | extract_receipt
//          extract_document | extract_table | classify | compare

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL       = Deno.env.get("SUPABASE_URL")!;
const SB_SRK       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const CLAUDE_API    = "https://api.anthropic.com/v1/messages";

// ── Image source builder ────────────────────────────────────────

type ImageSource =
  | { type: "url";    url: string }
  | { type: "base64"; media_type: string; data: string };

async function resolveImage(
  body: Record<string, any>,
  sb: ReturnType<typeof createClient>,
): Promise<ImageSource> {
  // 1. Supabase Storage path → signed URL
  if (body.storage_path) {
    const { data, error } = await sb.storage
      .from(String(body.storage_bucket ?? "mavis-uploads"))
      .createSignedUrl(String(body.storage_path), 300);
    if (error || !data?.signedUrl) throw new Error(`Storage error: ${error?.message ?? "no URL"}`);
    return { type: "url", url: data.signedUrl };
  }

  // 2. Raw base64
  if (body.image_base64) {
    const mediaType = String(body.media_type ?? body.image_type ?? "image/jpeg");
    // Strip data-URI prefix if present
    const data = String(body.image_base64).replace(/^data:[^;]+;base64,/, "");
    return { type: "base64", media_type: mediaType, data };
  }

  // 3. Public URL
  if (body.image_url) {
    return { type: "url", url: String(body.image_url) };
  }

  throw new Error("image source required: provide image_url, image_base64, or storage_path");
}

// ── Claude vision call ─────────────────────────────────────────

async function callVision(
  imageSource: ImageSource,
  prompt: string,
  model = "claude-haiku-4-5-20251001",
  maxTokens = 1024,
): Promise<string> {
  const imageContent =
    imageSource.type === "url"
      ? { type: "image", source: { type: "url", url: imageSource.url } }
      : { type: "image", source: { type: "base64", media_type: imageSource.media_type, data: imageSource.data } };

  const res = await fetch(CLAUDE_API, {
    method: "POST",
    headers: {
      "x-api-key":         ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type":      "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{
        role: "user",
        content: [
          imageContent,
          { type: "text", text: prompt },
        ],
      }],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Claude error (${res.status}): ${data.error?.message ?? JSON.stringify(data).slice(0, 200)}`);
  return data.content?.[0]?.text ?? "";
}

async function callVisionJSON(
  imageSource: ImageSource,
  prompt: string,
  model = "claude-haiku-4-5-20251001",
): Promise<unknown> {
  const raw = await callVision(imageSource, prompt + "\n\nRespond ONLY with valid JSON, no markdown fences.", model, 2048);
  const match = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) throw new Error(`Model did not return valid JSON. Raw: ${raw.slice(0, 300)}`);
  return JSON.parse(match[0]);
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
      const userClient = createClient(SB_URL, anonKey, { global: { headers: { Authorization: authHeader } } });
      const { data: ud } = await userClient.auth.getUser();
      if (!ud?.user?.id) return json({ error: "Unauthorized" }, 401);
      uid = ud.user.id;
    } else {
      return json({ error: "Unauthorized" }, 401);
    }

    const body   = (req as any)._body ?? await req.json().catch(() => ({}));
    const action = String(body.action ?? "analyze");
    const model  = String(body.model ?? "claude-haiku-4-5-20251001");

    const imageSource = await resolveImage(body, sb);

    switch (action) {

      case "analyze": {
        const prompt = String(body.prompt ?? "Analyze this image and describe what you see.");
        const text   = await callVision(imageSource, prompt, model);
        return json({ result: text });
      }

      case "ocr": {
        const text = await callVision(
          imageSource,
          "Extract ALL text visible in this image exactly as it appears. Preserve formatting, line breaks, and structure. Return only the extracted text with no commentary.",
          model,
        );
        return json({ text });
      }

      case "describe": {
        const detail = String(body.detail ?? "standard");
        const prompts: Record<string, string> = {
          brief:    "Describe this image in one sentence.",
          standard: "Describe this image in 2-3 sentences covering the main subject, context, and any notable details.",
          detailed: "Provide a detailed description of this image: subject, background, colors, text, objects, people, actions, mood, and anything else notable.",
          alt_text: "Write accessible alt text for this image suitable for screen readers. Be concise and descriptive.",
        };
        const text = await callVision(imageSource, prompts[detail] ?? prompts.standard, model);
        return json({ description: text, detail });
      }

      case "classify": {
        const categories = body.categories
          ? (Array.isArray(body.categories) ? body.categories : String(body.categories).split(",")).map((c: string) => c.trim())
          : null;

        const prompt = categories
          ? `Classify this image into exactly one of these categories: ${categories.join(", ")}.\nReturn ONLY the category name, nothing else.`
          : `Classify this image. Return a JSON object: { "category": "...", "subcategory": "...", "confidence": 0.95, "tags": ["tag1","tag2"] }`;

        const result = categories
          ? { category: (await callVision(imageSource, prompt, model)).trim() }
          : await callVisionJSON(imageSource, prompt, model);

        return json({ classification: result });
      }

      case "extract_license_plate": {
        const text = await callVision(
          imageSource,
          "Extract the license plate number from the front-most vehicle in this image. Return ONLY the plate characters (letters and numbers) with no spaces, dashes, or commentary. If no plate is visible, return 'NOT_FOUND'.",
          model,
        );
        const plate = text.trim().replace(/[^A-Z0-9]/gi, "").toUpperCase();
        return json({ plate, raw: text.trim(), found: plate !== "NOT_FOUND" && plate.length > 0 });
      }

      case "extract_receipt": {
        const data = await callVisionJSON(
          imageSource,
          `Extract all information from this receipt or invoice image. Return a JSON object with these fields:
{
  "vendor": "store or restaurant name",
  "date": "YYYY-MM-DD or null",
  "total": 0.00,
  "subtotal": 0.00,
  "tax": 0.00,
  "tip": 0.00,
  "currency": "USD",
  "payment_method": "cash|card|unknown",
  "items": [
    { "name": "item name", "quantity": 1, "price": 0.00 }
  ],
  "receipt_number": "number or null",
  "notes": "any other relevant info"
}
Fill in null for fields not visible. Numbers should be floats.`,
          model,
        );
        return json({ receipt: data });
      }

      case "extract_document": {
        const schema = body.schema ?? null;
        const prompt = schema
          ? `Extract structured data from this document image according to this schema:\n${JSON.stringify(schema, null, 2)}\nReturn only a JSON object matching the schema. Use null for missing fields.`
          : `Extract all structured information from this document image. Return a JSON object with appropriate fields based on what you see (form fields, key-value pairs, tables, dates, names, etc.).`;

        const data = await callVisionJSON(imageSource, prompt, model);
        return json({ document: data });
      }

      case "extract_table": {
        const data = await callVisionJSON(
          imageSource,
          `Extract the table or grid data visible in this image. Return a JSON object:
{
  "headers": ["col1", "col2", ...],
  "rows": [
    ["val1", "val2", ...],
    ...
  ],
  "row_count": 0,
  "col_count": 0
}
If multiple tables are present, return the largest/most prominent one. Preserve exact text values.`,
          model,
        );
        return json({ table: data });
      }

      case "compare": {
        // Compare two images — needs a second image
        const image2 = await resolveImage(
          {
            image_url:     body.image_url_2,
            image_base64:  body.image_base64_2,
            media_type:    body.media_type_2,
            storage_path:  body.storage_path_2,
            storage_bucket: body.storage_bucket_2,
          },
          sb,
        ).catch(() => null);

        if (!image2) return json({ error: "Second image required for compare. Provide image_url_2, image_base64_2, or storage_path_2." }, 400);

        const prompt = String(body.prompt ?? "Compare these two images. Describe what is the same and what is different.");

        const image2Content =
          image2.type === "url"
            ? { type: "image", source: { type: "url", url: image2.url } }
            : { type: "image", source: { type: "base64", media_type: image2.media_type, data: image2.data } };

        const image1Content =
          imageSource.type === "url"
            ? { type: "image", source: { type: "url", url: imageSource.url } }
            : { type: "image", source: { type: "base64", media_type: imageSource.media_type, data: imageSource.data } };

        const res = await fetch(CLAUDE_API, {
          method: "POST",
          headers: {
            "x-api-key":         ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01",
            "content-type":      "application/json",
          },
          body: JSON.stringify({
            model,
            max_tokens: 2048,
            messages: [{
              role: "user",
              content: [
                { type: "text", text: "Image 1:" },
                image1Content,
                { type: "text", text: "Image 2:" },
                image2Content,
                { type: "text", text: prompt },
              ],
            }],
          }),
        });

        const apiData = await res.json();
        if (!res.ok) throw new Error(`Claude error: ${apiData.error?.message ?? JSON.stringify(apiData).slice(0, 200)}`);
        return json({ comparison: apiData.content?.[0]?.text ?? "" });
      }

      default:
        return json({
          error: `Unknown action: ${action}. Use: analyze | ocr | describe | classify | extract_license_plate | extract_receipt | extract_document | extract_table | compare`,
        }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-vision-agent]", message);
    return json({ error: message }, 500);
  }
});
