import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  const rawTopic = (input ?? "").trim();
  const topic = rawTopic || "general content";
  const isGeneral = !rawTopic;

  try {
    const uid = ctx.userId;
    const pattern = `%${topic}%`;

    const [vaultRes, journalRes] = await Promise.all([
      isGeneral
        ? supabase
            .from("vault_entries")
            .select("id,title,content,category")
            .eq("user_id", uid)
            .order("created_at", { ascending: false })
            .limit(3)
        : supabase
            .from("vault_entries")
            .select("id,title,content,category")
            .eq("user_id", uid)
            .or(`title.ilike.${pattern},content.ilike.${pattern}`)
            .limit(3),
      isGeneral
        ? supabase
            .from("journal_entries")
            .select("id,title,content,created_at")
            .eq("user_id", uid)
            .order("created_at", { ascending: false })
            .limit(2)
        : supabase
            .from("journal_entries")
            .select("id,title,content,created_at")
            .eq("user_id", uid)
            .or(`title.ilike.${pattern},content.ilike.${pattern}`)
            .order("created_at", { ascending: false })
            .limit(2),
    ]);

    const vault: any[] = vaultRes.data ?? [];
    const journal: any[] = journalRes.data ?? [];

    const displayTopic = rawTopic
      ? rawTopic.charAt(0).toUpperCase() + rawTopic.slice(1)
      : "General Content";

    const lines: string[] = [`CONTENT BRIEF — ${displayTopic.toUpperCase()}\n`];

    // VOICE PARAMETERS
    lines.push("NORA VALE VOICE PARAMETERS:");
    lines.push("  Tone: Direct, founder-minded, no corporate speak");
    lines.push("  Audience: SMB owners, solopreneurs, AI-curious entrepreneurs");
    lines.push("  Brand pillars: Revenue systems | AI automation | Building leverage | Real talk");

    // CONTENT ANGLES
    lines.push("\nCONTENT ANGLES (choose one):");
    lines.push(`  1. [Problem angle] The problem most founders face with ${displayTopic} — and why they never fix it.`);
    lines.push(`  2. [Insight angle] What ${displayTopic} actually means for your bottom line.`);
    lines.push(`  3. [Story angle] How ${displayTopic} changed my approach to building leverage.`);

    // HOOKS
    lines.push("\nHOOKS (first line options):");
    lines.push(`  • "Everyone talks about ${displayTopic}. Almost nobody does it right."`);
    lines.push(`  • "Most people get ${displayTopic} wrong. Here's why:"`);
    if (rawTopic) {
      lines.push(`  • "7-figure lesson from getting ${displayTopic} right."`);
    } else {
      lines.push(`  • "The leverage play hiding in plain sight."`);
    }

    // DISTRIBUTION
    lines.push("\nDISTRIBUTION:");
    lines.push("  • Twitter/X thread (Nora): 5-7 tweets, lead with hook, end with CTA");
    lines.push("  • Newsletter section: 300-word expansion with personal example");
    lines.push("  • Short-form video script: 60-sec hook + 3 points + CTA");

    // VAULT CONTEXT
    lines.push("\nVAULT CONTEXT (if found):");
    if (vault.length === 0) {
      lines.push("  No matching vault entries. Draw from personal experience and first principles.");
    } else {
      vault.forEach((e: any) => {
        const snippet = (e.content ?? "").slice(0, 200).replace(/\n/g, " ");
        lines.push(`  • [${e.category ?? "general"}] ${e.title ?? "(untitled)"}`);
        if (snippet) lines.push(`    "${snippet}${(e.content?.length ?? 0) > 200 ? "…" : ""}"`);
      });
    }

    if (journal.length > 0) {
      lines.push("\nJOURNAL CONTEXT:");
      journal.forEach((e: any) => {
        const snippet = (e.content ?? "").slice(0, 150).replace(/\n/g, " ");
        lines.push(`  • ${e.title ?? "(untitled)"}`);
        if (snippet) lines.push(`    "${snippet}${(e.content?.length ?? 0) > 150 ? "…" : ""}"`);
      });
    }

    // READY TO CREATE
    lines.push("\nREADY TO CREATE?");
    lines.push("  Say \"post this as Nora\" to auto-tweet the top hook.");
    lines.push("  Say \"expand this into a thread\" for full Twitter thread draft.");
    lines.push("  Say \"create a product from this\" to trigger revenue opportunity proposal.");

    return { skillName: "content-brief", output: lines.join("\n") };
  } catch (err) {
    return {
      skillName: "content-brief",
      output: `Content brief failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};

registerSkill({
  name: "content-brief",
  description: "Generates a content/marketing brief for a given topic in Nora Vale's brand voice — includes angles, hooks, and distribution plan",
  keywords: [
    "content brief",
    "content idea",
    "draft content",
    "nora content",
    "write for nora",
    "marketing brief",
    "campaign brief",
    "create content",
    "brand voice",
  ],
}, handler);
