// mavis-obsidian-export — OpenHuman pattern: Obsidian-compatible markdown export
// Fetches mavis_notes and converts each to markdown with YAML frontmatter
// Compatible with Obsidian vaults — wikilinks, tags, backlinks preserved

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL  = Deno.env.get("SUPABASE_URL")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SB_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function toObsidianFilename(title: string): string {
  return title
    .replace(/[<>:"\/\\|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100) || "Untitled";
}

function noteToMarkdown(note: Record<string, any>): string {
  const tags = (note.tags ?? []).map((t: string) => t.replace(/\s+/g, "-").toLowerCase());
  const created = note.created_at ? new Date(note.created_at).toISOString().split("T")[0] : "";
  const updated = note.updated_at ? new Date(note.updated_at).toISOString().split("T")[0] : "";

  const frontmatter = [
    "---",
    `title: "${(note.title ?? "Untitled").replace(/"/g, '\\"')}"`,
    `created: ${created}`,
    `updated: ${updated}`,
    tags.length > 0 ? `tags: [${tags.map((t: string) => `"${t}"`).join(", ")}]` : "tags: []",
    note.source     ? `source: "${note.source}"` : null,
    note.category   ? `category: "${note.category}"` : null,
    note.is_pinned  ? `pinned: true` : null,
    "---",
  ].filter(Boolean).join("\n");

  // Convert wikilinks from DB format to Obsidian format
  let body = note.content ?? "";

  // If wikilinks stored as array, inject them as a backlinks section
  const wikilinks: string[] = note.wikilinks ?? [];
  if (wikilinks.length > 0) {
    body += `\n\n## Linked Notes\n${wikilinks.map((l: string) => `- [[${l}]]`).join("\n")}`;
  }

  return `${frontmatter}\n\n# ${note.title ?? "Untitled"}\n\n${body}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const sbUser = createClient(SB_URL, SB_ANON, { auth: { persistSession: false } });
    const { data: { user }, error } = await sbUser.auth.getUser(authHeader.replace("Bearer ", ""));
    if (error || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const includeKnowledge = body.include_knowledge !== false;
    const includeJournal   = body.include_journal   !== false;
    const includeVault     = body.include_vault     === true;

    const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

    const files: { filename: string; content: string; folder: string }[] = [];

    // 1. MAVIS Notes (Knowledge base)
    if (includeKnowledge) {
      const { data: notes } = await sb
        .from("mavis_notes")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(2000);

      for (const note of notes ?? []) {
        const filename = `${toObsidianFilename(note.title ?? "Untitled")}.md`;
        files.push({ folder: "MAVIS/Knowledge", filename, content: noteToMarkdown(note) });
      }
    }

    // 2. Journal entries
    if (includeJournal) {
      const { data: entries } = await sb
        .from("journal_entries")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1000);

      for (const entry of entries ?? []) {
        const date = entry.created_at ? new Date(entry.created_at).toISOString().split("T")[0] : "unknown";
        const title = entry.title ?? `Journal ${date}`;
        const filename = `${toObsidianFilename(title)}.md`;
        const frontmatter = `---\ntitle: "${title.replace(/"/g, '\\"')}"\ndate: ${date}\ntags: ["journal"]\n---\n\n`;
        files.push({ folder: "MAVIS/Journal", filename, content: frontmatter + (entry.content ?? "") });
      }
    }

    // 3. Vault entries (if requested)
    if (includeVault) {
      const { data: vault } = await sb
        .from("vault_entries")
        .select("title, content, tags, created_at")
        .eq("user_id", user.id)
        .eq("is_public", false)
        .order("created_at", { ascending: false })
        .limit(500);

      for (const entry of vault ?? []) {
        const date = entry.created_at ? new Date(entry.created_at).toISOString().split("T")[0] : "unknown";
        const title = entry.title ?? `Vault ${date}`;
        const tags = (entry.tags ?? []).map((t: string) => `"${t}"`).join(", ");
        const frontmatter = `---\ntitle: "${title.replace(/"/g, '\\"')}"\ndate: ${date}\ntags: [${tags}, "vault"]\n---\n\n`;
        files.push({ folder: "MAVIS/Vault", filename: `${toObsidianFilename(title)}.md`, content: frontmatter + (entry.content ?? "") });
      }
    }

    // Generate an index file
    const indexContent = [
      "---\ntitle: MAVIS Knowledge Index\ntags: [\"index\"]\n---\n",
      "# MAVIS Vault — Obsidian Index\n",
      `Exported: ${new Date().toLocaleDateString()}  `,
      `Notes: ${files.filter(f => f.folder.includes("Knowledge")).length}  `,
      `Journal: ${files.filter(f => f.folder.includes("Journal")).length}  `,
      `Vault: ${files.filter(f => f.folder.includes("Vault")).length}  `,
      "\n## Folders\n",
      "- [[MAVIS/Knowledge]] — AI notes and knowledge base",
      "- [[MAVIS/Journal]] — Journal entries",
      "- [[MAVIS/Vault]] — Secured vault entries",
    ].join("\n");

    files.unshift({ folder: "", filename: "MAVIS Index.md", content: indexContent });

    return new Response(
      JSON.stringify({ ok: true, file_count: files.length, files }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("mavis-obsidian-export error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
