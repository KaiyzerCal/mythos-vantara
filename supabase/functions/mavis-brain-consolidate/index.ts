// mavis-brain-consolidate
// Daily AI brain compounding — reads all of today's activity, extracts facts,
// decisions, patterns, and relationship updates, then writes high-importance
// consolidated memories back. Optionally pushes a digest to Notion.
//
// Called by: GitHub Actions cron (3 AM UTC daily) or manually via mavis-actions
// POST body: { user_id?: string } — omit to process all users

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.27.1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL  = Deno.env.get("SUPABASE_URL")!;
const SB_SRK  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AI_KEY  = Deno.env.get("ANTHROPIC_API_KEY")!;
const NOTION_TOKEN = Deno.env.get("NOTION_API_KEY") ?? "";
const NOTION_DIGEST_DB = Deno.env.get("NOTION_DIGEST_DB_ID") ?? ""; // optional

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// ── Pull today's activity for a user ────────────────────────

async function gatherTodayActivity(sb: ReturnType<typeof createClient>, userId: string): Promise<string> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const iso = todayStart.toISOString();

  const [journals, quests, meetings, memories, goals, contacts, notionSync] = await Promise.all([
    sb.from("journal_entries").select("title,content,mood,created_at").eq("user_id", userId).gte("created_at", iso).limit(20),
    sb.from("quests").select("title,description,status,updated_at").eq("user_id", userId).gte("updated_at", iso).limit(20),
    sb.from("meeting_notes").select("title,summary,attendees,action_items,created_at").eq("user_id", userId).gte("created_at", iso).limit(10),
    sb.from("mavis_agent_memories").select("content,summary,tags,entity_type,importance").eq("user_id", userId).gte("created_at", iso).limit(30),
    sb.from("goals").select("title,description,status,progress,updated_at").eq("user_id", userId).gte("updated_at", iso).limit(10),
    sb.from("contacts").select("name,company,relationship_type,notes,updated_at").eq("user_id", userId).gte("updated_at", iso).limit(15),
    sb.from("mavis_notion_sync_log").select("page_title,page_url,synced_at").eq("user_id", userId).gte("synced_at", iso).limit(20),
  ]);

  const sections: string[] = [];

  if (journals.data?.length) {
    sections.push(`JOURNAL ENTRIES TODAY:\n${journals.data.map((j: any) =>
      `- "${j.title}" [mood: ${j.mood ?? "n/a"}]: ${String(j.content ?? "").slice(0, 400)}`
    ).join("\n")}`);
  }

  if (quests.data?.length) {
    sections.push(`QUESTS UPDATED TODAY:\n${quests.data.map((q: any) =>
      `- [${q.status}] ${q.title}: ${String(q.description ?? "").slice(0, 200)}`
    ).join("\n")}`);
  }

  if (meetings.data?.length) {
    sections.push(`MEETINGS TODAY:\n${meetings.data.map((m: any) =>
      `- "${m.title}" | Attendees: ${m.attendees ?? "n/a"} | Summary: ${String(m.summary ?? "").slice(0, 300)} | Actions: ${m.action_items ?? "n/a"}`
    ).join("\n")}`);
  }

  if (goals.data?.length) {
    sections.push(`GOALS TOUCHED TODAY:\n${goals.data.map((g: any) =>
      `- [${g.status}] ${g.title} (${g.progress ?? 0}% complete): ${String(g.description ?? "").slice(0, 150)}`
    ).join("\n")}`);
  }

  if (contacts.data?.length) {
    sections.push(`CONTACTS UPDATED TODAY:\n${contacts.data.map((c: any) =>
      `- ${c.name} (${c.company ?? "no company"}, ${c.relationship_type ?? "contact"}): ${String(c.notes ?? "").slice(0, 200)}`
    ).join("\n")}`);
  }

  if (memories.data?.length) {
    sections.push(`NEW MEMORIES WRITTEN TODAY:\n${memories.data.map((m: any) =>
      `- [${m.entity_type}, importance ${m.importance}] ${m.summary ?? String(m.content ?? "").slice(0, 200)}`
    ).join("\n")}`);
  }

  if (notionSync.data?.length) {
    sections.push(`NOTION PAGES SYNCED TODAY:\n${notionSync.data.map((n: any) =>
      `- "${n.page_title}" (${n.page_url})`
    ).join("\n")}`);
  }

  return sections.length ? sections.join("\n\n") : "";
}

// ── Claude synthesis ─────────────────────────────────────────

interface ConsolidatedMemory {
  content: string;
  summary: string;
  entity_type: "experience" | "fact" | "pattern" | "relationship" | "decision" | "signal";
  tags: string[];
  importance: number;
  vault_folder: string;
}

interface SynthesisResult {
  memories: ConsolidatedMemory[];
  digest_title: string;
  digest_summary: string;
  operator_context_update?: string;
}

