// mavis-vision-agent
// Image and video analysis using Gemini 2.5 Flash (primary) with Claude fallback.
// Accepts images as public URLs, base64 data, or Supabase Storage paths.
// Video analysis uses Gemini Files API (requires GEMINI_API_KEY).
//
// Actions: analyze | ocr | describe | extract_license_plate | extract_receipt
//          extract_document | extract_table | classify | compare
//          analyze_video | analyze_multi | vision_loop | vision_analyze

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
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent`;

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

async function callGeminiVision(
  imageSource: ImageSource,
  prompt: string,
  maxTokens = 4096,
): Promise<string> {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY not configured");

  // Resolve base64 from URL if needed
  let part: Record<string, unknown>;
  if (imageSource.type === "base64") {
    part = { inline_data: { mime_type: imageSource.media_type, data: imageSource.data } };
  } else {
    // Download URL to base64 for Gemini
    const res = await fetch(imageSource.url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
    const buf = await res.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    const ct  = res.headers.get("content-type") ?? "image/jpeg";
    part = { inline_data: { mime_type: ct, data: b64 } };
  }

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [part, { text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini vision failed ${res.status}: ${err.slice(0, 200)}`);
  }
  const j = await res.json();
  const parts: any[] = j.candidates?.[0]?.content?.parts ?? [];
  const text = parts.filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join("").trim();
  if (!text) throw new Error("Gemini returned empty response");
  return text;
}

