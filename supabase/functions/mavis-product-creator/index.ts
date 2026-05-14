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

  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 8000,
      system: `You are creating a premium digital product. Write with authority, specificity, and practical depth. No filler. Target: ${audience || "ambitious builders"}. Format: ${formats[category] ?? formats.guide}`,
      messages: [{
        role: "user",
        content: `Create the complete content for:\n\nTitle: ${title}\nDescription: ${description}\n\nWrite the full product now. Every section should deliver real value.`,
      }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = (data?.content?.[0]?.text ?? "").trim();
  if (!text) throw new Error(`Claude returned empty content (finish_reason: ${data?.stop_reason ?? "unknown"})`);
  return text;
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
  // Strip bold/italic markdown markers from content so they don't appear literally
  content = sanitizeForPDF(content)
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1");

  const doc = await PDFDocument.create();

  // Page dimensions — US Letter
  const W = 612, H = 792;
  const ML = 72, MR = 72, MT = 72, MB = 72; // 1-inch margins
  const contentW = W - ML - MR;

  const bold    = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  const purple  = rgb(0.49, 0.23, 0.93);
  const dark    = rgb(0.08, 0.08, 0.10);
  const muted   = rgb(0.40, 0.40, 0.45);
  const white   = rgb(1, 1, 1);
  const light   = rgb(0.96, 0.96, 0.97);
  const accent  = rgb(0.55, 0.28, 0.95);

  const price = `$${(priceCents / 100).toFixed(0)}`;
  const cat   = category.replace(/_/g, " ").toUpperCase();

  // ── COVER PAGE ─────────────────────────────────────────────
  const cover = doc.addPage([W, H]);

  // Full-width purple header band
  cover.drawRectangle({ x: 0, y: H - 200, width: W, height: 200, color: purple });

  // Branding line
  cover.drawText("CODEXOS  |  MAVIS AUTONOMOUS PRODUCT", {
    x: ML, y: H - 40, size: 8, font: bold, color: white, opacity: 0.7,
  });

  // Category tag
  cover.drawRectangle({ x: ML, y: H - 70, width: bold.widthOfTextAtSize(cat, 9) + 16, height: 18, color: rgb(1,1,1), opacity: 0.15 });
  cover.drawText(cat, { x: ML + 8, y: H - 64, size: 9, font: bold, color: white });

  // Price
  const priceW = bold.widthOfTextAtSize(price, 22);
  cover.drawText(price, { x: W - MR - priceW, y: H - 66, size: 22, font: bold, color: white });

  // Title — large, wraps
  const titleLines = wrapText(title, bold, 32, contentW);
  let ty = H - 115;
  for (const line of titleLines) {
    cover.drawText(line, { x: ML, y: ty, size: 32, font: bold, color: white });
    ty -= 42;
  }

  // Description block below the band
  if (description) {
    ty -= 20;
    cover.drawLine({ start: { x: ML, y: ty + 10 }, end: { x: W - MR, y: ty + 10 }, thickness: 1, color: purple, opacity: 0.3 });
    ty -= 10;
    const descLines = wrapText(description, regular, 13, contentW);
    for (const line of descLines.slice(0, 8)) {
      cover.drawText(line, { x: ML, y: ty, size: 13, font: regular, color: muted });
      ty -= 21;
    }
  }

  // Bottom footer strip
  cover.drawRectangle({ x: 0, y: 0, width: W, height: 48, color: light });
  cover.drawLine({ start: { x: 0, y: 48 }, end: { x: W, y: 48 }, thickness: 0.5, color: purple, opacity: 0.2 });
  cover.drawText("Generated by MAVIS  --  Machine Autonomous Vantara Intelligence System  --  CODEXOS", {
    x: ML, y: 17, size: 7.5, font: regular, color: muted,
  });

  // ── PARSE CONTENT INTO BLOCKS ─────────────────────────────
  type BlockType = "h1" | "h2" | "h3" | "body" | "bullet" | "numbered" | "divider";
  const blocks: { type: BlockType; text: string; num?: number }[] = [];
  let numberedCount = 0;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line) { numberedCount = 0; continue; }
    if (line.startsWith("# "))   { blocks.push({ type: "h1", text: line.slice(2) }); continue; }
    if (line.startsWith("## "))  { blocks.push({ type: "h2", text: line.slice(3) }); continue; }
    if (line.startsWith("### ")) { blocks.push({ type: "h3", text: line.slice(4) }); continue; }
    if (line.match(/^[-*] /))    { blocks.push({ type: "bullet", text: line.slice(2) }); continue; }
    if (line.match(/^\d+\. /)) {
      numberedCount++;
      blocks.push({ type: "numbered", text: line.replace(/^\d+\. /, ""), num: numberedCount });
      continue;
    }
    if (line.match(/^---+$/) || line.match(/^===+$/)) { blocks.push({ type: "divider", text: "" }); continue; }
    blocks.push({ type: "body", text: line });
  }

  // ── CONTENT PAGES ─────────────────────────────────────────
  let page = doc.addPage([W, H]);
  let pageNum = 2;
  let y = H - MT;

  const HEADER_H = 32;
  const FOOTER_H = 28;
  const usableH  = H - MT - MB - HEADER_H - FOOTER_H;

  const drawPageChrome = (pg: ReturnType<typeof doc.addPage>, num: number) => {
    // Header bar
    pg.drawRectangle({ x: 0, y: H - HEADER_H, width: W, height: HEADER_H, color: light });
    pg.drawLine({ start: { x: 0, y: H - HEADER_H }, end: { x: W, y: H - HEADER_H }, thickness: 0.4, color: purple, opacity: 0.3 });
    pg.drawText(title.slice(0, 55), { x: ML, y: H - 21, size: 8, font: regular, color: muted });
    const pn = `Page ${num}`;
    pg.drawText(pn, { x: W - MR - regular.widthOfTextAtSize(pn, 8), y: H - 21, size: 8, font: regular, color: muted });
    // Footer line
    pg.drawLine({ start: { x: ML, y: MB }, end: { x: W - MR, y: MB }, thickness: 0.4, color: muted, opacity: 0.3 });
  };

  const newPage = () => {
    pageNum++;
    page = doc.addPage([W, H]);
    drawPageChrome(page, pageNum);
    y = H - MT - HEADER_H - 12;
  };

  drawPageChrome(page, pageNum);
  y = H - MT - HEADER_H - 12;

  // Ensure y has room for `needed` px, creating a new page if not
  const need = (needed: number) => {
    if (y - needed < MB + FOOTER_H + 10) newPage();
  };

  // Draw a single text line, creating new page mid-paragraph if needed
  const drawLine = (text: string, x: number, size: number, font: typeof bold, color: ReturnType<typeof rgb>, lineH: number) => {
    if (y - size < MB + FOOTER_H + 10) newPage();
    page.drawText(text, { x, y, size, font, color });
    y -= lineH;
  };

  for (const block of blocks) {
    if (block.type === "h1" || block.type === "h2") {
      // Section heading — stands out clearly
      need(60);
      y -= 10; // extra space before heading
      // Colored background pill
      page.drawRectangle({ x: ML - 12, y: y - 6, width: contentW + 24, height: 30, color: light });
      page.drawRectangle({ x: ML - 12, y: y - 6, width: 4, height: 30, color: purple });
      const hLines = wrapText(block.text, bold, 16, contentW - 8);
      for (const line of hLines) {
        drawLine(line, ML + 4, 16, bold, dark, 22);
      }
      y -= 8; // space after heading

    } else if (block.type === "h3") {
      need(40);
      y -= 6;
      const hLines = wrapText(block.text, bold, 13, contentW);
      for (const line of hLines) {
        drawLine(line, ML, 13, bold, accent, 19);
      }
      y -= 4;

    } else if (block.type === "bullet") {
      need(20);
      const lines = wrapText(block.text, regular, 12, contentW - 20);
      // Bullet dot
      if (y - 12 < MB + FOOTER_H + 10) newPage();
      page.drawCircle({ x: ML + 4, y: y - 3, size: 2.5, color: purple });
      for (let i = 0; i < lines.length; i++) {
        drawLine(lines[i], ML + 16, 12, regular, dark, 19);
      }
      y -= 3;

    } else if (block.type === "numbered") {
      need(20);
      const lines = wrapText(block.text, regular, 12, contentW - 24);
      const numStr = `${block.num}.`;
      if (y - 12 < MB + FOOTER_H + 10) newPage();
      page.drawText(numStr, { x: ML, y, size: 12, font: bold, color: purple });
      for (let i = 0; i < lines.length; i++) {
        drawLine(lines[i], ML + 20, 12, regular, dark, 19);
      }
      y -= 3;

    } else if (block.type === "divider") {
      need(24);
      y -= 8;
      page.drawLine({ start: { x: ML, y }, end: { x: W - MR, y }, thickness: 0.5, color: muted, opacity: 0.4 });
      y -= 16;

    } else {
      // body paragraph
      need(20);
      const lines = wrapText(block.text, regular, 12, contentW);
      for (const line of lines) {
        drawLine(line, ML, 12, regular, dark, 20);
      }
      y -= 8; // paragraph gap
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

  let body: Record<string, unknown>;

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const userId       = String(body.userId ?? "");
  const title        = String(body.title ?? "");
  const description  = String(body.description ?? "");
  const audience     = String(body.audience ?? body.target_audience ?? "ambitious professionals");
  const price_cents  = Number(body.price_cents ?? 2900);
  const category     = String(body.category ?? "guide");
  const platform     = String(body.platform ?? "gumroad") as "gumroad" | "stripe";

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

    if (insertErr || !product) throw new Error(insertErr?.message ?? insertErr?.details ?? "DB insert failed");
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
      error: err instanceof Error ? err.message : (typeof err === "object" ? JSON.stringify(err) : String(err)),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
