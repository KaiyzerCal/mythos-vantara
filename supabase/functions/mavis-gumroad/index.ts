// MAVIS Gumroad Product Creator
// Creates products on Gumroad and stores them in mavis_products.
// Also supports listing existing products via ?action=list.
//
// Required env vars:
//   GUMROAD_ACCESS_TOKEN     — Gumroad API access token
//   SUPABASE_URL             — Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY — Supabase service role key
//
// POST request body:
//   { userId, title, description, audience?, price_cents?, category?, contentSummary? }
//
// GET/POST with ?action=list:
//   Returns all Gumroad products for the account

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const GUMROAD_TOKEN = Deno.env.get("GUMROAD_ACCESS_TOKEN");

// ─────────────────────────────────────────────────────────────
// GUMROAD API
// ─────────────────────────────────────────────────────────────

interface GumroadProduct {
  id: string;
  short_url: string;
  name: string;
  price: number;
}

interface GumroadCreateResponse {
  success: boolean;
  product: GumroadProduct;
  message?: string;
}

async function createGumroadProduct(
  name: string,
  description: string,
  priceCents: number,
): Promise<GumroadCreateResponse> {
  const params = new URLSearchParams({
    access_token: GUMROAD_TOKEN!,
    name,
    description,
    price: String(priceCents),
    published: "true",
  });

  const res = await fetch("https://api.gumroad.com/v2/products", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(
      `Gumroad product create failed (${res.status}): ${data.message ?? JSON.stringify(data)}`,
    );
  }
  return data as GumroadCreateResponse;
}

async function listGumroadProducts(): Promise<unknown[]> {
  const res = await fetch(
    `https://api.gumroad.com/v2/products?access_token=${encodeURIComponent(GUMROAD_TOKEN!)}`,
    { method: "GET" },
  );

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(
      `Gumroad product list failed (${res.status}): ${data.message ?? JSON.stringify(data)}`,
    );
  }
  return data.products ?? [];
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  // Guard: token must be present for all operations
  if (!GUMROAD_TOKEN) {
    return new Response(
      JSON.stringify({ success: false, error: "GUMROAD_ACCESS_TOKEN not configured" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // ── LIST action ──────────────────────────────────────────
  if (action === "list") {
    try {
      const products = await listGumroadProducts();
      return new Response(
        JSON.stringify({ success: true, products }),
        { headers: { "Content-Type": "application/json" } },
      );
    } catch (err) {
      console.error("[GumroadList]", err);
      return new Response(
        JSON.stringify({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  // ── CREATE action (default) ──────────────────────────────
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: {
    userId: string;
    title: string;
    description?: string;
    audience?: string;
    price_cents?: number;
    category?: string;
    contentSummary?: string;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: "Invalid JSON body" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const {
    userId,
    title,
    description = "",
    audience = "ambitious professionals",
    price_cents = 2900,
    category = "guide",
    contentSummary = "",
  } = body;

  if (!userId || !title) {
    return new Response(
      JSON.stringify({ success: false, error: "userId and title are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    // 1. Create product on Gumroad
    const gumroadRes = await createGumroadProduct(title, description || title, price_cents);
    const { id: gumroadProductId, short_url: gumroadUrl } = gumroadRes.product;
    const paymentLink = gumroadUrl;

    // 2. Upsert into mavis_products (match on user_id + title)
    const { data: existing } = await supabase
      .from("mavis_products")
      .select("id")
      .eq("user_id", userId)
      .eq("title", title)
      .maybeSingle();

    let productId: string;

    if (existing?.id) {
      // Update the existing row
      const { data: updated, error: updateError } = await supabase
        .from("mavis_products")
        .update({
          description,
          audience,
          category,
          content: contentSummary,
          price_cents,
          payment_link: paymentLink,
          gumroad_product_id: gumroadProductId,
          gumroad_url: gumroadUrl,
          status: "active",
        })
        .eq("id", existing.id)
        .select("id")
        .single();

      if (updateError) throw updateError;
      productId = updated!.id;
    } else {
      // Insert new row
      const { data: inserted, error: insertError } = await supabase
        .from("mavis_products")
        .insert({
          user_id: userId,
          title,
          description,
          audience,
          category,
          content: contentSummary,
          price_cents,
          payment_link: paymentLink,
          gumroad_product_id: gumroadProductId,
          gumroad_url: gumroadUrl,
          status: "active",
        })
        .select("id")
        .single();

      if (insertError) throw insertError;
      productId = inserted!.id;
    }

    return new Response(
      JSON.stringify({
        success: true,
        productId,
        gumroadProductId,
        gumroadUrl,
        paymentLink,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[GumroadCreate]", err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
