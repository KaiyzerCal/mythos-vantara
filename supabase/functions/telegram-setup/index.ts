// MAVIS Telegram Setup — run ONCE after deploying mavis-telegram-bot.
// Registers the webhook URL with Telegram so updates are delivered.
//
// Call this endpoint after deployment:
//   curl -X POST https://<project>.supabase.co/functions/v1/telegram-setup \
//     -H "Authorization: Bearer <service-role-key>"
//
// Or trigger from Supabase dashboard → Edge Functions → telegram-setup → Invoke

const BOT_TOKEN      = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";

Deno.serve(async (_req) => {
  if (!BOT_TOKEN) {
    return new Response(JSON.stringify({ error: "TELEGRAM_BOT_TOKEN not set" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  // Derive webhook URL from the active MAVIS Telegram bot endpoint.
  const webhookUrl = `${SUPABASE_URL}/functions/v1/mavis-telegram-bot`;

  // Register webhook with Telegram
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ["message", "edited_message", "callback_query"],
      drop_pending_updates: true,
      ...(WEBHOOK_SECRET ? { secret_token: WEBHOOK_SECRET } : {}),
    }),
  });

  const data = await res.json();

  if (!data.ok) {
    return new Response(JSON.stringify({ error: "Telegram rejected webhook", details: data }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  // Verify it was registered correctly
  const infoRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
  const info = await infoRes.json();

  return new Response(JSON.stringify({
    success: true,
    webhookUrl,
    telegramConfirmation: data,
    webhookInfo: info.result,
  }), { headers: { "Content-Type": "application/json" } });
});
