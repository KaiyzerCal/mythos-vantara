// MAVIS Product Creator
// Generates product content via Claude, publishes to Gumroad (primary).
// Falls back to draft mode if GUMROAD_ACCESS_TOKEN not set.
//
// Required env vars:
//   ANTHROPIC_API_KEY      — always required (content generation)
//   GUMROAD_ACCESS_TOKEN   — for live Gumroad publishing
//
// Request body:
//   { userId, title, description, audience?, price_cents?, category? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const ANTHROPIC_KEY  = Deno.env.get("ANTHROPIC_API_KEY")!;
const GUMROAD_TOKEN  = Deno.env.get("GUMROAD_ACCESS_TOKEN");

// ─────────────────────────────────────────────────────────────
// CONTENT GENERATION
// ─────────────────────────────────────────────────────────────

async function generateProductContent(
  title: string,
  description: string,
  audience: string,
  category: string,
): Promise<string> {
  const categoryFormats: Record<string, string> = {
    guide:       "a practical guide with 6–8 sections. Each section: heading + 150–200 words of actionable insight.",
    prompt_pack: "a collection of 10–15 high-quality prompts with usage instructions. Each prompt: name, prompt text, expected output, example use case.",
    template:    "a fill-in-the-blank template with 4–6 sections. Placeholder tokens in [BRACKETS]. Usage instructions at the top.",
    framework:   "a decision framework with 3–5 phases or pillars. Each phase: name, core question, action steps, output/deliverable.",
    mini_course: "a 5-module mini course. Each module: title, learning objective, content (200 words), exercise or takeaway.",
  };

  const format = categoryFormats[category] ?? categoryFormats.guide;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 3000,
      system: `You are creating a premium digital product for sale. Write with authority, specificity, and practical depth. No fluff. Target audience: ${audience || "ambitious professionals and builders"}. Format: ${format}`,
      messages: [{
        role: "user",
        content: `Create the complete content for this product:\n\nTitle: ${title}\nDescription: ${description}\n\nWrite the full product content now. Make it worth every cent.`,
      }],
    }),
  });

  const data = await res.json();
  return data?.content?.[0]?.text ?? "";
}

// ─────────────────────────────────────────────────────────────
// GUMROAD INTEGRATION
// ─────────────────────────────────────────────────────────────

interface GumroadResult {
  gumroadProductId: string;
  gumroadUrl: string;
  paymentLink: string;
}

async function createGumroadProduct(
  title: string,
  description: string,
  priceCents: number,
): Promise<GumroadResult> {
  const body = new URLSearchParams({
    access_token: GUMROAD_TOKEN!,
    name: title,
    description: description.slice(0, 2000),
    price: String(priceCents),
    published: "true",
  });

  const res = await fetch("https://api.gumroad.com/v2/products", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) throw new Error(`Gumroad create failed: ${await res.text()}`);
  const data = await res.json();
  if (!data.success) throw new Error(`Gumroad error: ${JSON.stringify(data)}`);

  return {
    gumroadProductId: data.product.id,
    gumroadUrl: data.product.short_url,
    paymentLink: data.product.short_url,
  };
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: {
    userId: string;
    title: string;
    description?: string;
    audience?: string;
    price_cents?: number;
    category?: string;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const {
    userId,
    title,
    description = "",
    audience = "ambitious professionals",
    price_cents = 2900,
    category = "guide",
  } = body;

  if (!userId || !title) {
    return new Response(JSON.stringify({ error: "userId and title are required" }), { status: 400 });
  }

  try {
    // 1. Generate product content
    const content = await generateProductContent(title, description, audience, category);
    if (!content) throw new Error("Content generation returned empty string");

    // 2. Publish to Gumroad (or mark as draft if no key)
    let gumroadProductId: string | null = null;
    let gumroadUrl: string | null = null;
    let paymentLink: string | null = null;
    let productStatus = "draft";

    if (GUMROAD_TOKEN) {
      const gumroad = await createGumroadProduct(title, description || title, price_cents);
      gumroadProductId = gumroad.gumroadProductId;
      gumroadUrl = gumroad.gumroadUrl;
      paymentLink = gumroad.paymentLink;
      productStatus = "active";
    } else {
      paymentLink = "[GUMROAD_ACCESS_TOKEN not configured — product saved as draft]";
    }

    // 3. Store in mavis_products
    const { data: product, error: dbError } = await supabase
      .from("mavis_products")
      .insert({
        user_id: userId,
        title,
        description,
        audience,
        category,
        content,
        price_cents,
        gumroad_product_id: gumroadProductId,
        gumroad_url: gumroadUrl,
        payment_link: paymentLink,
        status: productStatus,
      })
      .select("id")
      .single();

    if (dbError) throw dbError;

    return new Response(JSON.stringify({
      success: true,
      productId: product?.id,
      gumroadProductId,
      gumroadUrl,
      paymentLink,
      status: productStatus,
      contentPreview: content.slice(0, 300) + "…",
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[ProductCreator]", err);
    return new Response(JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
