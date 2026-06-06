import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET_WIDGETS") ?? Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

async function verifyStripeSignature(body: string, sigHeader: string, secret: string): Promise<boolean> {
  if (!secret || !sigHeader) return false;

  const parts = sigHeader.split(",").reduce((acc, part) => {
    const [k, v] = part.split("=");
    acc[k] = v;
    return acc;
  }, {} as Record<string, string>);

  const timestamp = parts["t"];
  const signature = parts["v1"];
  if (!timestamp || !signature) return false;

  // Reject timestamps older than 5 minutes
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) return false;

  const payload = `${timestamp}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const computed = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  return computed === signature;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";

  // Verify signature (skip if no secret configured — allows testing)
  if (STRIPE_WEBHOOK_SECRET) {
    const valid = await verifyStripeSignature(body, sig, STRIPE_WEBHOOK_SECRET);
    if (!valid) {
      return new Response("Invalid signature", { status: 400 });
    }
  }

  const event = JSON.parse(body);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // Idempotency check
  const { data: existing } = await supabase
    .from("stripe_webhook_events")
    .select("id")
    .eq("id", event.id)
    .maybeSingle();

  if (existing) {
    return new Response(JSON.stringify({ ok: true, duplicate: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const widgetId = session.metadata?.widget_id;
        if (widgetId) {
          await supabase
            .from("widget_instances")
            .update({
              stripe_customer_id: session.customer,
              stripe_subscription_id: session.subscription,
              subscription_status: "active",
              updated_at: new Date().toISOString(),
            })
            .eq("id", widgetId);
        }
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object;
        const statusMap: Record<string, string> = {
          active: "active",
          trialing: "trial",
          past_due: "past_due",
          canceled: "cancelled",
          unpaid: "past_due",
          incomplete: "past_due",
          incomplete_expired: "cancelled",
          paused: "paused",
        };
        await supabase
          .from("widget_instances")
          .update({
            subscription_status: statusMap[sub.status] ?? sub.status,
            current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
            cancel_at_period_end: sub.cancel_at_period_end,
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", sub.id);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await supabase
          .from("widget_instances")
          .update({
            subscription_status: "cancelled",
            status: "paused",
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", sub.id);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const updates: Record<string, unknown> = {
          subscription_status: "past_due",
          updated_at: new Date().toISOString(),
        };
        if (invoice.attempt_count >= 3) {
          updates.status = "paused";
        }
        await supabase
          .from("widget_instances")
          .update(updates)
          .eq("stripe_subscription_id", invoice.subscription);
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        if (invoice.subscription) {
          await supabase
            .from("widget_instances")
            .update({
              subscription_status: "active",
              status: "active",
              updated_at: new Date().toISOString(),
            })
            .eq("stripe_subscription_id", invoice.subscription);
        }
        break;
      }
    }

    // Record event for idempotency
    await supabase
      .from("stripe_webhook_events")
      .insert({ id: event.id, type: event.type });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("stripe-widget-webhook error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
