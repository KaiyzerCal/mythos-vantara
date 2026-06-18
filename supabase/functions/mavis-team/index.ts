// MAVIS Team — manage teams and shared workspaces.
// Actions: create | invite | list_members | remove_member | get | shared_memory | post_memory

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)
    + "-" + Math.random().toString(36).slice(2, 6);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(SB_URL, SB_KEY);
    const { data: { user }, error } = await sb.auth.getUser(auth.replace("Bearer ", ""));
    if (error || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "get");
    let result: any;

    switch (action) {
      case "create": {
        const name = String(body.name ?? "").trim();
        if (!name) throw new Error("Team name required");
        const slug = slugify(name);

        const { data: team, error: createErr } = await sb.from("mavis_teams").insert({
          owner_id: user.id,
          name,
          slug,
          plan: "starter",
        }).select().single();
        if (createErr) throw new Error(createErr.message);

        // Add owner as member
        await sb.from("mavis_team_members").insert({
          team_id: team.id,
          user_id: user.id,
          role: "owner",
        });

        result = team;
        break;
      }

      case "get": {
        const { data: memberships } = await sb.from("mavis_team_members")
          .select("team_id, role, mavis_teams(*)")
          .eq("user_id", user.id);
        result = { teams: (memberships ?? []).map((m: any) => ({ ...m.mavis_teams, my_role: m.role })) };
        break;
      }

      case "invite": {
        const teamId = String(body.team_id ?? "");
        const inviteEmail = String(body.email ?? "").trim().toLowerCase();
        const role = String(body.role ?? "member");
        if (!teamId || !inviteEmail) throw new Error("team_id and email required");

        // Verify requester is owner/admin
        const { data: membership } = await sb.from("mavis_team_members")
          .select("role").eq("team_id", teamId).eq("user_id", user.id).single();
        if (!membership || !["owner", "admin"].includes(membership.role)) {
          return new Response(JSON.stringify({ error: "Only owners and admins can invite" }), {
            status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Look up the invited user by email
        const { data: invitedUser } = await sb.from("profiles")
          .select("id").eq("email", inviteEmail).single();
        if (!invitedUser) throw new Error(`No MAVIS account found for ${inviteEmail}`);

        const { error: invErr } = await sb.from("mavis_team_members").upsert({
          team_id: teamId,
          user_id: invitedUser.id,
          role,
          invited_by: user.id,
        }, { onConflict: "team_id,user_id" });
        if (invErr) throw new Error(invErr.message);

        result = { invited: inviteEmail, role };
        break;
      }

      case "list_members": {
        const teamId = String(body.team_id ?? "");
        if (!teamId) throw new Error("team_id required");

        const { data: members } = await sb.from("mavis_team_members")
          .select("role, joined_at, user_id, profiles(inscribed_name, full_name, email)")
          .eq("team_id", teamId);
        result = { members: members ?? [] };
        break;
      }

      case "remove_member": {
        const teamId = String(body.team_id ?? "");
        const removeUserId = String(body.user_id ?? "");
        if (!teamId || !removeUserId) throw new Error("team_id and user_id required");

        const { data: membership } = await sb.from("mavis_team_members")
          .select("role").eq("team_id", teamId).eq("user_id", user.id).single();
        if (!membership || !["owner", "admin"].includes(membership.role)) {
          return new Response(JSON.stringify({ error: "Only owners and admins can remove members" }), {
            status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        await sb.from("mavis_team_members").delete().eq("team_id", teamId).eq("user_id", removeUserId);
        result = { removed: removeUserId };
        break;
      }

      case "shared_memory": {
        const teamId = String(body.team_id ?? "");
        const limit = Math.min(Number(body.limit ?? 50), 200);
        if (!teamId) throw new Error("team_id required");

        const { data: memories } = await sb.from("mavis_team_memory")
          .select("*")
          .eq("team_id", teamId)
          .order("created_at", { ascending: false })
          .limit(limit);
        result = { memories: memories ?? [] };
        break;
      }

      case "post_memory": {
        const teamId = String(body.team_id ?? "");
        const content = String(body.content ?? "").trim();
        if (!teamId || !content) throw new Error("team_id and content required");

        const { data: mem } = await sb.from("mavis_team_memory").insert({
          team_id: teamId,
          author_id: user.id,
          role: body.role ?? "user",
          content,
          importance_score: Number(body.importance ?? 5),
          tags: body.tags ?? [],
        }).select().single();
        result = mem;
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[mavis-team]", e.message);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
