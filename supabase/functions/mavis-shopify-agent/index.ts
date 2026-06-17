// mavis-shopify-agent
// Shopify Admin API — orders, products, customers, inventory, fulfillment.
// Requires: SHOPIFY_STORE_URL (mystore.myshopify.com) + SHOPIFY_ACCESS_TOKEN
//
// Actions: list_orders | get_order | list_products | create_product | update_product
//          list_customers | get_customer | get_inventory | update_inventory | list_refunds

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_SRK        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHOPIFY_STORE = Deno.env.get("SHOPIFY_STORE_URL") ?? "";
const SHOPIFY_TOKEN = Deno.env.get("SHOPIFY_ACCESS_TOKEN") ?? "";
const API_VERSION   = "2024-04";

function requireShopify() {
  if (!SHOPIFY_STORE || !SHOPIFY_TOKEN) {
    throw new Error("Shopify not configured. Set SHOPIFY_STORE_URL and SHOPIFY_ACCESS_TOKEN in Supabase secrets.");
  }
}

function shopifyUrl(path: string): string {
  const store = SHOPIFY_STORE.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${store}/admin/api/${API_VERSION}${path}`;
}

async function shopReq(path: string, method = "GET", body?: unknown): Promise<any> {
  requireShopify();
  const res = await fetch(shopifyUrl(path), {
    method,
    headers: {
      "X-Shopify-Access-Token": SHOPIFY_TOKEN,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data.errors ? JSON.stringify(data.errors) : data.error ?? `HTTP ${res.status}`;
    throw new Error(`Shopify error: ${msg}`);
  }
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (d: unknown, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader !== `Bearer ${SB_SRK}` && !authHeader.startsWith("Bearer eyJ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body   = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const limit  = Math.min(Number(body.limit ?? 20), 250);

    switch (action) {
      case "list_orders": {
        const status = String(body.status ?? "any"); // open|closed|cancelled|any
        const qs     = `?status=${status}&limit=${limit}${body.since_id ? `&since_id=${body.since_id}` : ""}${body.financial_status ? `&financial_status=${body.financial_status}` : ""}`;
        const data   = await shopReq(`/orders.json${qs}`);

        return json({
          orders: (data.orders ?? []).map((o: any) => ({
            id:               o.id,
            order_number:     o.order_number,
            email:            o.email,
            total_price:      o.total_price,
            currency:         o.currency,
            financial_status: o.financial_status,
            fulfillment_status: o.fulfillment_status,
            created_at:       o.created_at,
            line_items:       o.line_items?.map((l: any) => ({ title: l.title, quantity: l.quantity, price: l.price })),
          })),
        });
      }

      case "get_order": {
        const orderId = String(body.order_id ?? body.id ?? "");
        if (!orderId) return json({ error: "order_id required" }, 400);
        const data = await shopReq(`/orders/${orderId}.json`);
        return json({ order: data.order });
      }

      case "list_products": {
        const qs   = `?limit=${limit}${body.status ? `&status=${body.status}` : ""}${body.vendor ? `&vendor=${encodeURIComponent(body.vendor)}` : ""}`;
        const data = await shopReq(`/products.json${qs}`);

        return json({
          products: (data.products ?? []).map((p: any) => ({
            id:            p.id,
            title:         p.title,
            status:        p.status,
            vendor:        p.vendor,
            product_type:  p.product_type,
            price:         p.variants?.[0]?.price,
            inventory:     p.variants?.reduce((s: number, v: any) => s + (v.inventory_quantity ?? 0), 0),
            created_at:    p.created_at,
            tags:          p.tags,
          })),
        });
      }

      case "create_product": {
        const title = String(body.title ?? "");
        if (!title) return json({ error: "title required" }, 400);

        const product: Record<string, any> = {
          title,
          body_html:    body.description ? `<p>${body.description}</p>` : undefined,
          vendor:       body.vendor,
          product_type: body.product_type,
          status:       body.status ?? "draft",
          tags:         body.tags,
          variants:     body.price ? [{ price: String(body.price), inventory_quantity: body.inventory ?? 0 }] : undefined,
          images:       body.image_url ? [{ src: body.image_url }] : undefined,
        };

        const data = await shopReq("/products.json", "POST", { product });
        return json({ id: data.product?.id, title: data.product?.title, status: data.product?.status });
      }

      case "update_product": {
        const productId = String(body.product_id ?? body.id ?? "");
        if (!productId) return json({ error: "product_id required" }, 400);

        const updates: Record<string, any> = {};
        if (body.title)       updates.title       = body.title;
        if (body.status)      updates.status      = body.status;
        if (body.description) updates.body_html   = `<p>${body.description}</p>`;
        if (body.tags)        updates.tags        = body.tags;

        const data = await shopReq(`/products/${productId}.json`, "PUT", { product: { id: productId, ...updates } });
        return json({ id: data.product?.id, updated_at: data.product?.updated_at });
      }

      case "list_customers": {
        const qs   = `?limit=${limit}${body.email ? `&email=${encodeURIComponent(body.email)}` : ""}`;
        const data = await shopReq(`/customers.json${qs}`);

        return json({
          customers: (data.customers ?? []).map((c: any) => ({
            id:             c.id,
            email:          c.email,
            name:           `${c.first_name} ${c.last_name}`.trim(),
            orders_count:   c.orders_count,
            total_spent:    c.total_spent,
            created_at:     c.created_at,
            tags:           c.tags,
          })),
        });
      }

      case "get_customer": {
        const customerId = String(body.customer_id ?? body.id ?? "");
        if (!customerId) return json({ error: "customer_id required" }, 400);
        const data = await shopReq(`/customers/${customerId}.json`);
        return json({ customer: data.customer });
      }

      case "get_inventory": {
        const productId = String(body.product_id ?? "");
        if (!productId) return json({ error: "product_id required" }, 400);

        const data = await shopReq(`/products/${productId}/variants.json`);
        return json({
          variants: (data.variants ?? []).map((v: any) => ({
            id:                 v.id,
            title:              v.title,
            price:              v.price,
            sku:                v.sku,
            inventory_quantity: v.inventory_quantity,
            inventory_policy:   v.inventory_policy,
          })),
        });
      }

      case "update_inventory": {
        // Requires inventory_item_id and location_id
        const inventoryItemId = String(body.inventory_item_id ?? "");
        const locationId      = String(body.location_id ?? "");
        const quantity        = Number(body.quantity ?? 0);

        if (!inventoryItemId || !locationId) return json({ error: "inventory_item_id and location_id required" }, 400);

        const data = await shopReq("/inventory_levels/set.json", "POST", {
          inventory_item_id: inventoryItemId,
          location_id:       locationId,
          available:         quantity,
        });
        return json({ inventory_level: data.inventory_level });
      }

      default:
        return json({
          error: `Unknown action: ${action}. Use: list_orders | get_order | list_products | create_product | update_product | list_customers | get_customer | get_inventory | update_inventory`,
        }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-shopify-agent]", message);
    return json({ error: message }, message.includes("not configured") ? 503 : 500);
  }
});
