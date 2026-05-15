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
    guide:       "a practical guide with 6-8 sections. Each section: ## Heading, then 150-200 words of actionable insight.",
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
      system: `You are creating a premium digital product. Write with authority, specificity, and practical depth. No filler. Target: ${audience || "ambitious builders"}. Format: ${formats[category] ?? formats.guide}

After major sections embed visual infographic blocks using EXACTLY this syntax (each on its own line, valid JSON only, no trailing commas):
[VISUAL:callout:{"type":"tip","title":"Key Insight","content":"One concise actionable sentence under 100 chars"}]
[VISUAL:process_flow:{"title":"The Process","steps":["Step one short","Step two short","Step three short","Step four short"]}]
[VISUAL:stat_boxes:{"stats":[{"value":"$10K","label":"Monthly Revenue"},{"value":"14 days","label":"Time to First Sale"},{"value":"3x","label":"ROI"}]}]
[VISUAL:comparison:{"headers":["","Without","With This"],"rows":[["Time","8 hrs/day","1 hr/day"],["Revenue","Unpredictable","Consistent"]]}]

Placement rules:
- Add a callout (type: tip, warning, or insight) after each major section
- Add process_flow when explaining any workflow or system
- Add stat_boxes when mentioning outcomes, results, or metrics
- Add comparison when contrasting two approaches
- Total: 4-6 visual blocks distributed throughout the document
- Keep all text SHORT to fit cleanly in the PDF`,
      messages: [{
        role: "user",
        content: `Create the complete content for:\n\nTitle: ${title}\nDescription: ${description}\n\nWrite the full product now with embedded visual infographics.`,
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
// ─────────────────────────────────────────────────────────────

function sanitizeForPDF(text: string): string {
  return text
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/–/g, "-")
    .replace(/—/g, "--")
    .replace(/…/g, "...")
    .replace(/•/g, "*")
    .replace(/ /g, " ")
    .replace(/[^\x00-\xFF]/g, "");
}

function wrapText(text: string, font: any, size: number, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    try {
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
        lines.push(line); line = word;
      } else { line = test; }
    } catch { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

async function generatePDF(
  title: string,
  description: string,
  priceCents: number,
  category: string,
  rawContent: string,
): Promise<Uint8Array> {
  title       = sanitizeForPDF(title);
  description = sanitizeForPDF(description);

  // ── Pre-extract VISUAL blocks before sanitization ─────────
  type VisualData = { type: string; data: Record<string, unknown> };
  const visualRegistry: VisualData[] = [];

  const preprocessed = rawContent.split("\n").map(rawLine => {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("[VISUAL:")) {
      const match = trimmed.match(/^\[VISUAL:(\w+):(.*)\]$/s);
      if (match) {
        try {
          visualRegistry.push({ type: match[1], data: JSON.parse(match[2]) });
          return `VBLOCK:${visualRegistry.length - 1}`;
        } catch { /* fall through to text */ }
      }
    }
    return rawLine;
  }).join("\n");

  let content = sanitizeForPDF(preprocessed)
    .replace(/\[VISUAL:[^\]]*\]/g, "")   // strip any unparsed visual markers
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1");

  const doc = await PDFDocument.create();
  const W = 612, H = 792;
  const ML = 72, MR = 72, MT = 72, MB = 72;
  const contentW = W - ML - MR;

  const bold    = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  const purple = rgb(0.49, 0.23, 0.93);
  const dark   = rgb(0.08, 0.08, 0.10);
  const muted  = rgb(0.40, 0.40, 0.45);
  const white  = rgb(1, 1, 1);
  const light  = rgb(0.96, 0.96, 0.97);
  const accent = rgb(0.55, 0.28, 0.95);
  const amber  = rgb(0.95, 0.65, 0.10);
  const green  = rgb(0.12, 0.72, 0.42);

  const price = `$${(priceCents / 100).toFixed(0)}`;
  const cat   = category.replace(/_/g, " ").toUpperCase();

  // ── COVER PAGE ─────────────────────────────────────────────
  const cover = doc.addPage([W, H]);
  cover.drawRectangle({ x: 0, y: H - 200, width: W, height: 200, color: purple });
  cover.drawText("CODEXOS  |  MAVIS AUTONOMOUS PRODUCT", { x: ML, y: H - 40, size: 8, font: bold, color: white, opacity: 0.7 });
  cover.drawRectangle({ x: ML, y: H - 70, width: bold.widthOfTextAtSize(cat, 9) + 16, height: 18, color: rgb(1,1,1), opacity: 0.15 });
  cover.drawText(cat, { x: ML + 8, y: H - 64, size: 9, font: bold, color: white });
  const priceW = bold.widthOfTextAtSize(price, 22);
  cover.drawText(price, { x: W - MR - priceW, y: H - 66, size: 22, font: bold, color: white });
  const titleLines = wrapText(title, bold, 32, contentW);
  let ty = H - 115;
  for (const line of titleLines) { cover.drawText(line, { x: ML, y: ty, size: 32, font: bold, color: white }); ty -= 42; }
  if (description) {
    ty -= 20;
    cover.drawLine({ start: { x: ML, y: ty + 10 }, end: { x: W - MR, y: ty + 10 }, thickness: 1, color: purple, opacity: 0.3 });
    ty -= 10;
    for (const line of wrapText(description, regular, 13, contentW).slice(0, 8)) {
      cover.drawText(line, { x: ML, y: ty, size: 13, font: regular, color: muted }); ty -= 21;
    }
  }
  cover.drawRectangle({ x: 0, y: 0, width: W, height: 48, color: light });
  cover.drawLine({ start: { x: 0, y: 48 }, end: { x: W, y: 48 }, thickness: 0.5, color: purple, opacity: 0.2 });
  cover.drawText("Generated by MAVIS  --  Machine Autonomous Vantara Intelligence System  --  CODEXOS", { x: ML, y: 17, size: 7.5, font: regular, color: muted });

  // ── PARSE BLOCKS ──────────────────────────────────────────
  type BlockType = "h1" | "h2" | "h3" | "body" | "bullet" | "numbered" | "divider" | "visual";
  const blocks: { type: BlockType; text: string; num?: number; visualIdx?: number }[] = [];
  let numberedCount = 0;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line) { numberedCount = 0; continue; }
    if (line.startsWith("VBLOCK:")) {
      const idx = parseInt(line.slice(7));
      if (!isNaN(idx) && idx < visualRegistry.length) blocks.push({ type: "visual", text: "", visualIdx: idx });
      continue;
    }
    if (line.startsWith("# "))   { blocks.push({ type: "h1", text: line.slice(2) }); continue; }
    if (line.startsWith("## "))  { blocks.push({ type: "h2", text: line.slice(3) }); continue; }
    if (line.startsWith("### ")) { blocks.push({ type: "h3", text: line.slice(4) }); continue; }
    if (line.match(/^[-*] /))    { blocks.push({ type: "bullet", text: line.slice(2) }); continue; }
    if (line.match(/^\d+\. /))   { numberedCount++; blocks.push({ type: "numbered", text: line.replace(/^\d+\. /, ""), num: numberedCount }); continue; }
    if (line.match(/^---+$/) || line.match(/^===+$/)) { blocks.push({ type: "divider", text: "" }); continue; }
    blocks.push({ type: "body", text: line });
  }

  // ── CONTENT PAGE SETUP ────────────────────────────────────
  let page = doc.addPage([W, H]);
  let pageNum = 2;
  let y = 0;
  const HEADER_H = 32, FOOTER_H = 28;

  const drawPageChrome = (pg: ReturnType<typeof doc.addPage>, num: number) => {
    pg.drawRectangle({ x: 0, y: H - HEADER_H, width: W, height: HEADER_H, color: light });
    pg.drawLine({ start: { x: 0, y: H - HEADER_H }, end: { x: W, y: H - HEADER_H }, thickness: 0.4, color: purple, opacity: 0.3 });
    pg.drawText(title.slice(0, 55), { x: ML, y: H - 21, size: 8, font: regular, color: muted });
    const pn = `Page ${num}`;
    pg.drawText(pn, { x: W - MR - regular.widthOfTextAtSize(pn, 8), y: H - 21, size: 8, font: regular, color: muted });
    pg.drawLine({ start: { x: ML, y: MB }, end: { x: W - MR, y: MB }, thickness: 0.4, color: muted, opacity: 0.3 });
  };

  const newPage = () => { pageNum++; page = doc.addPage([W, H]); drawPageChrome(page, pageNum); y = H - MT - HEADER_H - 12; };
  drawPageChrome(page, pageNum);
  y = H - MT - HEADER_H - 12;

  const safeY = () => MB + FOOTER_H + 10;
  const need = (h: number) => { if (y - h < safeY()) newPage(); };
  const drawLine = (text: string, x: number, size: number, font: typeof bold, color: ReturnType<typeof rgb>, lineH: number) => {
    if (y - size < safeY()) newPage();
    page.drawText(text, { x, y, size, font, color });
    y -= lineH;
  };

  // ── VISUAL DRAWING FUNCTIONS ──────────────────────────────

  const drawCallout = (vdata: Record<string, unknown>) => {
    const vtype    = String(vdata.type ?? "tip");
    const vtitle   = sanitizeForPDF(String(vdata.title ?? ""));
    const vcontent = sanitizeForPDF(String(vdata.content ?? ""));
    const bcolor   = vtype === "warning" ? amber : vtype === "insight" ? green : purple;
    const titleLines   = vtitle   ? wrapText(vtitle,   bold,    12, contentW - 20) : [];
    const contentLines = vcontent ? wrapText(vcontent, regular, 11, contentW - 20) : [];
    const boxH = 20 + titleLines.length * 16 + contentLines.length * 15 + 10;
    need(boxH + 10);
    y -= 6;
    page.drawRectangle({ x: ML - 8, y: y - boxH, width: contentW + 16, height: boxH, color: light });
    page.drawRectangle({ x: ML - 8, y: y - boxH, width: 4, height: boxH, color: bcolor });
    page.drawText(vtype.toUpperCase(), { x: ML + 4, y: y - 12, size: 8, font: bold, color: bcolor });
    let ty2 = y - 26;
    for (const l of titleLines)   { page.drawText(l, { x: ML + 4, y: ty2, size: 12, font: bold,    color: dark  }); ty2 -= 16; }
    for (const l of contentLines) { page.drawText(l, { x: ML + 4, y: ty2, size: 11, font: regular, color: muted }); ty2 -= 15; }
    y -= boxH + 8;
  };

  const drawProcessFlow = (vdata: Record<string, unknown>) => {
    const vtitle = sanitizeForPDF(String(vdata.title ?? ""));
    const steps  = Array.isArray(vdata.steps)
      ? (vdata.steps as unknown[]).map(s => sanitizeForPDF(String(s))).slice(0, 6)
      : [];
    if (!steps.length) return;
    const STEP_H = 44;
    need(28 + steps.length * STEP_H + 10);
    y -= 6;
    if (vtitle) { page.drawText(vtitle, { x: ML, y, size: 13, font: bold, color: dark }); y -= 22; }
    const cx = ML + 10;
    for (let i = 0; i < steps.length; i++) {
      const stepY = y;
      const cy    = stepY - 10;
      page.drawCircle({ x: cx, y: cy, size: 10, color: purple });
      const ns = String(i + 1);
      page.drawText(ns, { x: cx - bold.widthOfTextAtSize(ns, 8) / 2, y: cy - 3, size: 8, font: bold, color: white });
      const slines = wrapText(steps[i], regular, 11, contentW - 32);
      page.drawText(slines[0] ?? "", { x: ML + 28, y: stepY - 5, size: 11, font: regular, color: dark });
      if (slines[1]) page.drawText(slines[1], { x: ML + 28, y: stepY - 18, size: 11, font: regular, color: muted });
      if (i < steps.length - 1) {
        page.drawLine({ start: { x: cx, y: cy - 10 }, end: { x: cx, y: y - STEP_H }, thickness: 1.5, color: purple, opacity: 0.25 });
      }
      y -= STEP_H;
    }
    y -= 8;
  };

  const drawStatBoxes = (vdata: Record<string, unknown>) => {
    const stats = Array.isArray(vdata.stats)
      ? (vdata.stats as unknown[]).map((s: any) => ({
          value: sanitizeForPDF(String(s?.value ?? "")),
          label: sanitizeForPDF(String(s?.label ?? "")),
        })).slice(0, 3)
      : [];
    if (!stats.length) return;
    const GAP  = 8;
    const boxW = Math.floor((contentW - (stats.length - 1) * GAP) / stats.length);
    const boxH = 68;
    need(boxH + 16);
    y -= 6;
    for (let i = 0; i < stats.length; i++) {
      const bx = ML + i * (boxW + GAP);
      const by = y - boxH;
      page.drawRectangle({ x: bx, y: by, width: boxW, height: boxH, color: light });
      page.drawRectangle({ x: bx, y: by + boxH - 5, width: boxW, height: 5, color: purple });
      const vs   = stats[i].value.slice(0, 10);
      const vsz  = vs.length <= 5 ? 22 : 16;
      const vw   = bold.widthOfTextAtSize(vs, vsz);
      page.drawText(vs, { x: bx + (boxW - vw) / 2, y: by + 30, size: vsz, font: bold, color: purple });
      const ls  = stats[i].label.slice(0, 22);
      const lw  = regular.widthOfTextAtSize(ls, 9);
      page.drawText(ls, { x: bx + (boxW - lw) / 2, y: by + 12, size: 9, font: regular, color: muted });
    }
    y -= boxH + 10;
  };

  const drawComparison = (vdata: Record<string, unknown>) => {
    const headers = Array.isArray(vdata.headers)
      ? (vdata.headers as unknown[]).map(h => sanitizeForPDF(String(h))).slice(0, 4)
      : [];
    const rows = Array.isArray(vdata.rows)
      ? (vdata.rows as unknown[]).map(r =>
          Array.isArray(r) ? (r as unknown[]).map(c => sanitizeForPDF(String(c))) : []
        ).slice(0, 8)
      : [];
    if (!headers.length || !rows.length) return;
    const ROW_H = 22;
    need(ROW_H + rows.length * ROW_H + 16);
    y -= 6;
    const nc    = headers.length;
    const col0W = Math.floor(contentW * 0.35);
    const restW = nc > 1 ? Math.floor((contentW - col0W) / (nc - 1)) : contentW;
    const colX  = (c: number) => ML + (c === 0 ? 0 : col0W + (c - 1) * restW);
    // Header row
    page.drawRectangle({ x: ML, y: y - ROW_H, width: contentW, height: ROW_H, color: purple });
    for (let c = 0; c < nc; c++) page.drawText(headers[c].slice(0, 24), { x: colX(c) + 4, y: y - 15, size: 9, font: bold, color: white });
    y -= ROW_H;
    // Data rows
    for (let r = 0; r < rows.length; r++) {
      page.drawRectangle({ x: ML, y: y - ROW_H, width: contentW, height: ROW_H, color: r % 2 === 0 ? light : white });
      for (let c = 0; c < nc; c++) {
        const ct = ((rows[r] ?? [])[c] ?? "").slice(0, 28);
        page.drawText(ct, { x: colX(c) + 4, y: y - 15, size: 9, font: c === 0 ? bold : regular, color: c === 0 ? dark : muted });
      }
      page.drawLine({ start: { x: ML, y: y - ROW_H }, end: { x: ML + contentW, y: y - ROW_H }, thickness: 0.3, color: muted, opacity: 0.2 });
      y -= ROW_H;
    }
    y -= 10;
  };

  // ── RENDER BLOCKS ─────────────────────────────────────────
  for (const block of blocks) {
    if (block.type === "visual" && block.visualIdx !== undefined) {
      const vd = visualRegistry[block.visualIdx];
      if (!vd) continue;
      if      (vd.type === "callout")      drawCallout(vd.data);
      else if (vd.type === "process_flow") drawProcessFlow(vd.data);
      else if (vd.type === "stat_boxes")   drawStatBoxes(vd.data);
      else if (vd.type === "comparison")   drawComparison(vd.data);
      continue;
    }
    if (block.type === "h1" || block.type === "h2") {
      need(60); y -= 10;
      page.drawRectangle({ x: ML - 12, y: y - 6, width: contentW + 24, height: 30, color: light });
      page.drawRectangle({ x: ML - 12, y: y - 6, width: 4, height: 30, color: purple });
      for (const l of wrapText(block.text, bold, 16, contentW - 8)) drawLine(l, ML + 4, 16, bold, dark, 22);
      y -= 8;
    } else if (block.type === "h3") {
      need(40); y -= 6;
      for (const l of wrapText(block.text, bold, 13, contentW)) drawLine(l, ML, 13, bold, accent, 19);
      y -= 4;
    } else if (block.type === "bullet") {
      need(20);
      const ls = wrapText(block.text, regular, 12, contentW - 20);
      if (y - 12 < safeY()) newPage();
      page.drawCircle({ x: ML + 4, y: y - 3, size: 2.5, color: purple });
      for (const l of ls) drawLine(l, ML + 16, 12, regular, dark, 19);
      y -= 3;
    } else if (block.type === "numbered") {
      need(20);
      const ls = wrapText(block.text, regular, 12, contentW - 24);
      if (y - 12 < safeY()) newPage();
      page.drawText(`${block.num}.`, { x: ML, y, size: 12, font: bold, color: purple });
      for (const l of ls) drawLine(l, ML + 20, 12, regular, dark, 19);
      y -= 3;
    } else if (block.type === "divider") {
      need(24); y -= 8;
      page.drawLine({ start: { x: ML, y }, end: { x: W - MR, y }, thickness: 0.5, color: muted, opacity: 0.4 });
      y -= 16;
    } else {
      need(20);
      for (const l of wrapText(block.text, regular, 12, contentW)) drawLine(l, ML, 12, regular, dark, 20);
      y -= 8;
    }
  }

  return doc.save();
}

