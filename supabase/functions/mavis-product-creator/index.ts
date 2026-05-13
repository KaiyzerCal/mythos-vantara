// MAVIS Product Creator — Full delivery pipeline
// Platform routing:
//   "gumroad" (default) — digital products, PDF generated + hosted on Supabase Storage,
//                          Gumroad listing created with delivery URL
//   "stripe"            — services/subscriptions, Stripe Product + Payment Link,
//                          PDF generated and stored for reference
//
// Required env vars:
//   ANTHROPIC_API_KEY        — content generation (always required)
//   GUMROAD_ACCESS_TOKEN     — for Gumroad publishing
//   STRIPE_SECRET_KEY        — for Stripe publishing
//   SUPABASE_URL             — for Storage upload
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const GUMROAD_TOKEN = Deno.env.get("GUMROAD_ACCESS_TOKEN");
const STRIPE_KEY    = Deno.env.get("STRIPE_SECRET_KEY");

const STORAGE_BUCKET = "mavis-products";

// ─────────────────────────────────────────────────────────────
// CONTENT GENERATION
// ─────────────────────────────────────────────────────────────

async function generateProductContent(
  title: string,
  description: string,
  audience: string,
  category: string,
): Promise<string> {
  const formats: Record<string, string> = {
    guide:       "a practical guide with 6–8 sections. Each section: ## Heading, then 150–200 words of actionable insight.",
    prompt_pack: "a collection of 12 high-quality prompts. Each: ## Prompt Name, the exact prompt text, expected output, and one use case example.",
    template:    "a fill-in-the-blank template with 5 sections. Use [PLACEHOLDER] tokens. Add usage instructions at the top.",
    framework:   "a decision framework with 4 phases. Each: ## Phase Name, the core question, action steps, and deliverable.",
    mini_course: "a 5-module mini course. Each: ## Module N: Title, learning objective, 200-word lesson, and one exercise.",
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 8000,
      system: `You are creating a premium digital product. Write with authority, specificity, and practical depth. No filler. Target: ${audience || "ambitious builders"}. Format: ${formats[category] ?? formats.guide}`,
      messages: [{
        role: "user",
        content: `Create the complete content for:\n\nTitle: ${title}\nDescription: ${description}\n\nWrite the full product now. Every section should deliver real value.`,
      }],
    }),
  });

  const data = await res.json();
  return data?.content?.[0]?.text ?? "";
}

// ─────────────────────────────────────────────────────────────
// PDF GENERATION
// Converts Claude's markdown-style content into a professional PDF.
// ─────────────────────────────────────────────────────────────

// WinAnsi (pdf-lib StandardFonts) only supports Latin-1 (U+0000–U+00FF).
// Replace common Unicode chars with ASCII equivalents, strip the rest.
function sanitizeForPDF(text: string): string {
  return text
    .replace(/[‘’]/g, "'")   // smart single quotes
    .replace(/[“”]/g, '"')   // smart double quotes
    .replace(/–/g, "-")           // en dash
    .replace(/—/g, "--")          // em dash
    .replace(/…/g, "...")         // ellipsis
    .replace(/•/g, "*")           // bullet
    .replace(/ /g, " ")          // non-breaking space
    .replace(/[^\x00-\xFF]/g, "");     // strip anything outside Latin-1
}

