// MAVIS Gumroad Sale Webhook
// Fires on every Gumroad purchase. Logs revenue, updates product stats,
// and emails the buyer a branded delivery email with their PDF download link.
//
// One-time setup:
//   Gumroad Dashboard → Settings → Advanced → Ping URL:
//   https://YOUR_PROJECT.supabase.co/functions/v1/mavis-gumroad-webhook
//
// Required env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   RESEND_API_KEY          — customer delivery emails
//   ANNOUNCE_FROM_EMAIL     — "from" address (e.g. nora@codexos.app)
// Optional env vars:
//   GUMROAD_SELLER_ID       — reject pings not from your account

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const RESEND_KEY  = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL  = Deno.env.get("ANNOUNCE_FROM_EMAIL") ?? "nora@codexos.app";
const SELLER_ID   = Deno.env.get("GUMROAD_SELLER_ID");

// ─────────────────────────────────────────────────────────────
// CUSTOMER DELIVERY EMAIL
// Sends buyer a branded email with direct PDF download link.
// ─────────────────────────────────────────────────────────────

async function sendDeliveryEmail(
  toEmail: string,
  buyerName: string,
  productName: string,
  pdfUrl: string,
): Promise<void> {
  if (!RESEND_KEY) return;

  const firstName = buyerName?.split(" ")[0] || "there";

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Your download is ready</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0f;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#12121a;border-radius:12px;overflow:hidden;border:1px solid #1e1e2e;">

          <!-- Header bar -->
          <tr>
            <td style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:28px 36px;">
              <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:2px;color:rgba(255,255,255,0.6);text-transform:uppercase;">CODEXOS</p>
              <h1 style="margin:8px 0 0;font-size:22px;font-weight:700;color:#fff;">Your download is ready</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px;">
              <p style="margin:0 0 20px;font-size:15px;color:#c4c4d4;line-height:1.6;">
                Hey ${firstName},
              </p>
              <p style="margin:0 0 20px;font-size:15px;color:#c4c4d4;line-height:1.6;">
                Thanks for grabbing <strong style="color:#fff;">${productName}</strong>.
                Your file is ready — click the button below to download it now.
              </p>

              <!-- Download button -->
              <table cellpadding="0" cellspacing="0" style="margin:32px 0;">
                <tr>
                  <td style="background:linear-gradient(135deg,#7c3aed,#4f46e5);border-radius:8px;">
                    <a href="${pdfUrl}"
                       style="display:block;padding:14px 32px;font-size:15px;font-weight:700;color:#fff;text-decoration:none;letter-spacing:0.3px;">
                      Download ${productName}
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;font-size:13px;color:#6b6b8a;">
                Or copy this link:
              </p>
              <p style="margin:0 0 28px;font-size:12px;color:#7c3aed;word-break:break-all;">
                ${pdfUrl}
              </p>

              <hr style="border:none;border-top:1px solid #1e1e2e;margin:28px 0;">

              <p style="margin:0;font-size:13px;color:#6b6b8a;line-height:1.6;">
                Built by MAVIS. Distributed by Nora Vale.<br>
                Questions? Reply to this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [toEmail],
      subject: `Your download is ready — ${productName}`,
      html,
    }),
  });
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // Gumroad sends application/x-www-form-urlencoded
    const contentType = req.headers.get("content-type") ?? "";
    let params: URLSearchParams;

    if (contentType.includes("application/json")) {
      const json = await req.json();
      params = new URLSearchParams(Object.entries(json).map(([k, v]) => [k, String(v)]));
    } else {
      const text = await req.text();
      params = new URLSearchParams(text);
    }

    const resourceName = params.get("resource_name");
    const isTest       = params.get("test") === "true";

    // Only handle sale pings
    if (resourceName !== "sale") {
      return new Response(JSON.stringify({ received: true, skipped: "not a sale" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Ignore test sales (won't log revenue or email)
    if (isTest) {
      console.log("[GumroadWebhook] Test sale received — ignoring");
      return new Response(JSON.stringify({ received: true, skipped: "test sale" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Optional seller ID verification
    const sellerId = params.get("seller_id");
    if (SELLER_ID && sellerId !== SELLER_ID) {
      console.warn("[GumroadWebhook] seller_id mismatch — rejecting");
      return new Response(JSON.stringify({ error: "seller_id mismatch" }), { status: 403 });
    }

    const gumroadProductId = params.get("product_id") ?? "";
    const productName      = params.get("product_name") ?? "Product";
    const buyerEmail       = params.get("email") ?? "";
    const buyerName        = params.get("full_name") ?? "";
    const saleId           = params.get("sale_id") ?? "";
    const priceStr         = params.get("price") ?? "0";
    const currency         = (params.get("currency") ?? "USD").toUpperCase();
    const priceDollars     = parseInt(priceStr, 10) / 100;

    // Look up the product to get user_id and pdf_url
    const { data: product } = await supabase
      .from("mavis_products")
      .select("id, user_id, title, pdf_url, sales_count, revenue_total")
      .eq("gumroad_product_id", gumroadProductId)
      .maybeSingle();

    if (!product) {
      // Product not in our DB (could be a non-MAVIS Gumroad product) — log and return OK
      console.warn(`[GumroadWebhook] Product not found for gumroad_product_id=${gumroadProductId}`);
      return new Response(JSON.stringify({ received: true, warning: "product not in mavis_products" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── 1. Log revenue ──────────────────────────────────────
    await supabase.from("mavis_revenue").insert({
      user_id:          product.user_id,
      source:           "gumroad",
      amount:           priceDollars,
      currency,
      description:      `Gumroad sale — ${productName}`,
      gumroad_sale_id:  saleId,
    });

    // ── 2. Update product stats ─────────────────────────────
    await supabase.from("mavis_products").update({
      sales_count:   (product.sales_count ?? 0) + 1,
      revenue_total: parseFloat((product.revenue_total ?? 0)) + priceDollars,
    }).eq("id", product.id);

    // ── 3. Send delivery email to buyer ────────────────────
    if (buyerEmail && product.pdf_url) {
      await sendDeliveryEmail(buyerEmail, buyerName, productName, product.pdf_url);
    }

    // ── 4. Queue MAVIS notification ────────────────────────
    await supabase.from("mavis_tasks").insert({
      user_id:     product.user_id,
      type:        "revenue_snapshot",
      description: `Gumroad sale: ${productName} — $${priceDollars.toFixed(2)} from ${buyerName || buyerEmail}`,
      payload:     {
        source:     "gumroad",
        product_id: product.id,
        sale_id:    saleId,
        amount:     priceDollars,
        buyer:      buyerEmail,
      },
      status: "completed",
    });

    console.log(`[GumroadWebhook] Sale logged: ${productName} — $${priceDollars} (${saleId})`);

    return new Response(JSON.stringify({ received: true, logged: true, amount: priceDollars }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[GumroadWebhook] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
