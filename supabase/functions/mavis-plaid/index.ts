// mavis-plaid — Plaid Link integration
// Actions: create_link_token | exchange_token | sync_transactions | get_accounts
// Uses Plaid sandbox/development/production depending on PLAID_ENV env var.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const PLAID_CLIENT_ID = Deno.env.get("PLAID_CLIENT_ID") ?? "";
const PLAID_SECRET    = Deno.env.get("PLAID_SECRET") ?? "";
const PLAID_ENV       = Deno.env.get("PLAID_ENV") ?? "sandbox";
const PLAID_BASE      = `https://${PLAID_ENV}.plaid.com`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

async function plaid(endpoint: string, body: Record<string, unknown>) {
  const res = await fetch(`${PLAID_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: PLAID_CLIENT_ID,
      secret: PLAID_SECRET,
      ...body,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error_message ?? `Plaid ${endpoint} failed: ${res.status}`);
  }
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
    }

    const { action, ...params } = await req.json() as { action: string; [k: string]: unknown };

    // ── create_link_token ──────────────────────────────────────
    if (action === "create_link_token") {
      const data = await plaid("/link/token/create", {
        user: { client_user_id: user.id },
        client_name: "MAVIS / Vantara",
        products: ["transactions"],
        country_codes: ["US", "CA", "GB"],
        language: "en",
      });
      return new Response(JSON.stringify({ link_token: data.link_token }), {
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    // ── exchange_token ─────────────────────────────────────────
    if (action === "exchange_token") {
      const { public_token, institution_name } = params as { public_token: string; institution_name?: string };
      if (!public_token) return new Response(JSON.stringify({ error: "public_token required" }), { status: 400, headers: CORS });

      const data = await plaid("/item/public_token/exchange", { public_token });
      const { access_token, item_id } = data;

      // Fetch accounts
      const accountsData = await plaid("/accounts/get", { access_token });

      const { error: upsertErr } = await supabase.from("plaid_items").upsert({
        user_id:          user.id,
        item_id,
        access_token,
        institution_name: institution_name ?? "Unknown Bank",
        status:           "active",
      }, { onConflict: "item_id" });

      if (upsertErr) throw new Error(upsertErr.message);

      // Persist accounts
      const accounts = (accountsData.accounts ?? []).map((a: any) => ({
        user_id:       user.id,
        item_id,
        account_id:    a.account_id,
        name:          a.name,
        official_name: a.official_name ?? null,
        type:          a.type,
        subtype:       a.subtype ?? null,
        mask:          a.mask ?? null,
        current_bal:   a.balances?.current ?? null,
        available_bal: a.balances?.available ?? null,
        currency:      a.balances?.iso_currency_code ?? "USD",
      }));

      if (accounts.length > 0) {
        await supabase.from("plaid_accounts").upsert(accounts, { onConflict: "account_id" });
      }

      return new Response(JSON.stringify({ ok: true, item_id, account_count: accounts.length }), {
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    // ── sync_transactions ──────────────────────────────────────
    if (action === "sync_transactions") {
      const { item_id } = params as { item_id?: string };

      // Get access token(s)
      const q = supabase.from("plaid_items").select("item_id, access_token, institution_name").eq("user_id", user.id).eq("status", "active");
      if (item_id) q.eq("item_id", item_id);
      const { data: items, error: itemsErr } = await q;
      if (itemsErr) throw new Error(itemsErr.message);
      if (!items?.length) return new Response(JSON.stringify({ ok: true, synced: 0 }), { headers: CORS });

      let totalSynced = 0;

      for (const item of items) {
        // Get cursor
        const { data: cursorRow } = await supabase
          .from("plaid_sync_cursors")
          .select("cursor")
          .eq("item_id", item.item_id)
          .maybeSingle();

        let cursor: string | undefined = cursorRow?.cursor ?? undefined;
        let hasMore = true;
        const txnsToUpsert: Record<string, unknown>[] = [];

        while (hasMore) {
          const syncBody: Record<string, unknown> = { access_token: item.access_token };
          if (cursor) syncBody.cursor = cursor;

          const syncData = await plaid("/transactions/sync", syncBody);
          cursor  = syncData.next_cursor;
          hasMore = syncData.has_more;

          for (const tx of (syncData.added ?? [])) {
            txnsToUpsert.push({
              user_id:        user.id,
              item_id:        item.item_id,
              transaction_id: tx.transaction_id,
              account_id:     tx.account_id,
              name:           tx.name,
              merchant_name:  tx.merchant_name ?? null,
              amount:         Math.abs(tx.amount),
              currency:       tx.iso_currency_code ?? "USD",
              date:           tx.date,
              category:       (tx.personal_finance_category?.primary ?? tx.category?.[0] ?? "general").toLowerCase().replace(/ /g, "_"),
              pending:        tx.pending ?? false,
              raw:            tx,
            });
          }

          for (const tx of (syncData.modified ?? [])) {
            txnsToUpsert.push({
              user_id:        user.id,
              item_id:        item.item_id,
              transaction_id: tx.transaction_id,
              account_id:     tx.account_id,
              name:           tx.name,
              merchant_name:  tx.merchant_name ?? null,
              amount:         Math.abs(tx.amount),
              currency:       tx.iso_currency_code ?? "USD",
              date:           tx.date,
              category:       (tx.personal_finance_category?.primary ?? tx.category?.[0] ?? "general").toLowerCase().replace(/ /g, "_"),
              pending:        tx.pending ?? false,
              raw:            tx,
            });
          }

          for (const removed of (syncData.removed ?? [])) {
            await supabase.from("plaid_transactions").delete().eq("transaction_id", removed.transaction_id);
          }
        }

        if (txnsToUpsert.length > 0) {
          await supabase.from("plaid_transactions").upsert(txnsToUpsert, { onConflict: "transaction_id" });

          // Mirror to mavis_expenses
          const expenses = txnsToUpsert.map((tx) => ({
            user_id:      user.id,
            description:  String(tx.merchant_name ?? tx.name),
            amount:       Number(tx.amount),
            currency:     String(tx.currency),
            category:     String(tx.category),
            source:       `plaid:${item.institution_name}`,
            expense_date: String(tx.date),
          }));
          await supabase.from("mavis_expenses").upsert(expenses, { onConflict: "user_id,description,expense_date,amount" }).catch(() => {});
        }

        // Save cursor
        await supabase.from("plaid_sync_cursors").upsert({ item_id: item.item_id, cursor }, { onConflict: "item_id" });
        totalSynced += txnsToUpsert.length;
      }

      return new Response(JSON.stringify({ ok: true, synced: totalSynced }), {
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    // ── get_accounts ───────────────────────────────────────────
    if (action === "get_accounts") {
      const { data: items } = await supabase
        .from("plaid_items")
        .select("item_id, institution_name, status")
        .eq("user_id", user.id);

      const { data: accounts } = await supabase
        .from("plaid_accounts")
        .select("*")
        .eq("user_id", user.id);

      return new Response(JSON.stringify({ items: items ?? [], accounts: accounts ?? [] }), {
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: CORS });
  } catch (err) {
    console.error("[mavis-plaid]", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: CORS });
  }
});