function wrapText(text: string, font: Awaited<ReturnType<PDFDocument["embedFont"]>>, size: number, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    try {
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    } catch {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function generatePDF(
  title: string,
  description: string,
  priceCents: number,
  category: string,
  content: string,
): Promise<Uint8Array> {
  title       = sanitizeForPDF(title);
  description = sanitizeForPDF(description);
  content     = sanitizeForPDF(content);

  const doc = await PDFDocument.create();

  const W = 612, H = 792;          // US Letter
  const margin = 60;
  const contentW = W - margin * 2;

  // Fonts
  const bold   = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  // Colors
  const purple = rgb(0.49, 0.23, 0.93);
  const dark   = rgb(0.08, 0.08, 0.10);
  const muted  = rgb(0.45, 0.45, 0.50);
  const white  = rgb(1, 1, 1);
  const light  = rgb(0.97, 0.97, 0.97);

  const price = `$${(priceCents / 100).toFixed(0)}`;
  const cat   = category.replace("_", " ").toUpperCase();

  // ── COVER PAGE ────────────────────────────────────────────
  const cover = doc.addPage([W, H]);

  // Purple header bar
  cover.drawRectangle({ x: 0, y: H - 120, width: W, height: 120, color: purple });

  // CODEXOS label
  cover.drawText("CODEXOS · MAVIS PRODUCT", {
    x: margin, y: H - 38, size: 9, font: bold, color: white,
    opacity: 0.75,
  });

  // Category + price pills
  cover.drawText(cat, { x: margin, y: H - 68, size: 10, font: bold, color: white });
  cover.drawText(price, { x: W - margin - bold.widthOfTextAtSize(price, 16), y: H - 72, size: 16, font: bold, color: white });

  // Title
  const titleLines = wrapText(title, bold, 28, contentW);
  let ty = H - 160;
  for (const line of titleLines) {
    cover.drawText(line, { x: margin, y: ty, size: 28, font: bold, color: dark });
    ty -= 38;
  }

  // Separator
  cover.drawLine({ start: { x: margin, y: ty - 10 }, end: { x: W - margin, y: ty - 10 }, thickness: 1.5, color: purple, opacity: 0.4 });
  ty -= 30;

  // Description
  if (description) {
    const descLines = wrapText(description, regular, 13, contentW);
    for (const line of descLines.slice(0, 6)) {
      cover.drawText(line, { x: margin, y: ty, size: 13, font: regular, color: muted });
      ty -= 20;
    }
  }

  // Footer
  cover.drawRectangle({ x: 0, y: 0, width: W, height: 50, color: light });
  cover.drawText("Generated by MAVIS — Machine Autonomous Vantara Intelligence System", {
    x: margin, y: 18, size: 8, font: regular, color: muted,
  });

  // ── CONTENT PAGES ─────────────────────────────────────────
  // Parse content into blocks: { type: "heading" | "body", text: string }
  const blocks: { type: "heading" | "subheading" | "body" | "bullet"; text: string }[] = [];

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("### ")) {
      blocks.push({ type: "subheading", text: line.slice(4) });
    } else if (line.startsWith("## ")) {
      blocks.push({ type: "heading", text: line.slice(3) });
    } else if (line.startsWith("# ")) {
      blocks.push({ type: "heading", text: line.slice(2) });
    } else if (line.startsWith("- ") || line.startsWith("• ") || line.match(/^\d+\.\s/)) {
      blocks.push({ type: "bullet", text: line.replace(/^[-•]\s+/, "").replace(/^\d+\.\s+/, "") });
    } else {
      blocks.push({ type: "body", text: line });
    }
  }

  let page = doc.addPage([W, H]);
  let pageNum = 2;
  let y = H - margin;

  // Draw page header (product title + page number)
  const drawPageHeader = (pg: typeof page, num: number) => {
    pg.drawRectangle({ x: 0, y: H - 36, width: W, height: 36, color: light });
    pg.drawText(title.slice(0, 50), { x: margin, y: H - 22, size: 8, font: regular, color: muted });
    const pnStr = String(num);
    pg.drawText(pnStr, { x: W - margin - regular.widthOfTextAtSize(pnStr, 8), y: H - 22, size: 8, font: regular, color: muted });
    pg.drawLine({ start: { x: 0, y: H - 36 }, end: { x: W, y: H - 36 }, thickness: 0.5, color: muted, opacity: 0.3 });
  };

  drawPageHeader(page, pageNum);
  y = H - 60;

  const ensureSpace = (needed: number): typeof page => {
    if (y - needed < margin + 30) {
      pageNum++;
      page = doc.addPage([W, H]);
      drawPageHeader(page, pageNum);
      y = H - 60;
    }
    return page;
  };

  for (const block of blocks) {
    if (block.type === "heading") {
      ensureSpace(60);
      // Purple left bar accent
      page.drawRectangle({ x: margin - 8, y: y - 4, width: 3, height: 22, color: purple });
      page.drawText(block.text, { x: margin, y, size: 16, font: bold, color: dark });
      y -= 30;
      // Underline
      page.drawLine({ start: { x: margin, y }, end: { x: W - margin, y }, thickness: 0.5, color: purple, opacity: 0.25 });
      y -= 14;

    } else if (block.type === "subheading") {
      ensureSpace(40);
      page.drawText(block.text, { x: margin, y, size: 12, font: bold, color: dark });
      y -= 20;

    } else if (block.type === "bullet") {
      const lines = wrapText(block.text, regular, 10.5, contentW - 16);
      ensureSpace(32);
      page.drawText("-", { x: margin, y, size: 10.5, font: bold, color: purple });
      for (const line of lines) {
        if (y - 16 < margin + 30) { page = ensureSpace(16); }
        page.drawText(line, { x: margin + 14, y, size: 10.5, font: regular, color: dark });
        y -= 16;
      }
      y -= 4;

    } else if (block.type === "body") {
      const lines = wrapText(block.text, regular, 11, contentW);
      ensureSpace(25);
      for (const line of lines) {
        if (y - 17 < margin + 30) { page = ensureSpace(17); }
        page.drawText(line, { x: margin, y, size: 11, font: regular, color: dark });
        y -= 17;
      }
      y -= 8;
    }
  }

  return doc.save();
}

