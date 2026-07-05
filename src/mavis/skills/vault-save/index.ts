// SKILL: vault-save
// Saves URLs, files, and content directly to the VANTARA vault (vault_media table).

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "vault-save", output: "Save anything to your vault. Example: 'save to vault: https://example.com/article' or 'add to vault: this quote'" };
  }
  if (!ctx.userId) return { skillName: "vault-save", output: "Log in to save to your vault." };

  const urlMatch = input.match(/https?:\/\/[^\s]+/);
  const content = input.replace(/^(save to vault|add to vault|vault this|store in vault)\s*:?\s*/i, "").trim();
  const isUrl = !!urlMatch;
  const title = isUrl
    ? urlMatch![0].replace(/https?:\/\//, "").replace(/\/.*/, "").slice(0, 80)
    : content.slice(0, 80);

  try {
    const { error } = await supabase.from("vault_media").insert({
      user_id: ctx.userId,
      url: urlMatch?.[0] ?? null,
      title,
      content: isUrl ? null : content,
      media_type: isUrl ? "link" : "note",
      source: "mavis-skill",
      created_at: new Date().toISOString(),
    });
    if (error) throw error;
    return { skillName: "vault-save", output: `🗄️ Saved to vault: "${title}"` };
  } catch (err) {
    return { skillName: "vault-save", output: `Vault save error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "vault-save",
  description: "Saves URLs, notes, and content to your VANTARA vault for later retrieval",
  keywords: [
    "save to vault", "add to vault", "vault this", "store in vault",
    "keep this", "archive this", "save this link", "bookmark this",
    "add to my library", "save for later", "clip this",
  ],
}, handler);
