// SKILL: backlink-build
// AI-powered backlink building agent via Apify daniil.poletaev/backlink-building-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "backlink-build", output: "Build backlinks for a site. Example: 'build backlinks for prymal.com in coffee niche' or 'backlink opportunities for mysite.com'" };
  }
  const website = input.match(/https?:\/\/[^\s]+/)?.[0] ?? input.match(/[\w-]+\.\w{2,}/)?.[0] ?? "";
    const niche = (input.replace(/^(build backlinks for|backlink opportunities for|backlinks)\s*/i, "").replace(website, "").replace(/\s*(in|for)\s+([\w\s]+)\s*(niche)?/i, "").trim() ||
      input.match(/in\s+([\w\s]+)\s*(niche)?/i)?.[1]) ?? "general";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: { actorId: "daniil.poletaev/backlink-building-agent", input: { website, niche }, timeout: 120 },
    });
    if (error) throw error;
    const result = data?.output ?? data?.backlinks ?? data;
    return { skillName: "backlink-build", output: result ? `🔗 **Backlink Opportunities:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "backlink-build", output: `Backlink builder error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "backlink-build",
  description: "AI backlink building agent — finds high-quality link opportunities for your website",
  keywords: [
    "build backlinks", "backlink opportunities", "backlink builder", "find backlinks",
    "link building", "seo backlinks", "get backlinks",
  ],
}, handler);
