// mavis-linear-agent
// Linear project management — issues, projects, cycles, comments via GraphQL API.
// Requires: LINEAR_API_KEY (Personal API Key from Linear settings)
//
// Actions: create_issue | update_issue | get_issue | list_issues
//          add_comment | list_projects | get_teams | list_cycles

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_SRK      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LINEAR_KEY  = Deno.env.get("LINEAR_API_KEY") ?? "";
const LINEAR_API  = "https://api.linear.app/graphql";

function requireLinear() {
  if (!LINEAR_KEY) throw new Error("Linear not configured. Set LINEAR_API_KEY in Supabase secrets.");
}

async function gql(query: string, variables: Record<string, unknown> = {}): Promise<any> {
  requireLinear();
  const res = await fetch(LINEAR_API, {
    method: "POST",
    headers: { "Authorization": LINEAR_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (data.errors) throw new Error(`Linear GraphQL error: ${data.errors[0]?.message}`);
  return data.data;
}

// Resolve priority label to number (0=No, 1=Urgent, 2=High, 3=Medium, 4=Low)
function priorityNum(p?: string): number {
  const map: Record<string, number> = { urgent: 1, high: 2, medium: 3, normal: 3, low: 4, no_priority: 0 };
  return map[String(p ?? "medium").toLowerCase()] ?? 3;
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
      case "get_teams": {
        const data = await gql(`{ teams { nodes { id name key description } } }`);
        return json({ teams: data.teams.nodes });
      }

      case "list_projects": {
        const teamId = body.team_id ? String(body.team_id) : undefined;
        const filter = teamId ? `, filter: { team: { id: { eq: "${teamId}" } } }` : "";
        const data   = await gql(`{ projects(first: 25${filter}) { nodes { id name description state { name } } } }`);
        return json({ projects: data.projects.nodes });
      }

      case "create_issue": {
        const title  = String(body.title ?? "");
        const teamId = String(body.team_id ?? "");
        if (!title || !teamId) return json({ error: "title and team_id required" }, 400);

        const data = await gql(`
          mutation CreateIssue($input: IssueCreateInput!) {
            issueCreate(input: $input) {
              success
              issue { id identifier title url state { name } priority }
            }
          }
        `, {
          input: {
            title,
            teamId,
            description:   body.description,
            priority:      priorityNum(body.priority),
            projectId:     body.project_id,
            assigneeId:    body.assignee_id,
            labelIds:      body.label_ids,
            dueDate:       body.due_date,
            estimate:      body.estimate ? Number(body.estimate) : undefined,
          },
        });

        const issue = data.issueCreate.issue;
        return json({ id: issue.id, identifier: issue.identifier, title: issue.title, url: issue.url, state: issue.state?.name });
      }

      case "update_issue": {
        const issueId = String(body.issue_id ?? body.id ?? "");
        if (!issueId) return json({ error: "issue_id required" }, 400);

        const input: Record<string, unknown> = {};
        if (body.title)       input.title       = body.title;
        if (body.description) input.description = body.description;
        if (body.priority)    input.priority    = priorityNum(body.priority);
        if (body.state_id)    input.stateId     = body.state_id;
        if (body.assignee_id) input.assigneeId  = body.assignee_id;
        if (body.due_date)    input.dueDate     = body.due_date;
        if (body.estimate)    input.estimate    = Number(body.estimate);

        const data = await gql(`
          mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
            issueUpdate(id: $id, input: $input) {
              success
              issue { id identifier title url state { name } }
            }
          }
        `, { id: issueId, input });

        const issue = data.issueUpdate.issue;
        return json({ id: issue.id, identifier: issue.identifier, state: issue.state?.name, url: issue.url });
      }

      case "get_issue": {
        const issueId = String(body.issue_id ?? body.id ?? "");
        if (!issueId) return json({ error: "issue_id required" }, 400);

        const data = await gql(`
          query GetIssue($id: String!) {
            issue(id: $id) {
              id identifier title description url priority
              state { name } assignee { name email }
              comments { nodes { id body createdAt user { name } } }
            }
          }
        `, { id: issueId });

        return json({ issue: data.issue });
      }

      case "list_issues": {
        const teamId  = body.team_id ? String(body.team_id) : undefined;
        const limit   = Math.min(Number(body.limit ?? 20), 50);
        const filter  = teamId ? `, filter: { team: { id: { eq: "${teamId}" } } }` : "";

        const data = await gql(`
          query ListIssues {
            issues(first: ${limit}${filter}, orderBy: updatedAt) {
              nodes {
                id identifier title url priority
                state { name } assignee { name }
                createdAt updatedAt
              }
            }
          }
        `);

        return json({ issues: data.issues.nodes });
      }

      case "add_comment": {
        const issueId = String(body.issue_id ?? body.id ?? "");
        const comment = String(body.comment ?? body.body ?? "");
        if (!issueId || !comment) return json({ error: "issue_id and comment required" }, 400);

        const data = await gql(`
          mutation CreateComment($input: CommentCreateInput!) {
            commentCreate(input: $input) {
              success
              comment { id body createdAt }
            }
          }
        `, { input: { issueId, body: comment } });

        return json({ id: data.commentCreate.comment?.id, created_at: data.commentCreate.comment?.createdAt });
      }

      case "list_cycles": {
        const teamId = String(body.team_id ?? "");
        if (!teamId) return json({ error: "team_id required" }, 400);

        const data = await gql(`
          query ListCycles($teamId: String!) {
            team(id: $teamId) {
              cycles(first: 10, orderBy: startsAt) {
                nodes { id number name startsAt endsAt completedAt progress }
              }
            }
          }
        `, { teamId });

        return json({ cycles: data.team?.cycles.nodes ?? [] });
      }

      default:
        return json({
          error: `Unknown action: ${action}. Use: get_teams | list_projects | create_issue | update_issue | get_issue | list_issues | add_comment | list_cycles`,
        }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-linear-agent]", message);
    return json({ error: message }, message.includes("not configured") ? 503 : 500);
  }
});
