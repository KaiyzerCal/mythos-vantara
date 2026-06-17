// mavis-sentry-agent
// Sentry error monitoring — list issues, read stack traces, resolve errors,
// and auto-create Linear issues from Sentry alerts.
// Requires: SENTRY_AUTH_TOKEN + SENTRY_ORG (organization slug)
// Optional: SENTRY_PROJECT (default project slug)
//
// Actions: list_issues | get_issue | resolve_issue | ignore_issue | list_events | get_stats

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL      = Deno.env.get("SUPABASE_URL")!;
const SB_SRK      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SENTRY_TOKEN   = Deno.env.get("SENTRY_AUTH_TOKEN") ?? "";
const SENTRY_ORG     = Deno.env.get("SENTRY_ORG") ?? "";
const SENTRY_PROJECT = Deno.env.get("SENTRY_PROJECT") ?? "";
const SENTRY_API     = "https://sentry.io/api/0";

function requireSentry() {
  if (!SENTRY_TOKEN || !SENTRY_ORG) throw new Error("Sentry not configured. Set SENTRY_AUTH_TOKEN and SENTRY_ORG in Supabase secrets.");
}

async function sReq(path: string, method = "GET", body?: unknown): Promise<any> {
  requireSentry();
  const res = await fetch(`${SENTRY_API}${path}`, {
    method,
    headers: { "Authorization": `Bearer ${SENTRY_TOKEN}`, "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return { success: true };
  const data = await res.json();
  if (!res.ok) throw new Error(`Sentry error (${res.status}): ${data.detail ?? JSON.stringify(data).slice(0, 200)}`);
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

    const body    = await req.json().catch(() => ({}));
    const action  = String(body.action ?? "");
    const project = String(body.project ?? SENTRY_PROJECT);

    switch (action) {
      case "list_issues": {
        const limit  = Math.min(Number(body.limit ?? 25), 100);
        const query  = String(body.query ?? "is:unresolved");
        const proj   = project ? `/projects/${SENTRY_ORG}/${project}/issues/` : `/organizations/${SENTRY_ORG}/issues/`;
        const qs     = `?query=${encodeURIComponent(query)}&limit=${limit}&sort=${body.sort ?? "date"}`;

        const data = await sReq(`${proj}${qs}`);

        return json({
          issues: (Array.isArray(data) ? data : []).map((i: any) => ({
            id:         i.id,
            title:      i.title,
            culprit:    i.culprit,
            status:     i.status,
            level:      i.level,
            count:      i.count,
            user_count: i.userCount,
            first_seen: i.firstSeen,
            last_seen:  i.lastSeen,
            permalink:  i.permalink,
            short_id:   i.shortId,
          })),
        });
      }

      case "get_issue": {
        const issueId = String(body.issue_id ?? body.id ?? "");
        if (!issueId) return json({ error: "issue_id required" }, 400);

        const [issue, events] = await Promise.all([
          sReq(`/issues/${issueId}/`),
          sReq(`/issues/${issueId}/events/?limit=1&full=true`),
        ]);

        const latestEvent = Array.isArray(events) ? events[0] : events?.data?.[0];
        const stacktrace = latestEvent?.entries?.find((e: any) => e.type === "exception")
          ?.data?.values?.[0]?.stacktrace?.frames?.slice(-5) ?? [];

        return json({
          id:         issue.id,
          short_id:   issue.shortId,
          title:      issue.title,
          culprit:    issue.culprit,
          status:     issue.status,
          level:      issue.level,
          count:      issue.count,
          first_seen: issue.firstSeen,
          last_seen:  issue.lastSeen,
          permalink:  issue.permalink,
          tags:       issue.tags?.slice(0, 10),
          stacktrace: stacktrace.map((f: any) => ({
            file:     f.filename,
            function: f.function,
            line:     f.lineNo,
            context:  f.context?.map((c: any) => c[1]).join("\n"),
          })),
        });
      }

      case "resolve_issue": {
        const issueId = String(body.issue_id ?? body.id ?? "");
        if (!issueId) return json({ error: "issue_id required" }, 400);

        await sReq(`/issues/${issueId}/`, "PUT", { status: "resolved" });
        return json({ resolved: true, issue_id: issueId });
      }

      case "ignore_issue": {
        const issueId     = String(body.issue_id ?? body.id ?? "");
        const ignoreDays  = Number(body.days ?? 7);
        if (!issueId) return json({ error: "issue_id required" }, 400);

        await sReq(`/issues/${issueId}/`, "PUT", {
          status: "ignored",
          statusDetails: ignoreDays ? { ignoreUntil: new Date(Date.now() + ignoreDays * 86_400_000).toISOString() } : {},
        });
        return json({ ignored: true, issue_id: issueId, until_days: ignoreDays });
      }

      case "list_events": {
        const issueId = String(body.issue_id ?? body.id ?? "");
        if (!issueId) return json({ error: "issue_id required" }, 400);

        const limit = Math.min(Number(body.limit ?? 10), 100);
        const data  = await sReq(`/issues/${issueId}/events/?limit=${limit}&full=${body.full ? "true" : "false"}`);

        return json({
          events: (Array.isArray(data) ? data : data.data ?? []).map((e: any) => ({
            id:          e.id,
            event_id:    e.eventID,
            datetime:    e.dateCreated,
            user:        e.user?.email ?? e.user?.username,
            environment: e.tags?.find((t: any) => t.key === "environment")?.value,
            release:     e.release,
          })),
        });
      }

      case "get_stats": {
        // Organization or project stats
        const proj = project ? `/projects/${SENTRY_ORG}/${project}/stats/` : `/organizations/${SENTRY_ORG}/stats/`;
        const data = await sReq(`${proj}?stat=${body.stat ?? "received"}&since=${Math.floor((Date.now() - 7 * 86_400_000) / 1000)}`);
        return json({ stats: data, stat: body.stat ?? "received" });
      }

      case "create_linear_issue": {
        // Fetch Sentry issue and create a Linear issue from it
        const issueId = String(body.issue_id ?? body.id ?? "");
        const teamId  = String(body.linear_team_id ?? "");
        if (!issueId || !teamId) return json({ error: "issue_id and linear_team_id required" }, 400);

        const issue   = await sReq(`/issues/${issueId}/`);
        const linearRes = await fetch(`${SB_URL}/functions/v1/mavis-linear-agent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SB_SRK}` },
          body: JSON.stringify({
            action:      "create_issue",
            team_id:     teamId,
            title:       `[Sentry] ${issue.title}`,
            description: `**Sentry Issue:** ${issue.permalink}\n**First seen:** ${issue.firstSeen}\n**Last seen:** ${issue.lastSeen}\n**Count:** ${issue.count} events\n\n${issue.culprit ?? ""}`,
            priority:    issue.level === "error" || issue.level === "fatal" ? "high" : "medium",
          }),
        });
        const linearData = await linearRes.json().catch(() => ({}));

        return json({ sentry_issue: issue.id, linear_issue: linearData, permalink: issue.permalink });
      }

      default:
        return json({
          error: `Unknown action: ${action}. Use: list_issues | get_issue | resolve_issue | ignore_issue | list_events | get_stats | create_linear_issue`,
        }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-sentry-agent]", message);
    return json({ error: message }, message.includes("not configured") ? 503 : 500);
  }
});
