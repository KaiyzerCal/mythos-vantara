// MAVIS Morning Brief
// Fires at 06:00 UTC daily. Pushes a structured daily briefing to Telegram:
// calendar events, unread email, pending approvals, overdue quests, today's tasks,
// SR notes due, revenue delta, council alerts, pattern alerts, memory surfacing.
// Also callable via /brief Telegram command.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const OPERATOR_USER_ID = Deno.env.get("TELEGRAM_OPERATOR_USER_ID")!;
const BOT_TOKEN        = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const CHAT_ID          = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID") ?? "";

async function sendTelegram(text: string): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) return;
  const payload = text.length > 4096 ? text.slice(0, 4056) + "\n…[truncated]" : text;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text: payload, parse_mode: "Markdown" }),
  }).catch(() => {});
}

async function refreshGoogleToken(config: Record<string, unknown>, provider: string): Promise<string> {
  if (typeof config.expires_at === "number" && config.expires_at > Date.now() / 1000 + 300) {
    return config.access_token as string;
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.client_id as string,
      client_secret: config.client_secret as string,
      refresh_token: config.refresh_token as string,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token refresh failed for ${provider}`);
  const newConfig = { ...config, access_token: data.access_token, expires_at: Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600) };
  await supabase.from("mavis_user_integrations").update({ config: newConfig }).eq("provider", provider);
  return data.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" },
    });
  }

  try {
    if (!OPERATOR_USER_ID) throw new Error("TELEGRAM_OPERATOR_USER_ID not set");
    const uid = OPERATOR_USER_ID;
    const now = new Date();
    const todayIso = now.toISOString().slice(0, 10);
    const yesterdayIso = new Date(now.getTime() - 86400000).toISOString();

    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
    const twoDaysAgo   = new Date(now.getTime() - 2 * 86400000).toISOString();

    // ── Google Calendar: today's events ──────────────────────────────────────
    let calendarEvents: Array<{ title: string; start: string; end: string }> = [];
    try {
      const { data: calInt } = await supabase
        .from("mavis_user_integrations").select("config")
        .eq("user_id", uid).eq("provider", "google_calendar").maybeSingle();
      if (calInt?.config) {
        const token = await refreshGoogleToken(calInt.config as Record<string, unknown>, "google_calendar");
        const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const dayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
        const calRes = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events?${new URLSearchParams({ timeMin: dayStart, timeMax: dayEnd, maxResults: "10", singleEvents: "true", orderBy: "startTime" })}`,
          { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
        );
        if (calRes.ok) {
          const calData = await calRes.json();
          calendarEvents = ((calData.items ?? []) as any[]).map((e: any) => ({
            title: String(e.summary ?? "(No title)"),
            start: String(e.start?.dateTime ?? e.start?.date ?? ""),
            end:   String(e.end?.dateTime   ?? e.end?.date   ?? ""),
          }));
        }
      }
    } catch { /* non-critical */ }

    // ── Gmail: unread count + top subjects ───────────────────────────────────
    let unreadCount  = 0;
    let topSubjects: string[] = [];
    try {
      const { data: gmailInt } = await supabase
        .from("mavis_user_integrations").select("config")
        .eq("user_id", uid).eq("provider", "gmail").maybeSingle();
      if (gmailInt?.config) {
        const token = await refreshGoogleToken(gmailInt.config as Record<string, unknown>, "gmail");
        const listRes = await fetch(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread%20in:inbox&maxResults=5",
          { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
        );
        if (listRes.ok) {
          const listData = await listRes.json();
          unreadCount = listData.resultSizeEstimate ?? (listData.messages?.length ?? 0);
          const msgIds = ((listData.messages ?? []) as any[]).slice(0, 3).map((m: any) => m.id as string);
          topSubjects = (await Promise.all(msgIds.map(async (id: string) => {
            const msgRes = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
              { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8_000) },
            );
            if (!msgRes.ok) return null;
            const msg = await msgRes.json();
            const headers = (msg.payload?.headers ?? []) as any[];
            const subj = headers.find((h: any) => h.name === "Subject")?.value ?? "(no subject)";
            const from = headers.find((h: any) => h.name === "From")?.value ?? "";
            const fromName = from.replace(/<[^>]+>/, "").trim().split(" ")[0] ?? from.slice(0, 20);
            return `${fromName}: ${subj.slice(0, 45)}`;
          }))).filter(Boolean) as string[];
        }
      }
    } catch { /* non-critical */ }

    const [
      approvalsRes, questsRes, tasksRes, srRes,
      revenueRes, expensesRes, councilRes, bondRes, goalsRes,
      tacitRes, stalledRes, streakRiskRes, revenueGapRes,
    ] = await Promise.all([
      // Pending approvals
      supabase.from("mavis_tasks")
        .select("id, type, description, created_at")
        .eq("user_id", uid)
        .eq("status", "requires_confirmation")
        .order("created_at", { ascending: false })
        .limit(5),

      // Overdue quests
      supabase.from("quests")
        .select("title, deadline, type")
        .eq("user_id", uid)
        .eq("status", "active")
        .lt("deadline", todayIso)
        .not("deadline", "is", null)
        .limit(5),

      // Today's active tasks (habits due)
      supabase.from("tasks")
        .select("title, recurrence, streak, completed_count")
        .eq("user_id", uid)
        .eq("status", "active")
        .in("recurrence", ["daily", "weekly"])
        .limit(8),

      // Notes due for spaced repetition today
      supabase.from("mavis_notes")
        .select("title, review_interval_days")
        .eq("user_id", uid)
        .lte("next_review_at", now.toISOString())
        .not("tags", "cs", '["daily-log"]')
        .limit(3),

      // Revenue since yesterday
      supabase.from("mavis_revenue")
        .select("amount, source")
        .eq("user_id", uid)
        .gte("created_at", yesterdayIso),

      // Expenses since yesterday
      supabase.from("mavis_expenses")
        .select("amount, description")
        .eq("user_id", uid)
        .gte("expense_date", todayIso),

      // Council recent activity
      supabase.from("mavis_council_activity")
        .select("member_name, summary, actions_executed")
        .eq("user_id", uid)
        .gte("created_at", yesterdayIso)
        .order("created_at", { ascending: false })
        .limit(3),

      // Operator bond
      supabase.from("mavis_bond")
        .select("interaction_count, bond_level, trust_level")
        .eq("user_id", uid)
        .single(),

      // Active goals with quest_ids for progress calculation
      supabase.from("mavis_goals")
        .select("id, objective, status, quest_ids, decomposed")
        .eq("user_id", uid)
        .eq("status", "active")
        .order("created_at", { ascending: true })
        .limit(5),

      // Tacit preferences & hard rules for operator context
      supabase.from("mavis_tacit")
        .select("category, key, value")
        .eq("user_id", uid)
        .in("category", ["hard_rule", "preference"])
        .order("confidence", { ascending: false })
        .limit(8),

      // Pattern: quests idle 7+ days
      supabase.from("quests")
        .select("title")
        .eq("user_id", uid)
        .eq("status", "active")
        .lt("updated_at", sevenDaysAgo)
        .limit(5),

      // Pattern: habit streaks at risk (no activity 2+ days, streak > 2)
      supabase.from("tasks")
        .select("title, streak")
        .eq("user_id", uid)
        .eq("type", "habit")
        .gt("streak", 2)
        .lt("updated_at", twoDaysAgo)
        .limit(5),

      // Pattern: revenue gap (any revenue in last 7 days?)
      supabase.from("mavis_revenue")
        .select("id")
        .eq("user_id", uid)
        .gte("created_at", sevenDaysAgo)
        .limit(1),
    ]);

    const approvals   = (approvalsRes.data ?? []) as any[];
    const overdue     = (questsRes.data ?? []) as any[];
    const tasks       = (tasksRes.data ?? []) as any[];
    const srNotes     = (srRes.data ?? []) as any[];
    const revenue     = (revenueRes.data ?? []) as any[];
    const expenses    = (expensesRes.data ?? []) as any[];
    const council     = (councilRes.data ?? []) as any[];
    const bond        = bondRes.data as any;
    const goals       = (goalsRes.data ?? []) as any[];
    const tacit       = (tacitRes.data ?? []) as any[];
    const stalled     = (stalledRes.data ?? []) as any[];
    const streakRisk  = (streakRiskRes.data ?? []) as any[];
    const revenueGap  = (revenueGapRes.data ?? []) as any[];

    const totalRevenue  = revenue.reduce((s: number, r: any) => s + Number(r.amount), 0);
    const totalExpenses = expenses.reduce((s: number, e: any) => s + Number(e.amount), 0);

    const dayName = now.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
    const dateStr = now.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

    const sections: string[] = [
      `*MAVIS MORNING BRIEF*\n${dayName}, ${dateStr}`,
      "─────────────────────────",
    ];

    // Calendar events for today
    if (calendarEvents.length > 0) {
      const evLines = calendarEvents.map((e) => {
        if (!e.start) return `• ${e.title}`;
        const d = new Date(e.start);
        const isAllDay = e.start.length === 10; // date-only string, no time
        const timeStr = isAllDay ? "All day" : d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "UTC" });
        return `• ${timeStr} — ${e.title}`;
      });
      sections.push(`📅 *TODAY'S CALENDAR* (${calendarEvents.length})\n${evLines.join("\n")}`);
    }

    // Inbox
    if (unreadCount > 0) {
      const inboxLines = [`${unreadCount} unread`, ...topSubjects.map(s => `  · ${s}`)];
      sections.push(`📬 *INBOX*\n${inboxLines.join("\n")}\n→ Say "check my email" to see them`);
    }

    if (approvals.length > 0) {
      sections.push(`⚠️ *NEEDS YOUR APPROVAL* (${approvals.length})\n${approvals.map((t: any) =>
        `• [${t.type}] ${(t.description ?? "").slice(0, 60)}\n  ID: ${t.id.slice(0, 8)}`
      ).join("\n")}\n→ Use /approve [id] or /reject [id]`);
    }

    if (overdue.length > 0) {
      const todayMs = now.getTime();
      const critical: string[] = [];
      const flagged:  string[] = [];
      const normal:   string[] = [];
      for (const q of overdue as any[]) {
        const daysLate = Math.floor((todayMs - new Date(q.deadline + "T00:00:00Z").getTime()) / 86400000);
        const line = `• ${q.title} — was due ${q.deadline} (${daysLate}d late)`;
        if (daysLate > 7)       critical.push(line);
        else if (daysLate >= 2) flagged.push(line);
        else                    normal.push(line);
      }
      const overdueLines: string[] = [];
      if (critical.length) overdueLines.push(`⛔ CRITICAL (${critical.length}):\n${critical.join("\n")}`);
      if (flagged.length)  overdueLines.push(`⚠ FLAGGED (${flagged.length}):\n${flagged.join("\n")}`);
      if (normal.length)   overdueLines.push(normal.join("\n"));
      sections.push(`🗡️ *OVERDUE QUESTS* (${overdue.length})\n${overdueLines.join("\n")}`);
    }

    if (tasks.length > 0) {
      sections.push(`✅ *TODAY'S TASKS* (${tasks.length})\n${tasks.map((t: any) =>
        `• ${t.title}${t.streak > 0 ? ` 🔥${t.streak}` : ""}`
      ).join("\n")}`);
    }

    if (srNotes.length > 0) {
      sections.push(`🧠 *KNOWLEDGE REVIEW* (${srNotes.length} due)\n${srNotes.map((n: any) =>
        `• ${n.title} (every ${n.review_interval_days ?? 7}d)`
      ).join("\n")}\n→ Say "review my notes" to surface them`);
    }

    if (totalRevenue > 0 || totalExpenses > 0) {
      const net = totalRevenue - totalExpenses;
      const parts = [];
      if (totalRevenue > 0) parts.push(`+$${totalRevenue.toFixed(2)} revenue`);
      if (totalExpenses > 0) parts.push(`-$${totalExpenses.toFixed(2)} expenses`);
      parts.push(`net $${net.toFixed(2)}`);
      sections.push(`💰 *LAST 24H FINANCES*\n${parts.join(" · ")}`);
    }

    if (council.length > 0) {
      const totalActions = council.reduce((s: number, c: any) => s + Number(c.actions_executed ?? 0), 0);
      sections.push(`🏛️ *COUNCIL* (${totalActions} actions overnight)\n${council.map((c: any) =>
        `• ${c.member_name}: ${(c.summary ?? "").slice(0, 60)}`
      ).join("\n")}`);
    }

    if (bond) {
      sections.push(`🔗 *OPERATOR BOND*\nInteractions: ${bond.interaction_count} · Bond: ${bond.bond_level} · Trust: ${bond.trust_level}`);
    }

    // Goal progress — compute quest completion % for each active goal
    if (goals.length > 0) {
      const goalLines = await Promise.all(goals.map(async (g: any) => {
        const questIds = Array.isArray(g.quest_ids) ? g.quest_ids : [];
        let completedCount = 0;
        let totalCount     = questIds.length;
        if (totalCount > 0) {
          const { count } = await supabase
            .from("quests")
            .select("id", { count: "exact", head: true })
            .in("id", questIds)
            .eq("status", "completed");
          completedCount = count ?? 0;
        }
        const pct     = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
        const bar     = totalCount > 0 ? `${completedCount}/${totalCount} quests (${pct}%)` : (g.decomposed ? "decomposing..." : "queued");
        const urgency = pct < 25 && totalCount > 0 ? " ←" : "";
        return `• ${g.objective.slice(0, 65)} — ${bar}${urgency}`;
      }));
      sections.push(`🎯 *ACTIVE GOALS* (${goals.length})\n${goalLines.join("\n")}\n→ /goals for full detail`);
    }

    // Pattern alerts
    const patternAlerts: string[] = [];
    if (stalled.length > 0) {
      patternAlerts.push(`${stalled.length} quest(s) idle 7+ days: ${stalled.slice(0, 3).map((q: any) => q.title).join(", ")}`);
    }
    if (streakRisk.length > 0) {
      patternAlerts.push(`${streakRisk.length} habit streak(s) at risk: ${streakRisk.slice(0, 3).map((t: any) => `${t.title} (${t.streak}d)`).join(", ")}`);
    }
    if (revenueGap.length === 0) {
      patternAlerts.push("No revenue logged in the past 7 days.");
    }
    if (patternAlerts.length > 0) {
      sections.push(`⚡ *PATTERN ALERTS*\n${patternAlerts.map(a => `• ${a}`).join("\n")}`);
    }

    // Operator context (hard rules + top preferences)
    const hardRules   = tacit.filter((t: any) => t.category === "hard_rule");
    const preferences = tacit.filter((t: any) => t.category === "preference");
    const tacitLines: string[] = [];
    if (hardRules.length > 0)   tacitLines.push(`Rules: ${hardRules.map((r: any) => r.value).join(" | ")}`);
    if (preferences.length > 0) tacitLines.push(`Prefs: ${preferences.slice(0, 4).map((r: any) => r.value).join(" | ")}`);
    if (tacitLines.length > 0) {
      sections.push(`📋 *STANDING ORDERS*\n${tacitLines.join("\n")}`);
    }

    if (sections.length === 2) {
      sections.push("✨ All clear. No pending items, no overdue quests, no SR reviews.\nHave a focused day.");
    }

    // ── Proactive memory surfacing ──────────────────────────────
    // Find a past note semantically related to the operator's current focus
    try {
      const openaiKey = Deno.env.get("OPENAI_API");
      if (openaiKey) {
        // Build a query from active quest titles + goal objectives
        const focusTerms = [
          ...(questsRes.data ?? []).slice(0, 3).map((q: any) => q.title),
          ...(goalsRes.data ?? []).slice(0, 2).map((g: any) => g.objective),
        ].join(". ");

        if (focusTerms.trim().length > 10) {
          // Embed the focus context
          const embedRes = await fetch("https://api.openai.com/v1/embeddings", {
            method: "POST",
            headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: "text-embedding-3-small", input: focusTerms }),
          });
          const embedData = await embedRes.json();
          const embedding = embedData.data?.[0]?.embedding;

          if (embedding) {
            // Semantic search for the most relevant past note NOT from the last 7 days
            const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
            const { data: related } = await supabase.rpc("match_mavis_notes", {
              query_embedding: embedding,
              match_threshold: 0.65,
              match_count: 3,
              p_user_id: uid,
            });

            const surfaced = (related ?? []).filter((n: any) => n.created_at < weekAgo).slice(0, 1);
            if (surfaced.length > 0) {
              const note = surfaced[0];
              const daysAgo = Math.round((now.getTime() - new Date(note.created_at).getTime()) / 86400000);
              sections.push(
                `💡 *MEMORY SURFACED*\nRelevant to your current focus (${daysAgo}d ago):\n_"${note.title}"_\n${note.content?.slice(0, 180) ?? ""}…\n→ Open in Vault to review`
              );
            }
          }
        }
      }
    } catch { /* non-critical, skip on error */ }

    const briefText = sections.join("\n\n");
    await sendTelegram(briefText);

    // Store brief in DB for in-app display
    try {
      const sectionsData: Record<string, unknown> = {
        pending_approvals: approvals.length,
        overdue_quests: overdue.length,
        tasks_today: tasks.slice(0, 5).map((t: any) => t.title),
        sr_notes_due: srNotes.length,
        revenue_24h: totalRevenue,
        expenses_24h: totalExpenses,
        net_24h: totalRevenue - totalExpenses,
        council_actions: council.reduce((s: number, c: any) => s + Number(c.actions_executed ?? 0), 0),
        stalled_quests: stalled.length,
        streak_risks: streakRisk.length,
        revenue_gap_7d: revenueGap.length === 0,
      };
      await supabase.from("mavis_daily_briefs").upsert({
        user_id: uid,
        brief_date: todayIso,
        brief_text: briefText,
        sections: sectionsData,
      }, { onConflict: "user_id,brief_date" });
    } catch { /* non-critical — Telegram already sent */ }

    // ── Push summary to mavis_insights for in-app Notifications page ─────────
    // OpenHuman morning briefing pattern: brief is delivered both to external
    // channel (Telegram) and persisted as an in-app notification/insight.
    try {
      const alertCount = patternAlerts.length + overdue.length + approvals.length;
      const severity = alertCount > 3 ? "warning" : alertCount > 0 ? "info" : "info";
      await supabase.from("mavis_insights").insert({
        user_id: uid,
        title: `Morning Brief — ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}`,
        content: briefText.slice(0, 2000),
        category: "morning_brief",
        severity,
        source: "morning_brief",
      });
    } catch { /* non-critical */ }

    return new Response(
      JSON.stringify({ ok: true, sections: sections.length - 2 }),
      { headers: { "Content-Type": "application/json" } },
    );

  } catch (err) {
    console.error("[mavis-morning-brief]", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
