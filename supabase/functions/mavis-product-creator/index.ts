// MAVIS Product Creator
// Generates product content via Claude, creates Stripe product + payment link.
// Called by mavis-task-executor when a create_product task is approved and pending.
//
// Required env vars:
//   ANTHROPIC_API_KEY  — always required (content generation)
//   STRIPE_SECRET_KEY  — required for live Stripe products; if missing, stores draft
//
// Request body:
//   { userId, title, description, audience?, price_cents?, category? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY");

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
// STRIPE INTEGRATION
// ─────────────────────────────────────────────────────────────

interface StripeResult {
  productId: string;
  priceId: string;
  paymentLink: string;
}

async function createStripeProduct(
  title: string,
  description: string,
  priceCents: number,
): Promise<StripeResult> {
  const headers = {
    "Authorization": `Bearer ${STRIPE_KEY}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };

  // 1. Create product
  const productRes = await fetch("https://api.stripe.com/v1/products", {
    method: "POST",
    headers,
    body: new URLSearchParams({ name: title, description: description.slice(0, 500) }),
  });
  if (!productRes.ok) throw new Error(`Stripe product create failed: ${await productRes.text()}`);
  const product = await productRes.json();

  // 2. Create price
  const priceRes = await fetch("https://api.stripe.com/v1/prices", {
    method: "POST",
    headers,
    body: new URLSearchParams({
      product: product.id,
      unit_amount: String(priceCents),
      currency: "usd",
    }),
  });
  if (!priceRes.ok) throw new Error(`Stripe price create failed: ${await priceRes.text()}`);
  const price = await priceRes.json();

  // 3. Create payment link
  const linkRes = await fetch("https://api.stripe.com/v1/payment_links", {
    method: "POST",
    headers,
    body: new URLSearchParams({
      "line_items[0][price]": price.id,
      "line_items[0][quantity]": "1",
      "after_completion[type]": "redirect",
      "after_completion[redirect][url]": "https://vantara.app/purchase-complete",
    }),
  });
  if (!linkRes.ok) throw new Error(`Stripe payment link create failed: ${await linkRes.text()}`);
  const link = await linkRes.json();

  return { productId: product.id, priceId: price.id, paymentLink: link.url };
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

    // 2. Create Stripe product (or mark as draft if no key)
    let stripeProductId: string | null = null;
    let stripePriceId: string | null = null;
    let paymentLink: string | null = null;
    let productStatus = "draft";

    if (STRIPE_KEY) {
      const stripe = await createStripeProduct(title, description || title, price_cents);
      stripeProductId = stripe.productId;
      stripePriceId = stripe.priceId;
      paymentLink = stripe.paymentLink;
      productStatus = "active";
    } else {
      // No Stripe key — store as draft with placeholder link
      paymentLink = `[STRIPE_NOT_CONFIGURED — add STRIPE_SECRET_KEY to deploy]`;
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
        stripe_product_id: stripeProductId,
        stripe_price_id: stripePriceId,
        payment_link: paymentLink,
        status: productStatus,
      })
      .select("id")
      .single();

    if (dbError) throw dbError;

    // 4. Log to mavis_tasks result (caller updates the task row)
    return new Response(JSON.stringify({
      success: true,
      productId: product?.id,
      stripeProductId,
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
