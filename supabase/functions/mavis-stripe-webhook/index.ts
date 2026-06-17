// Stripe webhook handler — logs payments as MAVIS revenue events and triggers
// client welcome sequences on invoice.paid.
// Configure in Stripe dashboard: POST /functions/v1/mavis-stripe-webhook
// Include metadata.user_id and metadata.source on every PaymentIntent.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Falls back to operator ID since invoice.paid won't always carry metadata.user_id
const OPERATOR_UID = Deno.env.get("MAVIS_OPERATOR_MAIN_ID") ?? "";

function minutesFromNow(n: number): string {
  return new Date(Date.now() + n * 60 * 1000).toISOString();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = await req.json();
    const event = body;

    // ── invoice.paid — log revenue + trigger welcome sequence ─────────────────
    if (event.type === "invoice.paid") {
      const inv = event.data.object;
      const userId = inv.metadata?.user_id ?? OPERATOR_UID;
      const customerEmail = inv.customer_email ?? inv.customer_details?.email ?? "";
      const customerName  = inv.customer_name  ?? inv.customer_details?.name  ?? "there";
      const amountPaid    = (inv.amount_paid ?? inv.total ?? 0) / 100;
      const source        = inv.metadata?.source ?? "stripe_invoice";

      if (userId && amountPaid > 0) {
        await supabase.from("mavis_revenue").insert({
          user_id:           userId,
          source,
          amount:            amountPaid,
          currency:          (inv.currency ?? "usd").toUpperCase(),
          description:       inv.description ?? `Invoice paid (${source})`,
          stripe_payment_id: inv.payment_intent ?? inv.id,
        });
      }

      // Trigger welcome sequence only when we have a customer email
      if (userId && customerEmail) {
        // Thank-you email at T+4 min, onboarding email at T+7 min
        await supabase.from("mavis_tasks").insert([
          {
            user_id:      userId,
            type:         "client_welcome_sequence",
            description:  `Welcome: ${customerName} (${customerEmail})`,
            scheduled_at: minutesFromNow(4),
            status:       "pending",
            payload: {
              phase:          "thankyou",
              customer_email: customerEmail,
              customer_name:  customerName,
              amount_paid:    amountPaid,
              invoice_id:     inv.id,
              source,
            },
          },
          {
            user_id:      userId,
            type:         "client_welcome_sequence",
            description:  `Onboarding: ${customerName} (${customerEmail})`,
            scheduled_at: minutesFromNow(7),
            status:       "pending",
            payload: {
              phase:          "onboarding",
              customer_email: customerEmail,
              customer_name:  customerName,
              amount_paid:    amountPaid,
              invoice_id:     inv.id,
              source,
            },
          },
        ]);
      }
    }

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
