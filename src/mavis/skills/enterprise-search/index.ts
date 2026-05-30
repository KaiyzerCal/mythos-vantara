import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  const query = (input ?? "").trim();

  if (!query) {
    return {
      skillName: "enterprise-search",
      output: 'Enterprise Search requires a query. Usage: \'search for [topic]\'',
    };
  }

  try {
    const uid = ctx.userId;
    const pattern = `%${query}%`;

    const [journalRes, vaultRes, questsRes, alliesRes] = await Promise.all([
      supabase
        .from("journal_entries")
        .select("id,title,category,created_at,content")
        .eq("user_id", uid)
        .or(`title.ilike.${pattern},content.ilike.${pattern}`)
        .limit(3),
      supabase
        .from("vault_entries")
        .select("id,title,category,importance,content")
        .eq("user_id", uid)
        .or(`title.ilike.${pattern},content.ilike.${pattern}`)
        .limit(3),
      supabase
        .from("quests")
        .select("id,title,status,type")
        .eq("user_id", uid)
        .or(`title.ilike.${pattern},description.ilike.${pattern}`)
        .limit(3),
      supabase
        .from("allies")
        .select("id,name,relationship,affinity,notes")
        .eq("user_id", uid)
        .or(`name.ilike.${pattern},notes.ilike.${pattern},specialty.ilike.${pattern}`)
        .limit(3),
    ]);

    const journal: any[] = journalRes.data ?? [];
    const vault: any[] = vaultRes.data ?? [];
    const quests: any[] = questsRes.data ?? [];
    const allies: any[] = alliesRes.data ?? [];

    const totalFound = journal.length + vault.length + quests.length + allies.length;

    if (totalFound === 0) {
      return {
        skillName: "enterprise-search",
        output: `No results found for "${query}" across Journal, Vault, Quests, or Allies.`,
      };
    }

    const lines: string[] = [`ENTERPRISE SEARCH: "${query}"\n`];

    // JOURNAL RESULTS
    lines.push(`JOURNAL RESULTS (${journal.length} found):`);
    if (journal.length === 0) {
      lines.push("  None");
    } else {
      journal.forEach((e: any) => {
        const date = new Date(e.created_at).toLocaleDateString();
        const snippet = (e.content ?? "").slice(0, 200).replace(/\n/g, " ");
        lines.push(`  • ${e.title ?? "(untitled)"} — ${e.category ?? "uncategorized"} — ${date}`);
        if (snippet) lines.push(`    "${snippet}${e.content?.length > 200 ? "…" : ""}"`);
      });
    }

    // VAULT RESULTS
    lines.push(`\nVAULT RESULTS (${vault.length} found):`);
    if (vault.length === 0) {
      lines.push("  None");
    } else {
      vault.forEach((e: any) => {
        const meta = [e.category, e.importance ? `importance:${e.importance}` : null].filter(Boolean).join(" / ");
        const snippet = (e.content ?? "").slice(0, 200).replace(/\n/g, " ");
        lines.push(`  • ${e.title ?? "(untitled)"} — ${meta || "uncategorized"}`);
        if (snippet) lines.push(`    "${snippet}${e.content?.length > 200 ? "…" : ""}"`);
      });
    }

    // QUEST RESULTS
    lines.push(`\nQUEST RESULTS (${quests.length} found):`);
    if (quests.length === 0) {
      lines.push("  None");
    } else {
      quests.forEach((q: any) => {
        lines.push(`  • ${q.title ?? "(untitled)"} — ${q.status} ${q.type ?? ""}`);
      });
    }

    // ALLY RESULTS
    lines.push(`\nALLY RESULTS (${allies.length} found):`);
    if (allies.length === 0) {
      lines.push("  None");
    } else {
      allies.forEach((a: any) => {
        const notesSnippet = (a.notes ?? "").slice(0, 150).replace(/\n/g, " ");
        lines.push(`  • ${a.name} — ${a.relationship ?? "unknown"} — affinity:${a.affinity ?? "N/A"}`);
        if (notesSnippet) lines.push(`    ${notesSnippet}${(a.notes?.length ?? 0) > 150 ? "…" : ""}`);
      });
    }

    return { skillName: "enterprise-search", output: lines.join("\n") };
  } catch (err) {
    return {
      skillName: "enterprise-search",
      output: `Enterprise search failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};

registerSkill({
  name: "enterprise-search",
  description: "Cross-entity search across journal, vault, quests, and allies simultaneously",
  keywords: [
    "search for",
    "find in my",
    "look up",
    "search everything",
    "search across",
    "enterprise search",
    "find across all",
    "what do i have on",
  ],
}, handler);
