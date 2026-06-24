// MAVIS Telegram Setup — run ONCE after deploying mavis-telegram-bot.
// Registers the webhook URL with Telegram so updates are delivered to
// the correct function (mavis-telegram-bot, not the legacy telegram-webhook).
//
// Invoke via Supabase dashboard → Edge Functions → telegram-setup → Invoke
// or: curl -X POST https://<project>.supabase.co/functions/v1/telegram-setup \
//       -H "Authorization: Bearer <service-role-key>"

const BOT_TOKEN      = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;

Deno.serve(async (_req) => {
  if (!BOT_TOKEN) {
    return new Response(JSON.stringify({ error: "TELEGRAM_BOT_TOKEN not set" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  // Point webhook at mavis-telegram-bot (the full-featured bot with tools)
  const webhookUrl = `${SUPABASE_URL}/functions/v1/mavis-telegram-bot`;

  const body: Record<string, unknown> = {
    url:                  webhookUrl,
    allowed_updates:      ["message", "edited_message", "callback_query"],
    drop_pending_updates: true,
  };
  if (WEBHOOK_SECRET) body.secret_token = WEBHOOK_SECRET;

  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });

  const data = await res.json();

  if (!data.ok) {
    return new Response(JSON.stringify({ error: "Telegram rejected webhook", details: data }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  // Confirm what Telegram now has registered
  const infoRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
  const info    = await infoRes.json();

  return new Response(JSON.stringify({
    success:    true,
    webhookUrl,
    telegramConfirmation: data,
    webhookInfo: info.result,
  }), { headers: { "Content-Type": "application/json" } });
});
