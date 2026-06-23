// mavis-crm-agent
// HubSpot CRM — contacts, companies, deals, notes, pipeline management.
// Requires: HUBSPOT_API_KEY (Private App Token — pat-na1-...)
//
// Actions: create_contact | update_contact | search_contacts | get_contact
//          create_company | create_deal | update_deal | list_deals
//          add_note | log_activity | list_recent

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_SRK  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HS_KEY  = Deno.env.get("HUBSPOT_API_KEY") ?? "";
const HS_API  = "https://api.hubapi.com";

function requireHubSpot() {
  if (!HS_KEY) throw new Error("HubSpot not configured. Set HUBSPOT_API_KEY in Supabase secrets.");
}

async function hsReq(path: string, method = "GET", body?: unknown): Promise<any> {
  requireHubSpot();
  const res = await fetch(`${HS_API}${path}`, {
    method,
    headers: { "Authorization": `Bearer ${HS_KEY}`, "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return { success: true };
  const data = await res.json();
  if (!res.ok) throw new Error(`HubSpot error (${res.status}): ${data.message ?? JSON.stringify(data).slice(0, 200)}`);
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

    switch (action) {
      case "create_contact": {
        const props: Record<string, string> = {};
        if (body.email)      props.email      = String(body.email);
        if (body.first_name) props.firstname  = String(body.first_name);
        if (body.last_name)  props.lastname   = String(body.last_name);
        if (body.phone)      props.phone      = String(body.phone);
        if (body.company)    props.company    = String(body.company);
        if (body.website)    props.website    = String(body.website);
        if (body.notes)      props.notes      = String(body.notes);
        if (body.lifecycle)  props.lifecyclestage = String(body.lifecycle); // subscriber|lead|marketingqualifiedlead|salesqualifiedlead|opportunity|customer|evangelist

        if (!props.email) return json({ error: "email required" }, 400);

        const result = await hsReq("/crm/v3/objects/contacts", "POST", { properties: props });
        return json({ id: result.id, email: result.properties?.email, created_at: result.createdAt });
      }

      case "update_contact": {
        const contactId = String(body.contact_id ?? body.id ?? "");
        if (!contactId) return json({ error: "contact_id required" }, 400);

        const props: Record<string, string> = {};
        const fields = ["email", "firstname", "lastname", "phone", "company", "notes", "lifecyclestage"];
        const mapping: Record<string, string> = { first_name: "firstname", last_name: "lastname", lifecycle: "lifecyclestage" };

        for (const [k, v] of Object.entries(body)) {
          const prop = mapping[k] ?? (fields.includes(k) ? k : null);
          if (prop && v !== undefined) props[prop] = String(v);
        }

        const result = await hsReq(`/crm/v3/objects/contacts/${contactId}`, "PATCH", { properties: props });
        return json({ id: result.id, updated_at: result.updatedAt });
      }

      case "search_contacts": {
        const query = String(body.query ?? body.email ?? "");
        if (!query) return json({ error: "query or email required" }, 400);

        const isEmail = query.includes("@");
        const filterGroups = isEmail
          ? [{ filters: [{ propertyName: "email", operator: "EQ", value: query }] }]
          : [{ filters: [{ propertyName: "firstname", operator: "CONTAINS_TOKEN", value: query }] },
             { filters: [{ propertyName: "lastname",  operator: "CONTAINS_TOKEN", value: query }] },
             { filters: [{ propertyName: "company",   operator: "CONTAINS_TOKEN", value: query }] }];

        const result = await hsReq("/crm/v3/objects/contacts/search", "POST", {
          filterGroups,
          properties: ["email", "firstname", "lastname", "phone", "company", "lifecyclestage", "createdate"],
          limit: Math.min(Number(body.limit ?? 10), 25),
        });

        return json({
          contacts: (result.results ?? []).map((c: any) => ({
            id:        c.id,
            email:     c.properties?.email,
            name:      `${c.properties?.firstname ?? ""} ${c.properties?.lastname ?? ""}`.trim(),
            company:   c.properties?.company,
            lifecycle: c.properties?.lifecyclestage,
            created:   c.properties?.createdate,
          })),
          total: result.total,
        });
      }

      case "get_contact": {
        const contactId = String(body.contact_id ?? body.id ?? "");
        if (!contactId) return json({ error: "contact_id required" }, 400);

        const result = await hsReq(`/crm/v3/objects/contacts/${contactId}?properties=email,firstname,lastname,phone,company,lifecyclestage,notes_last_contacted,num_notes`);
        return json({ id: result.id, properties: result.properties });
      }

      case "create_company": {
        const props: Record<string, string> = {};
        if (body.name)     props.name     = String(body.name);
        if (body.domain)   props.domain   = String(body.domain);
        if (body.industry) props.industry = String(body.industry);
        if (body.phone)    props.phone    = String(body.phone);
        if (body.city)     props.city     = String(body.city);

        if (!props.name) return json({ error: "name required" }, 400);
        const result = await hsReq("/crm/v3/objects/companies", "POST", { properties: props });
        return json({ id: result.id, name: result.properties?.name });
      }

      case "create_deal": {
        const props: Record<string, string | number> = {};
        if (body.name)      props.dealname   = String(body.name);
        if (body.stage)     props.dealstage  = String(body.stage); // appointmentscheduled|qualifiedtobuy|presentationscheduled|decisionmakerboughtin|contractsent|closedwon|closedlost
        if (body.amount)    props.amount     = Number(body.amount);
        if (body.close_date) props.closedate = String(body.close_date);
        if (body.pipeline)  props.pipeline   = String(body.pipeline);

        if (!props.dealname) return json({ error: "name required" }, 400);

        const result = await hsReq("/crm/v3/objects/deals", "POST", { properties: props });

        // Associate with contact if provided
        if (body.contact_id) {
          await hsReq(`/crm/v3/objects/deals/${result.id}/associations/contacts/${body.contact_id}/deal_to_contact`, "PUT").catch(() => {});
        }

        return json({ id: result.id, name: result.properties?.dealname, stage: result.properties?.dealstage });
      }

      case "update_deal": {
        const dealId = String(body.deal_id ?? body.id ?? "");
        if (!dealId) return json({ error: "deal_id required" }, 400);

        const props: Record<string, string | number> = {};
        if (body.stage)      props.dealstage  = String(body.stage);
        if (body.amount)     props.amount     = Number(body.amount);
        if (body.close_date) props.closedate  = String(body.close_date);
        if (body.name)       props.dealname   = String(body.name);

        const result = await hsReq(`/crm/v3/objects/deals/${dealId}`, "PATCH", { properties: props });
        return json({ id: result.id, updated_at: result.updatedAt });
      }

      case "list_deals": {
        const result = await hsReq(
          `/crm/v3/objects/deals?limit=${Math.min(Number(body.limit ?? 20), 50)}&properties=dealname,dealstage,amount,closedate,pipeline`
        );
        return json({
          deals: (result.results ?? []).map((d: any) => ({
            id:     d.id,
            name:   d.properties?.dealname,
            stage:  d.properties?.dealstage,
            amount: d.properties?.amount,
            close:  d.properties?.closedate,
          })),
        });
      }

      case "add_note": {
        const body_text  = String(body.note ?? body.content ?? "");
        const contact_id = String(body.contact_id ?? "");
        if (!body_text)   return json({ error: "note required" }, 400);

        const result = await hsReq("/crm/v3/objects/notes", "POST", {
          properties: {
            hs_note_body:      body_text,
            hs_timestamp:      new Date().toISOString(),
          },
        });

        if (contact_id) {
          await hsReq(`/crm/v3/objects/notes/${result.id}/associations/contacts/${contact_id}/note_to_contact`, "PUT").catch(() => {});
        }

        return json({ id: result.id, created_at: result.createdAt });
      }

      case "list_recent": {
        const objectType = String(body.object_type ?? "contacts");
        const limit      = Math.min(Number(body.limit ?? 10), 25);
        const result     = await hsReq(`/crm/v3/objects/${objectType}?limit=${limit}&properties=email,firstname,lastname,company,dealname,dealstage&sort=-createdate`);
        return json({ results: result.results ?? [], total: result.total });
      }

      default:
        return json({
          error: `Unknown action: ${action}. Use: create_contact | update_contact | search_contacts | get_contact | create_company | create_deal | update_deal | list_deals | add_note | list_recent`,
        }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-crm-agent]", message);
    return json({ error: message }, message.includes("not configured") ? 503 : 500);
  }
});