// Upload a video/audio file to Gemini Files API and return { uri, name }
async function uploadToGeminiFiles(
  data: Uint8Array,
  mimeType: string,
  displayName: string,
): Promise<{ uri: string; name: string }> {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY not configured");
  const boundary = "mavis_va_boundary";
  const metaJson = JSON.stringify({ file: { display_name: displayName } });
  const metaPart  = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaJson}\r\n`;
  const dataPart  = `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const closing   = `\r\n--${boundary}--`;
  const enc = new TextEncoder();
  const metaBytes  = enc.encode(metaPart);
  const dataHeader = enc.encode(dataPart);
  const closeBytes = enc.encode(closing);
  const body = new Uint8Array(metaBytes.length + dataHeader.length + data.length + closeBytes.length);
  body.set(metaBytes, 0);
  body.set(dataHeader, metaBytes.length);
  body.set(data, metaBytes.length + dataHeader.length);
  body.set(closeBytes, metaBytes.length + dataHeader.length + data.length);

  const uploadRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=multipart&key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!uploadRes.ok) throw new Error(`Gemini upload ${uploadRes.status}: ${(await uploadRes.text()).slice(0, 200)}`);
  const uploaded = await uploadRes.json();
  return { uri: String(uploaded.file?.uri ?? ""), name: String(uploaded.file?.name ?? "") };
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
        const prompt = String(body.prompt ?? "Analyze this image in detail. Describe the subject, context, any text visible, colors, mood, people, objects, and anything notable.");
        // Try Gemini first (better quality), fall back to Claude
        if (GEMINI_KEY && model === "claude-haiku-4-5-20251001") {
          try {
            const text = await callGeminiVision(imageSource, prompt, 4096);
            return json({ result: text, model: "gemini-2.5-flash" });
          } catch (e: any) {
            console.warn("[analyze] Gemini failed, falling back to Claude:", e.message);
          }
        }
        const text = await callVision(imageSource, prompt, model);
        return json({ result: text, model });
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
        const prompt = prompts[detail] ?? prompts.standard;
        if (GEMINI_KEY && model === "claude-haiku-4-5-20251001") {
          try {
            const text = await callGeminiVision(imageSource, prompt, 2048);
            return json({ description: text, detail, model: "gemini-2.5-flash" });
          } catch (e: any) {
            console.warn("[describe] Gemini failed, falling back to Claude:", e.message);
          }
        }
        const text = await callVision(imageSource, prompt, model);
        return json({ description: text, detail, model });
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

      // ── vision_analyze ─────────────────────────────────────────────────────────
      // Standalone screenshot / image analysis — no browser required.
      // Input: { screenshot_base64: string, question: string }
      case "vision_analyze": {
        const screenshotB64 = String(body.screenshot_base64 ?? body.image_base64 ?? "");
        const question      = String(body.question ?? body.prompt ?? "Describe what you see in this screenshot.");

        if (!screenshotB64) return json({ error: "screenshot_base64 is required for vision_analyze" }, 400);

        const imgSrc: ImageSource = {
          type:       "base64",
          media_type: String(body.media_type ?? "image/png"),
          data:       screenshotB64.replace(/^data:[^;]+;base64,/, ""),
        };

        const analysis = await callVision(imgSrc, question, model);
        return json({ analysis, question });
      }

      // ── vision_loop ────────────────────────────────────────────────────────────
      // Iterative screenshot → Claude vision → action → screenshot cycle.
      // Requires a running browser environment (E2B sandbox) to execute actions.
      // If no e2b_sandbox_id is given, performs analysis only if screenshot_base64
      // is provided; otherwise returns a requires_browser response.
      //
      // Input: { userId, task, start_url?, max_iterations?, e2b_sandbox_id?,
      //          screenshot_base64? }
      case "vision_loop": {
        const E2B_API_KEY   = Deno.env.get("E2B_API_KEY") ?? "";
        const task          = String(body.task ?? "");
        const startUrl      = body.start_url ? String(body.start_url) : null;
        const maxIterations = Math.min(Number(body.max_iterations ?? 10), 20);
        const sandboxId     = body.e2b_sandbox_id ? String(body.e2b_sandbox_id) : null;
        const sessionId     = `vision_loop_${Date.now()}_${uid}`;

        if (!task) return json({ error: "task is required for vision_loop" }, 400);

        // If no browser sandbox and no direct screenshot, inform caller
        if (!sandboxId && !body.screenshot_base64) {
          return json({
            status:             "requires_browser",
            task,
            message:            "Provide e2b_sandbox_id with a running browser session to execute the vision loop. Alternatively, supply screenshot_base64 to analyse a single screenshot without browser control.",
            iterations_planned: maxIterations,
            start_url:          startUrl,
          });
        }

        const VISION_SYSTEM_PROMPT = `You are a browser automation agent. You see a screenshot of a browser and must decide the next single action to complete the task.
Reply ONLY with JSON: {"action": "click|type|navigate|scroll|done|error", "selector": "CSS selector or null", "text": "text to type or null", "url": "URL to navigate to or null", "scroll_y": number or null, "reason": "why this action", "done": boolean, "result": "final result if done"}
- Use "done": true when the task is complete
- Use "error" action if you cannot proceed`;

        async function callClaudeVision(imageBase64: string, userMessage: string): Promise<string> {
          const res = await fetch("https://api.anthropic.com/v1/messages", {
            method:  "POST",
            headers: {
              "x-api-key":         ANTHROPIC_KEY,
              "anthropic-version": "2023-06-01",
              "Content-Type":      "application/json",
            },
            body: JSON.stringify({
              model:      "claude-haiku-4-5-20251001",
              max_tokens: 1024,
              system:     VISION_SYSTEM_PROMPT,
              messages:   [{
                role:    "user",
                content: [
                  { type: "image", source: { type: "base64", media_type: "image/png", data: imageBase64 } },
                  { type: "text",  text: userMessage },
                ],
              }],
            }),
            signal: AbortSignal.timeout(30_000),
          });
          if (!res.ok) throw new Error(`Claude vision error ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`);
          const d = await res.json();
          return d.content?.[0]?.text ?? "";
        }

        // Helper: get screenshot from E2B sandbox
        async function getE2BScreenshot(sid: string): Promise<string | null> {
          if (!E2B_API_KEY || !sid) return null;
          try {
            const res = await fetch(`https://api.e2b.dev/sandboxes/${sid}/screenshot`, {
              method:  "GET",
              headers: { "X-API-Key": E2B_API_KEY },
              signal:  AbortSignal.timeout(15_000),
            });
            if (!res.ok) return null;
            const buf = await res.arrayBuffer();
            return btoa(String.fromCharCode(...new Uint8Array(buf)));
          } catch {
            return null;
          }
        }

        // Helper: execute browser action in E2B sandbox
        async function executeE2BAction(sid: string, decision: Record<string, unknown>): Promise<boolean> {
          if (!E2B_API_KEY || !sid) return false;
          try {
            const res = await fetch(`https://api.e2b.dev/sandboxes/${sid}/browser/action`, {
              method:  "POST",
              headers: { "X-API-Key": E2B_API_KEY, "Content-Type": "application/json" },
              body:    JSON.stringify(decision),
              signal:  AbortSignal.timeout(20_000),
            });
            return res.ok;
          } catch {
            return false;
          }
        }

        // Helper: log iteration to mavis_agent_traces
        async function logTrace(iteration: number, actionDecision: unknown, actionTaken: unknown, ok: boolean): Promise<void> {
          await sb.from("mavis_agent_traces").insert({
            user_id:     uid,
            session_id:  sessionId,
            iteration,
            action_type: "vision_step",
            params:      { iteration, action_decision: actionDecision, task: task.slice(0, 200) },
            result:      { action_taken: actionTaken },
            ok,
          }).catch(() => {});
        }

        // ── Main loop ──────────────────────────────────────────────────────────

        // If no sandbox, use the provided screenshot_base64 for a single-shot analysis
        if (!sandboxId) {
          const screenshotB64 = String(body.screenshot_base64).replace(/^data:[^;]+;base64,/, "");
          const raw = await callClaudeVision(screenshotB64, `Task: ${task}\n\nWhat is the current state of the screen and what single action should be taken next?`);

          let decision: Record<string, unknown> = {};
          try {
            const match = raw.match(/\{[\s\S]*\}/);
            decision = match ? JSON.parse(match[0]) : { action: "error", reason: "Could not parse Claude response" };
          } catch {
            decision = { action: "error", reason: "JSON parse failure", raw: raw.slice(0, 200) };
          }

          await logTrace(0, decision, { mode: "single_screenshot_analysis" }, true);

          return json({
            status:     "analysis_only",
            task,
            iterations: 1,
            decision,
            message:    "Single-screenshot analysis complete. Provide e2b_sandbox_id to execute actions in a live browser.",
          });
        }

        // Full loop with E2B sandbox
        const iterations: Array<Record<string, unknown>> = [];
        let finalResult: string | null = null;
        let loopStatus = "running";

        // Navigate to start URL if provided
        if (startUrl) {
          await executeE2BAction(sandboxId, { action: "navigate", url: startUrl });
          await new Promise((r) => setTimeout(r, 1500)); // brief pause for page load
        }

        for (let i = 0; i < maxIterations; i++) {
          // 1. Screenshot
          const screenshotB64 = await getE2BScreenshot(sandboxId);
          if (!screenshotB64) {
            loopStatus = "error";
            await logTrace(i, { error: "screenshot_failed" }, null, false);
            iterations.push({ iteration: i, error: "Failed to capture screenshot from E2B sandbox" });
            break;
          }

          // 2. Ask Claude what to do
          const raw = await callClaudeVision(
            screenshotB64,
            `Task: ${task}\nIteration: ${i + 1}/${maxIterations}\n\nWhat is the current state and what single action should be taken next?`,
          );

          let decision: Record<string, unknown> = {};
          try {
            const match = raw.match(/\{[\s\S]*\}/);
            decision = match ? JSON.parse(match[0]) : { action: "error", reason: "Could not parse Claude response" };
          } catch {
            decision = { action: "error", reason: "JSON parse failure", raw: raw.slice(0, 200) };
          }

          // 3. Check termination
          if (decision.done === true || decision.action === "done") {
            finalResult = String(decision.result ?? "Task completed");
            loopStatus  = "done";
            await logTrace(i, decision, { action_taken: "done" }, true);
            iterations.push({ iteration: i, decision, action_taken: "done" });
            break;
          }

          if (decision.action === "error") {
            loopStatus = "error";
            await logTrace(i, decision, { action_taken: "error" }, false);
            iterations.push({ iteration: i, decision, action_taken: "error" });
            break;
          }

          // 4. Execute action in E2B
          const executed = await executeE2BAction(sandboxId, decision);
          await logTrace(i, decision, { action_taken: decision.action, executed }, executed);
          iterations.push({ iteration: i, decision, action_taken: decision.action, executed });

          // 5. Brief pause for UI to settle
          await new Promise((r) => setTimeout(r, 1000));
        }

        if (loopStatus === "running") loopStatus = "max_iterations_reached";

        return json({
          status:      loopStatus,
          task,
          iterations:  iterations.length,
          final_result: finalResult,
          session_id:  sessionId,
          log:         iterations,
        });
      }

      // ── analyze_video ──────────────────────────────────────────────────────────
      // Full visual analysis of a video using Gemini Files API
      // Input: { video_url?, video_base64?, mime_type?, prompt? }
      case "analyze_video": {
        if (!GEMINI_KEY) return json({ error: "GEMINI_API_KEY required for video analysis" }, 400);

        const videoPrompt = String(body.prompt ?? `Analyze this video completely. Provide:

1. VISUAL ANALYSIS (with timestamps):
   Describe what is happening visually, scene by scene. Format as "MM:SS – MM:SS — [description]". Note people, expressions, actions, objects, on-screen text, graphics, UI elements.

2. AUDIO TRANSCRIPT:
   Transcribe all spoken words verbatim. Note speaker changes. Include non-speech events in brackets like [music], [laughter], [silence].

3. KEY MOMENTS:
   List the 3-5 most important or interesting moments with timestamps.

4. SUMMARY:
   One paragraph overview of the video's content, purpose, and context.`);

        // Get video bytes
        let videoData: Uint8Array;
        let videoMime: string;
        let videoName: string;

        if (body.video_base64) {
          const raw = String(body.video_base64).replace(/^data:[^;]+;base64,/, "");
          videoData = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
          videoMime = String(body.mime_type ?? "video/mp4");
          videoName = String(body.file_name ?? "video.mp4");
        } else if (body.video_url) {
          const res = await fetch(String(body.video_url), { signal: AbortSignal.timeout(60_000) });
          if (!res.ok) throw new Error(`Failed to fetch video: ${res.status}`);
          videoData = new Uint8Array(await res.arrayBuffer());
          videoMime = res.headers.get("content-type") ?? String(body.mime_type ?? "video/mp4");
          videoName = String(body.file_name ?? "video.mp4");
        } else {
          return json({ error: "video_url or video_base64 required for analyze_video" }, 400);
        }

        const { uri, name: fileName } = await uploadToGeminiFiles(videoData, videoMime, videoName);

        // Poll for ACTIVE state
        for (let i = 0; i < 40; i++) {
          await new Promise(r => setTimeout(r, 3000));
          const statusRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${GEMINI_KEY}`,
            { signal: AbortSignal.timeout(10_000) },
          );
          if (statusRes.ok) {
            const s = await statusRes.json();
            if (s.state === "ACTIVE") break;
            if (s.state === "FAILED") throw new Error("Gemini file processing failed");
          }
          if (i === 39) throw new Error("Gemini file processing timed out");
        }

        // Analyze
        const analyzeRes = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [
              { file_data: { mime_type: videoMime, file_uri: uri } },
              { text: videoPrompt },
            ]}],
            generationConfig: { maxOutputTokens: 16384 },
          }),
          signal: AbortSignal.timeout(180_000),
        });

        // Cleanup (fire and forget)
        fetch(
          `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${GEMINI_KEY}`,
          { method: "DELETE" },
        ).catch(() => {});

        if (!analyzeRes.ok) {
          const err = await analyzeRes.text();
          throw new Error(`Gemini video analysis failed ${analyzeRes.status}: ${err.slice(0, 300)}`);
        }
        const result = await analyzeRes.json();
        const vParts: any[] = result.candidates?.[0]?.content?.parts ?? [];
        const analysis = vParts.filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join("").trim();

        return json({ analysis, model: "gemini-2.5-flash", file: videoName });
      }

      // ── analyze_multi ──────────────────────────────────────────────────────────
      // Analyze multiple images together in one Gemini call
      // Input: { images: Array<{ url?, base64?, media_type?, label? }>, prompt? }
      case "analyze_multi": {
        if (!GEMINI_KEY) return json({ error: "GEMINI_API_KEY required for multi-image analysis" }, 400);

        const images: any[] = Array.isArray(body.images) ? body.images : [];
        if (images.length === 0) return json({ error: "images array required (at least 1)" }, 400);
        if (images.length > 16) return json({ error: "max 16 images per request" }, 400);

        const multiPrompt = String(body.prompt ?? "Analyze all these images together. Describe each one and note any relationships, patterns, or comparisons between them.");

        const parts: Record<string, unknown>[] = [];
        for (let i = 0; i < images.length; i++) {
          const img = images[i];
          if (img.label) parts.push({ text: `Image ${i + 1}${img.label ? ` (${img.label})` : ""}:` });

          if (img.base64) {
            const raw = String(img.base64).replace(/^data:[^;]+;base64,/, "");
            parts.push({ inline_data: { mime_type: String(img.media_type ?? "image/jpeg"), data: raw } });
          } else if (img.url) {
            const res = await fetch(String(img.url), { signal: AbortSignal.timeout(15_000) });
            if (!res.ok) throw new Error(`Failed to fetch image ${i + 1}: ${res.status}`);
            const buf = await res.arrayBuffer();
            const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
            const ct  = res.headers.get("content-type") ?? "image/jpeg";
            parts.push({ inline_data: { mime_type: ct, data: b64 } });
          }
        }
        parts.push({ text: multiPrompt });

        const res = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: { maxOutputTokens: 8192 },
          }),
          signal: AbortSignal.timeout(60_000),
        });

        if (!res.ok) {
          const err = await res.text();
          throw new Error(`Gemini multi-image failed ${res.status}: ${err.slice(0, 300)}`);
        }
        const j = await res.json();
        const rParts: any[] = j.candidates?.[0]?.content?.parts ?? [];
        const analysis = rParts.filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join("").trim();

        return json({ analysis, image_count: images.length, model: "gemini-2.5-flash" });
      }

      default:
        return json({
          error: `Unknown action: ${action}. Use: analyze | ocr | describe | classify | extract_license_plate | extract_receipt | extract_document | extract_table | compare | analyze_video | analyze_multi | vision_loop | vision_analyze`,
        }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-vision-agent]", message);
    return json({ error: message }, 500);
  }
});
