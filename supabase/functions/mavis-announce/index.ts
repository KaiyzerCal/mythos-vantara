// MAVIS Announce
// Sends product announcements via email (Resend) after a product is created.
// Called by mavis-task-executor for send_announcement tasks.
//
// Required env vars:
//   RESEND_API_KEY      — required for email delivery
//   ANNOUNCE_FROM_EMAIL — sender address (e.g. mavis@yourdomain.com)
//   ANNOUNCE_TO_EMAIL   — recipient address (operator's email)
//
// Request body:
//   { userId, title, description, paymentLink, recipientEmail? }

const RESEND_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = Deno.env.get("ANNOUNCE_FROM_EMAIL") ?? "mavis@codexos.app";
const TO_EMAIL   = Deno.env.get("ANNOUNCE_TO_EMAIL");

function buildEmailHtml(title: string, description: string, paymentLink: string, priceCents: number): string {
  const price = `$${(priceCents / 100).toFixed(2)}`;
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body { font-family: 'Courier New', monospace; background: #0a0a0a; color: #e5e5e5; padding: 40px 20px; }
  .container { max-width: 600px; margin: 0 auto; }
  .header { border-bottom: 1px solid #333; padding-bottom: 20px; margin-bottom: 30px; }
  .label { color: #7c3aed; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; }
  h1 { color: #fff; font-size: 24px; margin: 10px 0; }
  .price { color: #22c55e; font-size: 18px; font-weight: bold; }
  p { color: #a3a3a3; line-height: 1.6; }
  .cta { display: inline-block; margin-top: 24px; padding: 14px 28px; background: #7c3aed; color: #fff !important; text-decoration: none; border-radius: 4px; font-weight: bold; letter-spacing: 1px; }
  .footer { margin-top: 40px; border-top: 1px solid #333; padding-top: 20px; font-size: 11px; color: #555; }
</style></head>
<body>
<div class="container">
  <div class="header">
    <div class="label">MAVIS · Autonomous Revenue Event</div>
    <h1>${title}</h1>
    <div class="price">${price}</div>
  </div>
  <p>${description}</p>
  <a href="${paymentLink}" class="cta">View Payment Link →</a>
  <div class="footer">
    Generated autonomously by MAVIS — Machine Autonomous Vantara Intelligence System.<br>
    CODEXOS · Black Sun Monarch Protocol
  </div>
</div>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: {
    userId: string;
    title: string;
    description?: string;
    paymentLink: string;
    priceCents?: number;
    recipientEmail?: string;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const {
    title,
    description = "",
    paymentLink,
    priceCents = 2900,
    recipientEmail,
  } = body;

  const to = recipientEmail ?? TO_EMAIL;

  if (!RESEND_KEY) {
    console.warn("[Announce] RESEND_API_KEY not set — announcement logged but not sent");
    return new Response(JSON.stringify({
      sent: false,
      reason: "RESEND_API_KEY not configured",
      announcement: { title, paymentLink, priceCents },
    }), { headers: { "Content-Type": "application/json" } });
  }

  if (!to) {
    return new Response(JSON.stringify({
      error: "No recipient email — set ANNOUNCE_TO_EMAIL env var or pass recipientEmail in request",
    }), { status: 400 });
  }

  try {
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [to],
        subject: `[MAVIS] New product live: ${title}`,
        html: buildEmailHtml(title, description, paymentLink, priceCents),
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      throw new Error(`Resend API error ${emailRes.status}: ${errText}`);
    }

    const emailData = await emailRes.json();

    return new Response(JSON.stringify({
      sent: true,
      channel: "email",
      to,
      resendId: emailData.id,
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[Announce]", err);
    return new Response(JSON.stringify({
      sent: false,
      error: err instanceof Error ? err.message : String(err),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