async function synthesizeWithClaude(activity: string, date: string): Promise<SynthesisResult | null> {
  if (!AI_KEY) return null;
  const anthropic = new Anthropic({ apiKey: AI_KEY });

  const prompt = `You are a knowledge extraction engine for an AI system called MAVIS. Today is ${date}.

You have been given the operator's full activity for today. Your job is to extract crystallised intelligence that compounds over time — facts about people, decisions made, patterns observed, project progress, and knowledge worth preserving.

TODAY'S ACTIVITY:
${activity}

Extract 3-8 high-value consolidated memories. Each memory should be:
- Specific to this operator's actual activity (not generic)
- Written in third-person as a fact MAVIS should remember
- Tagged with the relevant vault folder: people | projects | decisions | companies | meetings | knowledge | mocs | daily_log
- Assigned an importance score 6-10 (only high-value insights — skip trivial facts)

Also write:
- digest_title: A one-line title for today (e.g. "Jun 30 — Notion integrated, three quests completed")
- digest_summary: 2-3 sentences summarising the day's significance
- operator_context_update: If today revealed something new about the operator's patterns or priorities worth adding to the permanent context, write it (1-2 sentences max). Otherwise omit.

Respond with valid JSON matching this schema:
{
  "memories": [
    {
      "content": "Full memory text (2-4 sentences)",
      "summary": "One-line summary",
      "entity_type": "fact|pattern|relationship|decision|experience|signal",
      "tags": ["vault-folder", "additional-tags"],
      "importance": 7,
      "vault_folder": "people|projects|decisions|companies|meetings|knowledge|mocs|daily_log"
    }
  ],
  "digest_title": "...",
  "digest_summary": "...",
  "operator_context_update": "..."
}`;

  try {
    const res = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    const text = res.content[0].type === "text" ? res.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]) as SynthesisResult;
  } catch (err) {
    console.error("[brain-consolidate] Claude error:", err);
    return null;
  }
}

// ── Write to Notion (optional) ───────────────────────────────

async function pushDigestToNotion(title: string, summary: string, memories: ConsolidatedMemory[], date: string) {
  if (!NOTION_TOKEN || !NOTION_DIGEST_DB) return;

  const blocks = [
    {
      object: "block", type: "callout",
      callout: {
        rich_text: [{ type: "text", text: { content: summary } }],
        icon: { emoji: "🧠" },
        color: "purple_background",
      },
    },
    { object: "block", type: "divider", divider: {} },
    ...memories.map(m => ({
      object: "block",
      type: "bulleted_list_item",
      bulleted_list_item: {
        rich_text: [
          { type: "text", text: { content: `[${m.vault_folder.toUpperCase()}] ` }, annotations: { bold: true } },
          { type: "text", text: { content: m.content } },
        ],
      },
    })),
  ];

  await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      parent: { database_id: NOTION_DIGEST_DB },
      properties: {
        Name: { title: [{ type: "text", text: { content: title } }] },
        Date: { date: { start: date } },
      },
      children: blocks,
    }),
  }).catch(err => console.error("[brain-consolidate] Notion push error:", err));
}

// ── Process one user ─────────────────────────────────────────

async function processUser(sb: ReturnType<typeof createClient>, userId: string): Promise<{ memories_written: number; digest_title: string }> {
  const today = new Date().toISOString().split("T")[0];

  const activity = await gatherTodayActivity(sb, userId);
  if (!activity) return { memories_written: 0, digest_title: "No activity today" };

  const synthesis = await synthesizeWithClaude(activity, today);
  if (!synthesis) return { memories_written: 0, digest_title: "Synthesis failed" };

  // Write consolidated memories
  if (synthesis.memories?.length) {
    const rows = synthesis.memories.map(m => ({
      user_id: userId,
      agent_id: "plugin/brain-consolidate",
      agent_name: "Daily Brain Consolidation",
      agent_type: "plugin",
      entity_type: m.entity_type,
      memory_type: "semantic",
      content: m.content,
      summary: m.summary,
      tags: ["daily-consolidation", m.vault_folder, ...(m.tags ?? [])],
      importance: Math.min(10, Math.max(1, m.importance ?? 7)),
      confidence: 8,
      status: "active",
    }));
    await sb.from("mavis_agent_memories").insert(rows);
  }

  // Update operator_context in agent config if new insight
  if (synthesis.operator_context_update) {
    const { data: existing } = await sb
      .from("mavis_agent_config")
      .select("content")
      .eq("user_id", userId)
      .eq("section", "operator_context")
      .maybeSingle();

    if (existing) {
      const appended = `${existing.content}\n\n[${today}] ${synthesis.operator_context_update}`;
      await sb.from("mavis_agent_config")
        .update({ content: appended.slice(0, 8000) })
        .eq("user_id", userId)
        .eq("section", "operator_context");
    }
  }

  // Push to Notion if configured
  if (synthesis.digest_title && synthesis.memories?.length) {
    await pushDigestToNotion(
      synthesis.digest_title,
      synthesis.digest_summary ?? "",
      synthesis.memories,
      today
    );
  }

  return {
    memories_written: synthesis.memories?.length ?? 0,
    digest_title: synthesis.digest_title ?? `Brain consolidation — ${today}`,
  };
}

// ── Main ─────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));
    const sb   = createClient(SB_URL, SB_SRK);

    // If user_id provided, process just that user
    if (body.user_id) {
      const result = await processUser(sb, String(body.user_id));
      return json({ users_processed: 1, results: [result] });
    }

    // Otherwise process all users who have active agent config (opted-in users)
    const { data: users } = await sb
      .from("mavis_agent_config")
      .select("user_id")
      .eq("section", "soul")
      .limit(200);

    const userIds = [...new Set((users ?? []).map((r: any) => r.user_id as string))];
    if (!userIds.length) return json({ users_processed: 0, results: [] });

    const results = [];
    for (const uid of userIds) {
      try {
        const r = await processUser(sb, uid);
        results.push({ user_id: uid, ...r });
      } catch (err) {
        results.push({ user_id: uid, error: String(err) });
      }
    }

    return json({ users_processed: userIds.length, results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-brain-consolidate]", message);
    return json({ error: message }, 500);
  }
});