// ─────────────────────────────────────────────────────────────
// STORAGE UPLOAD
// ─────────────────────────────────────────────────────────────

async function uploadPDF(userId: string, productId: string, pdfBytes: Uint8Array): Promise<string> {
  await supabase.storage.createBucket(STORAGE_BUCKET, { public: true, allowedMimeTypes: ["application/pdf"], fileSizeLimit: 20 * 1024 * 1024 }).catch(() => {});
  const path = `${userId}/${productId}.pdf`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  const { data: { publicUrl } } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return publicUrl;
}

// ─────────────────────────────────────────────────────────────
// GUMROAD
// ─────────────────────────────────────────────────────────────

async function publishToGumroad(title: string, description: string, priceCents: number, pdfUrl: string) {
  const res = await fetch("https://api.gumroad.com/v2/products", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ access_token: GUMROAD_TOKEN!, name: title, description: description.slice(0, 2000), price: String(priceCents), url: pdfUrl, published: "true" }),
  });
  if (!res.ok) throw new Error(`Gumroad create failed: ${await res.text()}`);
  const created = await res.json();
  if (!created.success) throw new Error(`Gumroad error: ${JSON.stringify(created)}`);
  return { gumroadProductId: created.product.id, gumroadUrl: created.product.short_url, paymentLink: created.product.short_url };
}