// ─────────────────────────────────────────────────────────────
// SUPABASE STORAGE UPLOAD
// Returns the public URL of the uploaded PDF.
// ─────────────────────────────────────────────────────────────

async function uploadPDF(userId: string, productId: string, pdfBytes: Uint8Array): Promise<string> {
  // Create bucket if it doesn't exist (idempotent)
  await supabase.storage.createBucket(STORAGE_BUCKET, {
    public: true,
    allowedMimeTypes: ["application/pdf"],
    fileSizeLimit: 20 * 1024 * 1024,
  }).catch(() => { /* already exists */ });

  const path = `${userId}/${productId}.pdf`;

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data: { publicUrl } } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return publicUrl;
}

// ─────────────────────────────────────────────────────────────
// GUMROAD
// Creates listing, then updates with the PDF delivery URL.
// ─────────────────────────────────────────────────────────────

interface GumroadResult {
  gumroadProductId: string;
  gumroadUrl: string;
  paymentLink: string;
}

async function publishToGumroad(
  title: string,
  description: string,
  priceCents: number,
  pdfUrl: string,
): Promise<GumroadResult> {
  // 1. Create product
  const createBody = new URLSearchParams({
    access_token: GUMROAD_TOKEN!,
    name: title,
    description: description.slice(0, 2000),
    price: String(priceCents),
    url: pdfUrl,          // delivery URL — customer downloads after purchase
    published: "true",
  });

  const createRes = await fetch("https://api.gumroad.com/v2/products", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: createBody,
  });

  if (!createRes.ok) throw new Error(`Gumroad create failed: ${await createRes.text()}`);
  const created = await createRes.json();
  if (!created.success) throw new Error(`Gumroad error: ${JSON.stringify(created)}`);

  return {
    gumroadProductId: created.product.id,
    gumroadUrl: created.product.short_url,
    paymentLink: created.product.short_url,
  };
}

// ─────────────────────────────────────────────────────────────
// STRIPE
// Creates Product + Price + Payment Link.
// ─────────────────────────────────────────────────────────────

interface StripeResult {
  stripeProductId: string;
  stripePriceId: string;
  paymentLink: string;
}

