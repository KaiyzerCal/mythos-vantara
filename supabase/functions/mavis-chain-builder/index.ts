// MAVIS Chain Builder — AI-powered quest and skill chain linking.
// Uses Claude to detect correlating quests/skills and group them into
// ordered progression chains. Also supports manual chain CRUD.
//
// Actions:
//   auto_link_quest_chains  — AI analyzes all quests → creates chains
//   auto_link_skill_chains  — AI analyzes all skills → creates chains
//   get_quest_chains        — fetch all chains + items for a user
//   get_skill_chains        — fetch all chains + items for a user
//   create_quest_chain      — manual chain creation
//   create_skill_chain      — manual chain creation
//   update_quest_chain      — update chain title/description/category
//   update_skill_chain      — update chain title/description/category
//   delete_quest_chain      — delete chain (cascade deletes items)
//   delete_skill_chain      — delete chain
//   add_quest_to_chain      — add a quest to an existing chain
//   add_skill_to_chain      — add a skill to an existing chain
//   remove_from_chain       — remove an item by id (quest or skill chain item)
//
// Requires: ANTHROPIC_API_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SB_URL  = Deno.env.get("SUPABASE_URL")!;
const SB_SRK  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLAUDE_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function callClaude(system: string, user: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": CLAUDE_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 8192,
      system,
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(90_000), // 82 quests / 86 skills = large prompt; Haiku needs 40-70s
  });
  if (!res.ok) throw new Error(`Claude error: ${res.status}`);
  const d = await res.json();
  return String(d.content?.[0]?.text ?? "").trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { userId, action, ...p } = body as Record<string, unknown>;
    if (!userId) throw new Error("userId required");
    if (!action)  throw new Error("action required");

    const sb = createClient(SB_URL, SB_SRK, { auth: { persistSession: false } });
    let result: unknown;

    switch (action as string) {

      // ── AUTO LINK QUEST CHAINS ───────────────────────────────────────────────
      case "auto_link_quest_chains": {
        const { data: quests } = await sb.from("quests").select("id,title,description,type,category,status").eq("user_id", userId);
        if (!quests?.length) { result = { chains_created: 0, message: "No quests found" }; break; }

        // Use 1-based indices instead of UUIDs — Haiku reliably copies small numbers,
        // not 36-char UUIDs. We remap after parsing.
        const indexToId: Record<number, string> = {};
        const questList = (quests as any[]).map((q: any, i: number) => {
          indexToId[i + 1] = q.id;
          return `#${i + 1} | ${q.title} | type:${q.type} | cat:${q.category || "none"} | ${q.status} | ${(q.description || "").slice(0, 100)}`;
        }).join("\n");

        const raw = await callClaude(
          `You are a life-optimization AI. Analyze quests and identify logical progression chains — groups that naturally build toward a shared goal. Chains must have 2–6 quests ordered foundational→advanced. Only group genuinely related quests. Reply ONLY with a valid JSON array, no prose.`,
          `Quests (reference by # number only):\n${questList}\n\nReturn JSON array:\n[{"title":"string","description":"string","category":"string","indices":[1,4,7],"rationale":"string"}]\n\nRules:\n- indices = the # numbers from the list above (integers, NOT UUIDs)\n- Order indices foundational→advanced\n- Minimum 2 per chain, maximum 6\n- Only group genuinely correlated quests`
        );

        const arrMatch = raw.match(/\[[\s\S]*\]/);
        if (!arrMatch) { result = { chains_created: 0, message: "Claude returned no chains" }; break; }
        const suggested = JSON.parse(arrMatch[0]) as any[];

        // Clear existing chains
        const existingChainIds = (await sb.from("quest_chains").select("id").eq("user_id", userId)).data?.map((r: any) => r.id) ?? [];
        if (existingChainIds.length) {
          await sb.from("quest_chain_items").delete().in("chain_id", existingChainIds);
          await sb.from("quest_chains").delete().eq("user_id", userId);
        }

        let chainsCreated = 0;
        for (const chain of suggested) {
          const rawIndices: number[] = (chain.indices ?? chain.quest_indices ?? []).map(Number);
          const questIds: string[] = rawIndices
            .map((idx: number) => indexToId[idx])
            .filter(Boolean);
          if (questIds.length < 2) continue;

          const { data: chainRow, error: chainErr } = await sb.from("quest_chains").insert({
            user_id: userId,
            title: String(chain.title ?? "Quest Chain").slice(0, 120),
            description: String(chain.description ?? "").slice(0, 500),
            category: String(chain.category ?? "").slice(0, 80),
            status: "active",
          }).select("id").single();

          if (chainErr || !chainRow) continue;
          await sb.from("quest_chain_items").insert(
            questIds.map((qid: string, pos: number) => ({ chain_id: chainRow.id, quest_id: qid, position: pos }))
          );
          chainsCreated++;
        }

        result = { chains_created: chainsCreated, quests_analyzed: quests.length };
        break;
      }

      // ── AUTO LINK SKILL CHAINS ───────────────────────────────────────────────
      case "auto_link_skill_chains": {
        const { data: skills } = await sb.from("skills").select("id,name,description,category,tier,proficiency").eq("user_id", userId);
        if (!skills?.length) { result = { chains_created: 0, message: "No skills found" }; break; }

        const indexToSkillId: Record<number, string> = {};
        const skillList = (skills as any[]).map((s: any, i: number) => {
          indexToSkillId[i + 1] = s.id;
          return `#${i + 1} | ${s.name} | cat:${s.category} | T${s.tier} | ${s.proficiency}% | ${(s.description || "").slice(0, 80)}`;
        }).join("\n");

        const raw = await callClaude(
          `You are a skill development AI. Analyze skills and identify mastery chains — groups that build from foundational to advanced. Chains must have 2–8 skills ordered beginner→expert. Group by domain. Reply ONLY with a valid JSON array, no prose.`,
          `Skills (reference by # number only):\n${skillList}\n\nReturn JSON array:\n[{"title":"string","description":"string","category":"string","indices":[2,5,9],"rationale":"string"}]\n\nRules:\n- indices = the # numbers from the list above (integers, NOT UUIDs)\n- Order indices beginner→expert\n- Group by domain/category\n- Minimum 2 per chain, maximum 8`
        );

        const arrMatch = raw.match(/\[[\s\S]*\]/);
        if (!arrMatch) { result = { chains_created: 0, message: "Claude returned no chains" }; break; }
        const suggested = JSON.parse(arrMatch[0]) as any[];

        // Clear existing
        const existingChainIds = (await sb.from("skill_chains").select("id").eq("user_id", userId)).data?.map((r: any) => r.id) ?? [];
        if (existingChainIds.length) {
          await sb.from("skill_chain_items").delete().in("chain_id", existingChainIds);
          await sb.from("skill_chains").delete().eq("user_id", userId);
        }

        let chainsCreated = 0;
        for (const chain of suggested) {
          const rawIndices: number[] = (chain.indices ?? chain.skill_indices ?? []).map(Number);
          const skillIds: string[] = rawIndices
            .map((idx: number) => indexToSkillId[idx])
            .filter(Boolean);
          if (skillIds.length < 2) continue;

          const { data: chainRow, error: chainErr } = await sb.from("skill_chains").insert({
            user_id: userId,
            title: String(chain.title ?? "Skill Chain").slice(0, 120),
            description: String(chain.description ?? "").slice(0, 500),
            category: String(chain.category ?? "").slice(0, 80),
          }).select("id").single();

          if (chainErr || !chainRow) continue;
          await sb.from("skill_chain_items").insert(
            skillIds.map((sid: string, pos: number) => ({ chain_id: chainRow.id, skill_id: sid, position: pos }))
          );
          chainsCreated++;
        }

        result = { chains_created: chainsCreated, skills_analyzed: skills.length };
        break;
      }

      // ── GET QUEST CHAINS ─────────────────────────────────────────────────────
      case "get_quest_chains": {
        const { data: chains } = await sb.from("quest_chains").select("*").eq("user_id", userId).order("created_at", { ascending: false });
        if (!chains?.length) { result = { chains: [] }; break; }

        const chainIds = chains.map((c: any) => c.id);
        const { data: items } = await sb.from("quest_chain_items")
          .select("chain_id,quest_id,position,quests(id,title,status,type,difficulty,xp_reward,progress_current,progress_target)")
          .in("chain_id", chainIds)
          .order("position", { ascending: true });

        const itemsByChain: Record<string, any[]> = {};
        for (const item of items ?? []) {
          if (!itemsByChain[item.chain_id]) itemsByChain[item.chain_id] = [];
          itemsByChain[item.chain_id].push(item);
        }

        result = {
          chains: chains.map((c: any) => ({
            ...c,
            items: (itemsByChain[c.id] ?? []).sort((a: any, b: any) => a.position - b.position),
          })),
        };
        break;
      }

      // ── GET SKILL CHAINS ─────────────────────────────────────────────────────
      case "get_skill_chains": {
        const { data: chains } = await sb.from("skill_chains").select("*").eq("user_id", userId).order("created_at", { ascending: false });
        if (!chains?.length) { result = { chains: [] }; break; }

        const chainIds = chains.map((c: any) => c.id);
        const { data: items } = await sb.from("skill_chain_items")
          .select("chain_id,skill_id,position,skills(id,name,category,tier,proficiency,energy_type)")
          .in("chain_id", chainIds)
          .order("position", { ascending: true });

        const itemsByChain: Record<string, any[]> = {};
        for (const item of items ?? []) {
          if (!itemsByChain[item.chain_id]) itemsByChain[item.chain_id] = [];
          itemsByChain[item.chain_id].push(item);
        }

        result = {
          chains: chains.map((c: any) => ({
            ...c,
            items: (itemsByChain[c.id] ?? []).sort((a: any, b: any) => a.position - b.position),
          })),
        };
        break;
      }

      // ── CREATE QUEST CHAIN ───────────────────────────────────────────────────
      case "create_quest_chain": {
        const questIds: string[] = Array.isArray(p.quest_ids) ? p.quest_ids as string[] : [];
        const { data: chainRow, error } = await sb.from("quest_chains").insert({
          user_id: userId,
          title: String(p.title ?? "Quest Chain"),
          description: String(p.description ?? ""),
          category: String(p.category ?? ""),
          status: "active",
        }).select("id").single();
        if (error) throw new Error(error.message);

        if (questIds.length) {
          await sb.from("quest_chain_items").insert(
            questIds.map((qid, pos) => ({ chain_id: chainRow.id, quest_id: qid, position: pos }))
          );
        }
        result = { chain_id: chainRow.id, quest_count: questIds.length };
        break;
      }

      // ── CREATE SKILL CHAIN ───────────────────────────────────────────────────
      case "create_skill_chain": {
        const skillIds: string[] = Array.isArray(p.skill_ids) ? p.skill_ids as string[] : [];
        const { data: chainRow, error } = await sb.from("skill_chains").insert({
          user_id: userId,
          title: String(p.title ?? "Skill Chain"),
          description: String(p.description ?? ""),
          category: String(p.category ?? ""),
        }).select("id").single();
        if (error) throw new Error(error.message);

        if (skillIds.length) {
          await sb.from("skill_chain_items").insert(
            skillIds.map((sid, pos) => ({ chain_id: chainRow.id, skill_id: sid, position: pos }))
          );
        }
        result = { chain_id: chainRow.id, skill_count: skillIds.length };
        break;
      }

      // ── UPDATE QUEST CHAIN ───────────────────────────────────────────────────
      case "update_quest_chain": {
        const chainId = String(p.chain_id ?? "");
        if (!chainId) throw new Error("chain_id required");
        await sb.from("quest_chains").update({
          ...(p.title       && { title:       String(p.title) }),
          ...(p.description && { description: String(p.description) }),
          ...(p.category    && { category:    String(p.category) }),
          ...(p.status      && { status:      String(p.status) }),
          updated_at: new Date().toISOString(),
        }).eq("id", chainId).eq("user_id", userId);
        result = { chain_id: chainId, updated: true };
        break;
      }

      // ── UPDATE SKILL CHAIN ───────────────────────────────────────────────────
      case "update_skill_chain": {
        const chainId = String(p.chain_id ?? "");
        if (!chainId) throw new Error("chain_id required");
        await sb.from("skill_chains").update({
          ...(p.title       && { title:       String(p.title) }),
          ...(p.description && { description: String(p.description) }),
          ...(p.category    && { category:    String(p.category) }),
          updated_at: new Date().toISOString(),
        }).eq("id", chainId).eq("user_id", userId);
        result = { chain_id: chainId, updated: true };
        break;
      }

      // ── DELETE QUEST CHAIN ───────────────────────────────────────────────────
      case "delete_quest_chain": {
        const chainId = String(p.chain_id ?? "");
        if (!chainId) throw new Error("chain_id required");
        await sb.from("quest_chain_items").delete().eq("chain_id", chainId);
        await sb.from("quest_chains").delete().eq("id", chainId).eq("user_id", userId);
        result = { deleted: true };
        break;
      }

      // ── DELETE SKILL CHAIN ───────────────────────────────────────────────────
      case "delete_skill_chain": {
        const chainId = String(p.chain_id ?? "");
        if (!chainId) throw new Error("chain_id required");
        await sb.from("skill_chain_items").delete().eq("chain_id", chainId);
        await sb.from("skill_chains").delete().eq("id", chainId).eq("user_id", userId);
        result = { deleted: true };
        break;
      }

      // ── ADD TO CHAIN ─────────────────────────────────────────────────────────
      case "add_quest_to_chain": {
        const { chain_id, quest_id, position } = p as any;
        if (!chain_id || !quest_id) throw new Error("chain_id and quest_id required");
        const pos = position !== undefined ? Number(position) :
          ((await sb.from("quest_chain_items").select("position").eq("chain_id", chain_id).order("position", { ascending: false }).limit(1)).data?.[0]?.position ?? -1) + 1;
        await sb.from("quest_chain_items").upsert({ chain_id, quest_id, position: pos }, { onConflict: "chain_id,quest_id" });
        result = { added: true, position: pos };
        break;
      }

      case "add_skill_to_chain": {
        const { chain_id, skill_id, position } = p as any;
        if (!chain_id || !skill_id) throw new Error("chain_id and skill_id required");
        const pos = position !== undefined ? Number(position) :
          ((await sb.from("skill_chain_items").select("position").eq("chain_id", chain_id).order("position", { ascending: false }).limit(1)).data?.[0]?.position ?? -1) + 1;
        await sb.from("skill_chain_items").upsert({ chain_id, skill_id, position: pos }, { onConflict: "chain_id,skill_id" });
        result = { added: true, position: pos };
        break;
      }

      // ── REMOVE FROM CHAIN ────────────────────────────────────────────────────
      case "remove_from_chain": {
        const { item_id, chain_type } = p as any;
        if (!item_id) throw new Error("item_id required");

        // chain_type hint lets callers be explicit; otherwise try quest first then skill
        let deleted = false;
        if (!chain_type || chain_type === "quest") {
          const { error, count } = await sb.from("quest_chain_items").delete({ count: "exact" }).eq("id", item_id);
          if (!error && (count ?? 0) > 0) deleted = true;
        }
        if (!deleted && (!chain_type || chain_type === "skill")) {
          const { error, count } = await sb.from("skill_chain_items").delete({ count: "exact" }).eq("id", item_id);
          if (!error && (count ?? 0) > 0) deleted = true;
        }

        if (!deleted) throw new Error(`No chain item found with id ${item_id}`);
        result = { removed: true, item_id };
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
