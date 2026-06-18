import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  const name = (input ?? "").trim();

  if (!name) {
    return {
      skillName: "outreach-prep",
      output: "Outreach Prep requires a contact name. Usage: 'prep for [name]'",
    };
  }

  try {
    const uid = ctx.userId;
    const pattern = `%${name}%`;

    const [allyRes, councilRes, journalRes, vaultRes] = await Promise.all([
      supabase
        .from("allies")
        .select("*")
        .eq("user_id", uid)
        .ilike("name", pattern)
        .limit(1),
      supabase
        .from("councils")
        .select("*")
        .eq("user_id", uid)
        .ilike("name", pattern)
        .limit(1),
      supabase
        .from("journal_entries")
        .select("id,title,content,created_at")
        .eq("user_id", uid)
        .or(`content.ilike.${pattern},title.ilike.${pattern}`)
        .order("created_at", { ascending: false })
        .limit(3),
      supabase
        .from("vault_entries")
        .select("id,title,content,category")
        .eq("user_id", uid)
        .or(`content.ilike.${pattern},title.ilike.${pattern}`)
        .limit(2),
    ]);

    const ally: any = (allyRes.data ?? [])[0] ?? null;
    const council: any = (councilRes.data ?? [])[0] ?? null;
    const journal: any[] = journalRes.data ?? [];
    const vault: any[] = vaultRes.data ?? [];

    const contact = ally ?? council ?? null;
    const contactName = contact?.name ?? name;
    const source = ally ? "Ally" : council ? "Council" : "Not in system";

    const affinity: number | null = contact?.affinity ?? null;

    const lines: string[] = [`OUTREACH PREP — ${contactName.toUpperCase()}\n`];

    // CONTACT INTELLIGENCE
    lines.push("CONTACT INTELLIGENCE:");
    lines.push(`  Source: ${source}`);
    if (contact) {
      lines.push(`  Relationship: ${contact.relationship ?? "—"}`);
      lines.push(`  Affinity: ${affinity !== null ? `${affinity}/100` : "—"}`);
      lines.push(`  Specialty: ${contact.specialty ?? contact.role ?? "—"}`);
      const notes = (contact.notes ?? "").slice(0, 300).replace(/\n/g, " ");
      lines.push(`  Last known notes: ${notes || "None recorded"}`);
    } else {
      lines.push("  Relationship: Unknown");
      lines.push("  Affinity: —");
      lines.push("  Specialty: —");
      lines.push("  Last known notes: None");
    }

    // RELEVANT CONTEXT
    lines.push("\nRELEVANT CONTEXT:");
    lines.push(`  Journal mentions (${journal.length}):`);
    if (journal.length === 0) {
      lines.push("    None found");
    } else {
      journal.forEach((e: any) => {
        const date = new Date(e.created_at).toLocaleDateString();
        lines.push(`    • ${e.title ?? "(untitled)"} — ${date}`);
      });
    }

    lines.push(`  Vault references (${vault.length}):`);
    if (vault.length === 0) {
      lines.push("    None found");
    } else {
      vault.forEach((e: any) => {
        lines.push(`    • ${e.title ?? "(untitled)"} — ${e.category ?? "uncategorized"}`);
      });
    }

    // SUGGESTED APPROACH
    lines.push("\nSUGGESTED APPROACH:");
    if (affinity === null) {
      lines.push("  No existing relationship data. Research mode — establish context before outreach.");
    } else if (affinity > 70) {
      lines.push("  Strong existing relationship. Lead with mutual wins. Reference shared history.");
    } else if (affinity >= 40) {
      lines.push("  Developing relationship. Add value first. Ask about their current focus before pitching.");
    } else {
      lines.push("  Early stage. Keep it brief, no ask yet. Build credibility first.");
    }

    // TALKING POINTS
    lines.push("\nTALKING POINTS:");
    if (contact?.specialty ?? contact?.role) {
      const specialty = contact.specialty ?? contact.role;
      lines.push(`  • Open with their domain: reference something relevant to ${specialty}.`);
    } else {
      lines.push(`  • Do your research on ${contactName}'s current projects and priorities.`);
    }
    lines.push("  • Identify mutual value — what can you offer before making any ask?");
    if (affinity !== null && affinity > 70) {
      lines.push("  • Clear ask: you have the relationship capital — be direct about what you need.");
    } else if (affinity !== null && affinity >= 40) {
      lines.push("  • Soft next step: propose a follow-up call or share a resource, no hard ask yet.");
    } else {
      lines.push("  • No ask this time — focus on opening the relationship and leaving a strong impression.");
    }

    return { skillName: "outreach-prep", output: lines.join("\n") };
  } catch (err) {
    return {
      skillName: "outreach-prep",
      output: `Outreach prep failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};

registerSkill({
  name: "outreach-prep",
  description: "Generates an outreach/sales prep brief for a specific contact — pulls ally data, council records, and relevant journal/vault mentions",
  keywords: [
    "prep for",
    "outreach prep",
    "prepare for call",
    "call prep",
    "prepare to reach out",
    "meeting prep",
    "prep outreach",
  ],
}, handler);