async function publishToStripe(
  title: string,
  description: string,
  priceCents: number,
  pdfUrl: string,
): Promise<StripeResult> {
  const headers = {
    "Authorization": `Bearer ${STRIPE_KEY}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };

  // 1. Product
  const productRes = await fetch("https://api.stripe.com/v1/products", {
    method: "POST",
    headers,
    body: new URLSearchParams({
      name: title,
      description: description.slice(0, 500),
      "metadata[pdf_url]": pdfUrl,
    }),
  });
  if (!productRes.ok) throw new Error(`Stripe product: ${await productRes.text()}`);
  const product = await productRes.json();

  // 2. Price
  const priceRes = await fetch("https://api.stripe.com/v1/prices", {
    method: "POST",
    headers,
    body: new URLSearchParams({ product: product.id, unit_amount: String(priceCents), currency: "usd" }),
  });
  if (!priceRes.ok) throw new Error(`Stripe price: ${await priceRes.text()}`);
  const price = await priceRes.json();

  // 3. Payment link
  const linkRes = await fetch("https://api.stripe.com/v1/payment_links", {
    method: "POST",
    headers,
    body: new URLSearchParams({
      "line_items[0][price]": price.id,
      "line_items[0][quantity]": "1",
      "after_completion[type]": "redirect",
      "after_completion[redirect][url]": pdfUrl,   // deliver PDF after payment
    }),
  });
  if (!linkRes.ok) throw new Error(`Stripe payment link: ${await linkRes.text()}`);
  const link = await linkRes.json();

  return { stripeProductId: product.id, stripePriceId: price.id, paymentLink: link.url };
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
    platform?: "gumroad" | "stripe";
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
    platform = "gumroad",
  } = body;

  if (!userId || !title) {
    return new Response(JSON.stringify({ error: "userId and title are required" }), { status: 400 });
  }

  // Guard: check required keys for chosen platform
  if (platform === "gumroad" && !GUMROAD_TOKEN) {
    return new Response(JSON.stringify({ error: "GUMROAD_ACCESS_TOKEN not configured" }), { status: 400 });
  }
  if (platform === "stripe" && !STRIPE_KEY) {
    return new Response(JSON.stringify({ error: "STRIPE_SECRET_KEY not configured" }), { status: 400 });
  }

  try {
    // ── 1. Generate content ──────────────────────────────────
    const content = await generateProductContent(title, description, audience, category);
    if (!content) throw new Error("Content generation returned empty string");

    // ── 2. Reserve DB row (get an ID for the storage path) ──
    const { data: product, error: insertErr } = await supabase
      .from("mavis_products")
      .insert({
        user_id: userId,
        title,
        description,
        audience,
        category,
        content,
        price_cents,
        status: "draft",
        payment_link: "generating…",
      })
      .select("id")
      .single();

    if (insertErr || !product) throw insertErr ?? new Error("DB insert failed");
    const productId = product.id;

    // ── 3. Generate PDF ──────────────────────────────────────
    const pdfBytes = await generatePDF(title, description, price_cents, category, content);

    // ── 4. Upload PDF to Supabase Storage ───────────────────
    const pdfUrl = await uploadPDF(userId, productId, pdfBytes);

    // ── 5. Publish to platform ───────────────────────────────
    let paymentLink = "";
    let gumroadProductId: string | null = null;
    let gumroadUrl: string | null = null;
    let stripeProductId: string | null = null;
    let stripePriceId: string | null = null;

    if (platform === "gumroad") {
      const g = await publishToGumroad(title, description || title, price_cents, pdfUrl);
      gumroadProductId = g.gumroadProductId;
      gumroadUrl = g.gumroadUrl;
      paymentLink = g.paymentLink;
    } else {
      const s = await publishToStripe(title, description || title, price_cents, pdfUrl);
      stripeProductId = s.stripeProductId;
      stripePriceId = s.stripePriceId;
      paymentLink = s.paymentLink;
    }

    // ── 6. Update DB row with final details ──────────────────
    await supabase.from("mavis_products").update({
      gumroad_product_id: gumroadProductId,
      gumroad_url: gumroadUrl,
      stripe_product_id: stripeProductId,
      stripe_price_id: stripePriceId,
      payment_link: paymentLink,
      pdf_url: pdfUrl,
      platform,
      status: "active",
    }).eq("id", productId);

    return new Response(JSON.stringify({
      success: true,
      productId,
      platform,
      paymentLink,
      pdfUrl,
      gumroadProductId,
      gumroadUrl,
      stripeProductId,
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