// ─────────────────────────────────────────────────────────────
// STRIPE
// ─────────────────────────────────────────────────────────────

async function publishToStripe(title: string, description: string, priceCents: number, pdfUrl: string) {
  const h = { "Authorization": `Bearer ${STRIPE_KEY}`, "Content-Type": "application/x-www-form-urlencoded" };
  const prod = await (await fetch("https://api.stripe.com/v1/products", { method: "POST", headers: h, body: new URLSearchParams({ name: title, description: description.slice(0, 500), "metadata[pdf_url]": pdfUrl }) })).json();
  const price = await (await fetch("https://api.stripe.com/v1/prices", { method: "POST", headers: h, body: new URLSearchParams({ product: prod.id, unit_amount: String(priceCents), currency: "usd" }) })).json();
  const link  = await (await fetch("https://api.stripe.com/v1/payment_links", { method: "POST", headers: h, body: new URLSearchParams({ "line_items[0][price]": price.id, "line_items[0][quantity]": "1", "after_completion[type]": "redirect", "after_completion[redirect][url]": pdfUrl }) })).json();
  return { stripeProductId: prod.id, stripePriceId: price.id, paymentLink: link.url };
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 }); }

  const userId      = String(body.userId ?? "");
  const title       = String(body.title ?? "");
  const description = String(body.description ?? "");
  const audience    = String(body.audience ?? body.target_audience ?? "ambitious professionals");
  const priceCents  = Number(body.price_cents ?? 2900);
  const category    = String(body.category ?? "guide");
  const platform    = String(body.platform ?? "gumroad") as "gumroad" | "stripe";

  if (!userId || !title) return new Response(JSON.stringify({ error: "userId and title are required" }), { status: 400 });
  if (platform === "gumroad" && !GUMROAD_TOKEN) return new Response(JSON.stringify({ error: "GUMROAD_ACCESS_TOKEN not configured" }), { status: 400 });
  if (platform === "stripe"  && !STRIPE_KEY)    return new Response(JSON.stringify({ error: "STRIPE_SECRET_KEY not configured" }), { status: 400 });

  try {
    const content = await generateProductContent(title, description, audience, category);
    if (!content) throw new Error("Content generation returned empty string");

    const { data: product, error: insertErr } = await supabase.from("mavis_products").insert({
      user_id: userId, title, description, audience, category, content, price_cents: priceCents, status: "draft", payment_link: "generating…",
    }).select("id").single();
    if (insertErr || !product) throw new Error(insertErr?.message ?? insertErr?.details ?? "DB insert failed");

    const pdfBytes = await generatePDF(title, description, priceCents, category, content);
    const pdfUrl   = await uploadPDF(userId, product.id, pdfBytes);

    let paymentLink = "", gumroadProductId = null, gumroadUrl = null, stripeProductId = null, stripePriceId = null;
    if (platform === "gumroad") {
      const g = await publishToGumroad(title, description || title, priceCents, pdfUrl);
      gumroadProductId = g.gumroadProductId; gumroadUrl = g.gumroadUrl; paymentLink = g.paymentLink;
    } else {
      const s = await publishToStripe(title, description || title, priceCents, pdfUrl);
      stripeProductId = s.stripeProductId; stripePriceId = s.stripePriceId; paymentLink = s.paymentLink;
    }

    await supabase.from("mavis_products").update({ gumroad_product_id: gumroadProductId, gumroad_url: gumroadUrl, stripe_product_id: stripeProductId, stripe_price_id: stripePriceId, payment_link: paymentLink, pdf_url: pdfUrl, platform, status: "active" }).eq("id", product.id);

    return new Response(JSON.stringify({ success: true, productId: product.id, platform, paymentLink, pdfUrl, gumroadProductId, gumroadUrl, stripeProductId, contentPreview: content.slice(0, 300) + "…" }), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[ProductCreator]", err);
    return new Response(JSON.stringify({ success: false, error: err instanceof Error ? err.message : (typeof err === "object" ? JSON.stringify(err) : String(err)) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
