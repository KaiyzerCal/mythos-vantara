// Stripe webhook handler — logs payments as MAVIS revenue events.
// Configure in Stripe dashboard: POST /functions/v1/mavis-stripe-webhook
// Include metadata.user_id and metadata.source on every PaymentIntent.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = await req.json();
    const event = body;

    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object;
      const userId = pi.metadata?.user_id;
      const source = pi.metadata?.source ?? "custom";
      const amount = pi.amount / 100;

      if (!userId) {
        console.warn("[StripeWebhook] payment_intent.succeeded missing user_id in metadata");
        return new Response(JSON.stringify({ received: true, warning: "no user_id" }));
      }

      // Log to revenue ledger
      await supabase.from("mavis_revenue").insert({
        user_id: userId,
        source,
        amount,
        currency: (pi.currency ?? "usd").toUpperCase(),
        description: pi.description ?? `Stripe payment (${source})`,
        stripe_payment_id: pi.id,
      });

      // Create a completed task record for operator visibility
      await supabase.from("mavis_tasks").insert({
        user_id: userId,
        type: "revenue_event",
        description: `Payment received: $${amount.toFixed(2)} from ${source}`,
        status: "completed",
        revenue_generated: amount,
        completed_at: new Date().toISOString(),
        result: { stripe_id: pi.id, source, currency: pi.currency },
      });
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId = session.metadata?.user_id;
      const source = session.metadata?.source ?? "vantara_sale";

      if (userId && session.amount_total) {
        const amount = session.amount_total / 100;
        await supabase.from("mavis_revenue").insert({
          user_id: userId,
          source,
          amount,
          currency: (session.currency ?? "usd").toUpperCase(),
          description: session.metadata?.description ?? `Checkout session (${source})`,
          stripe_payment_id: session.payment_intent ?? session.id,
        });
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[StripeWebhook] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
