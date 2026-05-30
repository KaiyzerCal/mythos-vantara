import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

const ACHIEVEMENTS = [
  // Quests
  { key: "first_quest", title: "First Blood", description: "Complete your first quest", icon: "⚔️", category: "quests",
    check: async (uid: string, sb: any) => { const { count } = await sb.from("quests").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("status", "completed"); return (count ?? 0) >= 1; } },
  { key: "quest_10", title: "Veteran", description: "Complete 10 quests", icon: "🎖️", category: "quests",
    check: async (uid: string, sb: any) => { const { count } = await sb.from("quests").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("status", "completed"); return (count ?? 0) >= 10; } },
  { key: "quest_50", title: "Legend", description: "Complete 50 quests", icon: "🏅", category: "quests",
    check: async (uid: string, sb: any) => { const { count } = await sb.from("quests").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("status", "completed"); return (count ?? 0) >= 50; } },
  // Habits
  { key: "streak_7", title: "Week Warrior", description: "Maintain a 7-day habit streak", icon: "🔥", category: "habits",
    check: async (uid: string, sb: any) => { const { data } = await sb.from("tasks").select("streak").eq("user_id", uid).eq("type", "habit").gte("streak", 7).limit(1); return (data?.length ?? 0) > 0; } },
  { key: "streak_30", title: "Iron Will", description: "Maintain a 30-day habit streak", icon: "💪", category: "habits",
    check: async (uid: string, sb: any) => { const { data } = await sb.from("tasks").select("streak").eq("user_id", uid).eq("type", "habit").gte("streak", 30).limit(1); return (data?.length ?? 0) > 0; } },
  { key: "streak_100", title: "Centurion", description: "100-day streak", icon: "💯", category: "habits",
    check: async (uid: string, sb: any) => { const { data } = await sb.from("tasks").select("streak").eq("user_id", uid).eq("type", "habit").gte("streak", 100).limit(1); return (data?.length ?? 0) > 0; } },
  // Finance
  { key: "first_revenue", title: "First Dollar", description: "Log your first revenue", icon: "💰", category: "finance",
    check: async (uid: string, sb: any) => { const { count } = await sb.from("mavis_revenue").select("id", { count: "exact", head: true }).eq("user_id", uid); return (count ?? 0) >= 1; } },
  { key: "revenue_1k", title: "Four Figures", description: "Log $1,000 in total revenue", icon: "💵", category: "finance",
    check: async (uid: string, sb: any) => { const { data } = await sb.from("mavis_revenue").select("amount").eq("user_id", uid); const total = (data ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0); return total >= 1000; } },
  { key: "revenue_10k", title: "Five Figures", description: "Log $10,000 in total revenue", icon: "💸", category: "finance",
    check: async (uid: string, sb: any) => { const { data } = await sb.from("mavis_revenue").select("amount").eq("user_id", uid); const total = (data ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0); return total >= 10000; } },
  // Knowledge
  { key: "vault_10", title: "Archivist", description: "Add 10 notes to the Vault", icon: "📚", category: "knowledge",
    check: async (uid: string, sb: any) => { const { count } = await sb.from("mavis_notes").select("id", { count: "exact", head: true }).eq("user_id", uid); return (count ?? 0) >= 10; } },
  { key: "vault_100", title: "Scholar", description: "100 vault notes", icon: "🎓", category: "knowledge",
    check: async (uid: string, sb: any) => { const { count } = await sb.from("mavis_notes").select("id", { count: "exact", head: true }).eq("user_id", uid); return (count ?? 0) >= 100; } },
  // Social
  { key: "first_post", title: "Signal Sent", description: "Publish your first social post as Nora", icon: "📡", category: "social",
    check: async (uid: string, sb: any) => { const { count } = await sb.from("mavis_social_posts").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("status", "posted"); return (count ?? 0) >= 1; } },
  { key: "post_50", title: "Broadcaster", description: "50 social posts", icon: "📢", category: "social",
    check: async (uid: string, sb: any) => { const { count } = await sb.from("mavis_social_posts").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("status", "posted"); return (count ?? 0) >= 50; } },
  // Bond
  { key: "bond_50", title: "Trusted", description: "Reach Bond Level 50 with MAVIS", icon: "🤝", category: "bond",
    check: async (uid: string, sb: any) => { const { data } = await sb.from("mavis_bond").select("bond_level").eq("user_id", uid).single(); return (data?.bond_level ?? 0) >= 50; } },
  { key: "bond_100", title: "Sovereign Bond", description: "Maximum bond with MAVIS", icon: "👑", category: "bond",
    check: async (uid: string, sb: any) => { const { data } = await sb.from("mavis_bond").select("bond_level").eq("user_id", uid).single(); return (data?.bond_level ?? 0) >= 100; } },
  // Special
  { key: "all_platforms", title: "Omni-Signal", description: "Post to 4+ social platforms", icon: "🌐", category: "special",
    check: async (uid: string, sb: any) => { const { data } = await sb.from("mavis_social_posts").select("platform").eq("user_id", uid).eq("status", "posted"); const platforms = new Set((data ?? []).map((p: any) => p.platform)); return platforms.size >= 4; } },
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { user_id, trigger, data } = await req.json();

    if (!user_id) {
      return new Response(JSON.stringify({ error: "user_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch already-unlocked achievement keys for this user
    const { data: existingRows, error: fetchError } = await sb
      .from("achievements")
      .select("achievement_key")
      .eq("user_id", user_id);

    if (fetchError) {
      console.error("Error fetching existing achievements:", fetchError);
      return new Response(JSON.stringify({ error: fetchError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const alreadyUnlocked = new Set((existingRows ?? []).map((r: any) => r.achievement_key));

    const newlyUnlocked: string[] = [];

    // Check each achievement not yet unlocked
    for (const achievement of ACHIEVEMENTS) {
      if (alreadyUnlocked.has(achievement.key)) continue;

      try {
        const passed = await achievement.check(user_id, sb);
        if (passed) {
          const { error: insertError } = await sb.from("achievements").insert({
            user_id,
            achievement_key: achievement.key,
            title: achievement.title,
            description: achievement.description,
            icon: achievement.icon,
            category: achievement.category,
            trigger,
            unlocked_at: new Date().toISOString(),
          });

          if (insertError) {
            console.error(`Error inserting achievement ${achievement.key}:`, insertError);
          } else {
            newlyUnlocked.push(achievement.key);
          }
        }
      } catch (checkError) {
        console.error(`Error checking achievement ${achievement.key}:`, checkError);
      }
    }

    return new Response(JSON.stringify({ unlocked: newlyUnlocked }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
