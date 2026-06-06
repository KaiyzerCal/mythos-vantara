import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

const ACHIEVEMENTS = [
  // ── Quests ────────────────────────────────────────────────────────────────
  { key: "first_quest", title: "First Blood", description: "Complete your first quest", icon: "⚔️", category: "quests",
    check: async (uid: string, sb: any) => { const { count } = await sb.from("quests").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("status", "completed"); return (count ?? 0) >= 1; } },
  { key: "quest_10", title: "Veteran", description: "Complete 10 quests", icon: "🎖️", category: "quests",
    check: async (uid: string, sb: any) => { const { count } = await sb.from("quests").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("status", "completed"); return (count ?? 0) >= 10; } },
  { key: "quest_50", title: "Legend", description: "Complete 50 quests", icon: "🏅", category: "quests",
    check: async (uid: string, sb: any) => { const { count } = await sb.from("quests").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("status", "completed"); return (count ?? 0) >= 50; } },

  // ── Habits ────────────────────────────────────────────────────────────────
  { key: "streak_7", title: "Week Warrior", description: "Maintain a 7-day habit streak", icon: "🔥", category: "habits",
    check: async (uid: string, sb: any) => { const { data } = await sb.from("tasks").select("streak").eq("user_id", uid).eq("type", "habit").gte("streak", 7).limit(1); return (data?.length ?? 0) > 0; } },
  { key: "streak_30", title: "Iron Will", description: "Maintain a 30-day habit streak", icon: "💪", category: "habits",
    check: async (uid: string, sb: any) => { const { data } = await sb.from("tasks").select("streak").eq("user_id", uid).eq("type", "habit").gte("streak", 30).limit(1); return (data?.length ?? 0) > 0; } },
  { key: "streak_100", title: "Centurion", description: "100-day streak", icon: "💯", category: "habits",
    check: async (uid: string, sb: any) => { const { data } = await sb.from("tasks").select("streak").eq("user_id", uid).eq("type", "habit").gte("streak", 100).limit(1); return (data?.length ?? 0) > 0; } },

  // ── Habits: Journal ────────────────────────────────────────────────────────
  { key: "journal_first", title: "First Entry", description: "Write your first journal entry", icon: "📓", category: "habits",
    check: async (uid: string, sb: any) => { const { count } = await sb.from("journal_entries").select("id", { count: "exact", head: true }).eq("user_id", uid); return (count ?? 0) >= 1; } },
  { key: "journal_7", title: "Week in Review", description: "Write 7 journal entries", icon: "📖", category: "habits",
    check: async (uid: string, sb: any) => { const { count } = await sb.from("journal_entries").select("id", { count: "exact", head: true }).eq("user_id", uid); return (count ?? 0) >= 7; } },
  { key: "journal_30", title: "Chronicle", description: "Write 30 journal entries", icon: "📚", category: "habits",
    check: async (uid: string, sb: any) => { const { count } = await sb.from("journal_entries").select("id", { count: "exact", head: true }).eq("user_id", uid); return (count ?? 0) >= 30; } },

  // ── Finance ───────────────────────────────────────────────────────────────
  { key: "first_revenue", title: "First Dollar", description: "Log your first revenue", icon: "💰", category: "finance",
    check: async (uid: string, sb: any) => { const { count } = await sb.from("mavis_revenue").select("id", { count: "exact", head: true }).eq("user_id", uid); return (count ?? 0) >= 1; } },
  { key: "revenue_1k", title: "Four Figures", description: "Log $1,000 in total revenue", icon: "💵", category: "finance",
    check: async (uid: string, sb: any) => { const { data } = await sb.from("mavis_revenue").select("amount").eq("user_id", uid); const total = (data ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0); return total >= 1000; } },
  { key: "revenue_10k", title: "Five Figures", description: "Log $10,000 in total revenue", icon: "💸", category: "finance",
    check: async (uid: string, sb: any) => { const { data } = await sb.from("mavis_revenue").select("amount").eq("user_id", uid); const total = (data ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0); return total >= 10000; } },

  // ── Knowledge ─────────────────────────────────────────────────────────────
  { key: "vault_10", title: "Archivist", description: "Add 10 notes to the Vault", icon: "📚", category: "knowledge",
    check: async (uid: string, sb: any) => { const { count } = await sb.from("mavis_notes").select("id", { count: "exact", head: true }).eq("user_id", uid); return (count ?? 0) >= 10; } },
  { key: "vault_100", title: "Scholar", description: "100 vault notes", icon: "🎓", category: "knowledge",
    check: async (uid: string, sb: any) => { const { count } = await sb.from("mavis_notes").select("id", { count: "exact", head: true }).eq("user_id", uid); return (count ?? 0) >= 100; } },
  { key: "vault_25", title: "Codex Builder", description: "Add 25 notes to the Knowledge Graph", icon: "🗺️", category: "knowledge",
    check: async (uid: string, sb: any) => { const { count } = await sb.from("mavis_notes").select("id", { count: "exact", head: true }).eq("user_id", uid); return (count ?? 0) >= 25; } },

  // ── Social ────────────────────────────────────────────────────────────────
  { key: "first_post", title: "Signal Sent", description: "Publish your first social post as Nora", icon: "📡", category: "social",
    check: async (uid: string, sb: any) => { const { count } = await sb.from("mavis_social_posts").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("status", "posted"); return (count ?? 0) >= 1; } },
  { key: "post_50", title: "Broadcaster", description: "50 social posts", icon: "📢", category: "social",
    check: async (uid: string, sb: any) => { const { count } = await sb.from("mavis_social_posts").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("status", "posted"); return (count ?? 0) >= 50; } },

  // ── Bond ──────────────────────────────────────────────────────────────────
  { key: "bond_25", title: "Familiar", description: "Reach Bond Level 25 with MAVIS", icon: "🌟", category: "bond",
    check: async (uid: string, sb: any) => { const { data } = await sb.from("mavis_bond").select("bond_level").eq("user_id", uid).single(); return (data?.bond_level ?? 0) >= 25; } },
  { key: "bond_50", title: "Trusted", description: "Reach Bond Level 50 with MAVIS", icon: "🤝", category: "bond",
    check: async (uid: string, sb: any) => { const { data } = await sb.from("mavis_bond").select("bond_level").eq("user_id", uid).single(); return (data?.bond_level ?? 0) >= 50; } },
  { key: "bond_100", title: "Sovereign Bond", description: "Maximum bond with MAVIS", icon: "👑", category: "bond",
    check: async (uid: string, sb: any) => { const { data } = await sb.from("mavis_bond").select("bond_level").eq("user_id", uid).single(); return (data?.bond_level ?? 0) >= 100; } },
  { key: "bond_100_messages", title: "Hundred Turns", description: "Complete 100 exchanges with MAVIS", icon: "💬", category: "bond",
    check: async (uid: string, sb: any) => { const { data } = await sb.from("mavis_bond").select("interaction_count").eq("user_id", uid).single(); return (data?.interaction_count ?? 0) >= 100; } },
  { key: "bond_500_messages", title: "Bonded Intelligence", description: "Complete 500 exchanges with MAVIS", icon: "🧠", category: "bond",
    check: async (uid: string, sb: any) => { const { data } = await sb.from("mavis_bond").select("interaction_count").eq("user_id", uid).single(); return (data?.interaction_count ?? 0) >= 500; } },

  // ── Special ───────────────────────────────────────────────────────────────
  { key: "all_platforms", title: "Omni-Signal", description: "Post to 4+ social platforms", icon: "🌐", category: "special",
    check: async (uid: string, sb: any) => { const { data } = await sb.from("mavis_social_posts").select("platform").eq("user_id", uid).eq("status", "posted"); const platforms = new Set((data ?? []).map((p: any) => p.platform)); return platforms.size >= 4; } },
  { key: "skill_5", title: "Skill Collector", description: "Add 5 skills to your skill tree", icon: "⚡", category: "special",
    check: async (uid: string, sb: any) => { const { count } = await sb.from("skills").select("id", { count: "exact", head: true }).eq("user_id", uid); return (count ?? 0) >= 5; } },
  { key: "skill_20", title: "Polymath", description: "Build a skill tree of 20+ skills", icon: "🌳", category: "special",
    check: async (uid: string, sb: any) => { const { count } = await sb.from("skills").select("id", { count: "exact", head: true }).eq("user_id", uid); return (count ?? 0) >= 20; } },
  { key: "design_studio_first", title: "Architect", description: "Generate your first website with Design Studio", icon: "🏗️", category: "special",
    check: async (uid: string, sb: any) => { const { count } = await sb.from("generated_websites").select("id", { count: "exact", head: true }).eq("user_id", uid); return (count ?? 0) >= 1; } },
  { key: "so_template_first", title: "Standing Order", description: "Save your first standing order template", icon: "📋", category: "special",
    check: async (uid: string, sb: any) => { const { count } = await sb.from("standing_order_templates").select("id", { count: "exact", head: true }).eq("user_id", uid); return (count ?? 0) >= 1; } },
  { key: "playbook_activated", title: "Domain Expert", description: "Use a playbook procedure", icon: "🎯", category: "special",
    check: async (uid: string, sb: any) => { const { count } = await sb.from("mavis_playbooks").select("id", { count: "exact", head: true }).gt("usage_count", 0).or(`user_id.eq.${uid},is_system.eq.true`); return (count ?? 0) >= 1; } },
  { key: "goal_engine_first", title: "Autonomous", description: "Set your first autonomous goal for MAVIS to execute", icon: "🤖", category: "special",
    check: async (uid: string, sb: any) => { const { count } = await sb.from("mavis_goals").select("id", { count: "exact", head: true }).eq("user_id", uid); return (count ?? 0) >= 1; } },
  { key: "form_unlocked", title: "Awakening", description: "Unlock your first transformation form", icon: "🔱", category: "special",
    check: async (uid: string, sb: any) => { const { count } = await sb.from("transformations").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("unlocked", true); return (count ?? 0) >= 1; } },
  { key: "council_formed", title: "War Council", description: "Add 3+ members to your Strategic Council", icon: "⚜️", category: "special",
    check: async (uid: string, sb: any) => { const { count } = await sb.from("councils").select("id", { count: "exact", head: true }).eq("user_id", uid); return (count ?? 0) >= 3; } },
  { key: "navi_forged", title: "Persona Architect", description: "Forge your first NAVI persona", icon: "✨", category: "special",
    check: async (uid: string, sb: any) => { const { count } = await sb.from("personas").select("id", { count: "exact", head: true }).eq("user_id", uid); return (count ?? 0) >= 1; } },
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { user_id, trigger, data } = await req.json();

    if (!user_id) {
      return new Response(JSON.stringify({ error: "user_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: existingRows, error: fetchError } = await sb
      .from("achievements")
      .select("achievement_key")
      .eq("user_id", user_id);

    if (fetchError) {
      return new Response(JSON.stringify({ error: fetchError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const alreadyUnlocked = new Set((existingRows ?? []).map((r: any) => r.achievement_key));
    const newlyUnlocked: Array<{ key: string; title: string; icon: string; category: string }> = [];

    for (const achievement of ACHIEVEMENTS) {
      if (alreadyUnlocked.has(achievement.key)) continue;

      try {
        const passed = await achievement.check(user_id, sb);
        if (passed) {
          const { error: insertError } = await sb.from("achievements").insert({
            user_id,
            achievement_key: achievement.key,
            title:           achievement.title,
            description:     achievement.description,
            icon:            achievement.icon,
            category:        achievement.category,
            unlocked_at:     new Date().toISOString(),
          });

          if (!insertError) {
            newlyUnlocked.push({ key: achievement.key, title: achievement.title, icon: achievement.icon, category: achievement.category });
          }
        }
      } catch (checkError) {
        console.error(`Error checking achievement ${achievement.key}:`, checkError);
      }
    }

    // Award XP for newly unlocked achievements (non-blocking)
    if (newlyUnlocked.length > 0) {
      const XP_PER_ACHIEVEMENT = 100;
      const totalXp = newlyUnlocked.length * XP_PER_ACHIEVEMENT;
      try {
        await sb.from("activity_log").insert({
          user_id,
          event_type:  "achievement_unlocked",
          xp_amount:   totalXp,
          description: `Unlocked ${newlyUnlocked.length} achievement(s): ${newlyUnlocked.map(a => a.title).join(", ")}`,
          metadata:    { achievements: newlyUnlocked },
        });
        // Update profile XP
        const { data: profile } = await sb.from("profiles").select("xp").eq("id", user_id).single();
        if (profile) {
          await sb.from("profiles").update({ xp: (profile.xp ?? 0) + totalXp }).eq("id", user_id);
        }
      } catch { /* non-critical */ }
    }

    return new Response(JSON.stringify({ unlocked: newlyUnlocked }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
