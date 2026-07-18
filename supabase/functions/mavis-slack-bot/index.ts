import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

// HMAC-SHA256 verification using Web Crypto
async function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  rawBody: string,
  slackSignature: string
): Promise<boolean> {
  try {
    const sigBaseString = `v0:${timestamp}:${rawBody}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(signingSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(sigBaseString)
    );
    const hashArray = Array.from(new Uint8Array(signatureBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    const computedSig = `v0=${hashHex}`;
    return computedSig === slackSignature;
  } catch {
    return false;
  }
}

// Call Claude Haiku with MAVIS persona
async function callMavis(query: string, context: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: `You are MAVIS, a sovereign AI personal OS. Answer concisely (max 200 words). You're responding via Slack. Context: ${context}`,
      messages: [{ role: "user", content: query }],
    }),
  });

  const data = await res.json();
  return data.content?.[0]?.text ?? "MAVIS is unavailable right now.";
}

// Create a Linear issue via mavis-linear-agent
async function createLinearIssue(title: string, description?: string): Promise<{ url: string; identifier: string; teamName: string } | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const agentUrl    = `${supabaseUrl}/functions/v1/mavis-linear-agent`;
  const headers     = { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` };

  // Get first available team
  const teamsRes  = await fetch(agentUrl, { method: "POST", headers, body: JSON.stringify({ action: "get_teams" }) });
  const teamsData = await teamsRes.json();
  const team      = teamsData.teams?.[0];
  if (!team) return null;

  // Create the issue
  const issueRes  = await fetch(agentUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "create_issue", title, description: description ?? "", team_id: team.id }),
  });
  const issueData = await issueRes.json();
  const issue     = issueData.issue;
  if (!issue) return null;

  return { url: issue.url, identifier: issue.identifier, teamName: team.name };
}

// Post a message to Slack
async function postSlackMessage(
  channel: string,
  text: string,
  threadTs?: string
): Promise<void> {
  const botToken = Deno.env.get("SLACK_BOT_TOKEN")!;
  const body: Record<string, string> = { channel, text };
  if (threadTs) body.thread_ts = threadTs;

  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify(body),
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const uid = Deno.env.get("TELEGRAM_OPERATOR_USER_ID")!;
    const contentType = req.headers.get("content-type") ?? "";
    const rawBody = await req.text();

    // ── Slash command (application/x-www-form-urlencoded) ──────────────────
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(rawBody);
      const command = params.get("command");
      const text = params.get("text") ?? "";
      const responseUrl = params.get("response_url");

      if (command === "/mavis" && responseUrl) {
        // Immediately acknowledge (Slack requires < 3s)
        const ackResponse = new Response(
          JSON.stringify({ text: "MAVIS is thinking..." }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );

        // Process in background
        (async () => {
          try {
            const response = await callMavis(text, "Slack slash command");

            // Log to mavis_memory
            await supabase.from("mavis_memory").insert({
              role: "assistant",
              content: response,
              session_id: "slack-bot",
              user_id: uid,
            }).then(() => {}).catch(() => {});

            // POST actual response to Slack via response_url
            await fetch(responseUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                replace_original: true,
                text: `MAVIS: ${response}`,
              }),
            });
          } catch (bgErr) {
            console.error("Slash command background error:", bgErr);
            await fetch(responseUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                replace_original: true,
                text: "MAVIS encountered an error processing your request.",
              }),
            });
          }
        })();

        return ackResponse;
      }

      if (command === "/linear" && responseUrl) {
        const ackResponse = new Response(
          JSON.stringify({ text: ":linear: Creating Linear ticket..." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );

        (async () => {
          try {
            // First line becomes the title; rest becomes description
            const [titleLine, ...rest] = text.trim().split("\n");
            const title       = titleLine?.trim() || "Task from Slack";
            const description = rest.join("\n").trim() || undefined;

            const issue = await createLinearIssue(title, description);
            const reply = issue
              ? `:white_check_mark: *Linear ticket created*\n*${issue.identifier}* — ${issue.teamName}\n<${issue.url}|${title}>`
              : ":x: Failed to create Linear ticket. Is LINEAR_API_KEY configured?";

            await fetch(responseUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ replace_original: true, text: reply }),
            });
          } catch (bgErr) {
            console.error("Linear slash command error:", bgErr);
            await fetch(responseUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ replace_original: true, text: ":x: MAVIS encountered an error creating the Linear ticket." }),
            });
          }
        })();

        return ackResponse;
      }

      // Unknown slash command
      return new Response(
        JSON.stringify({ text: "Unknown command. Try `/mavis [question]` or `/linear [task description]`." }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── Event API (application/json) ──────────────────────────────────────
    if (contentType.includes("application/json")) {
      const payload = JSON.parse(rawBody);

      // URL verification challenge
      if (payload.type === "url_verification") {
        return new Response(
          JSON.stringify({ challenge: payload.challenge }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Verify Slack signing secret
      const signingSecret = Deno.env.get("SLACK_SIGNING_SECRET")!;
      const timestamp = req.headers.get("x-slack-request-timestamp") ?? "";
      const slackSignature = req.headers.get("x-slack-signature") ?? "";

      const isValid = await verifySlackSignature(
        signingSecret,
        timestamp,
        rawBody,
        slackSignature
      );

      if (!isValid) {
        return new Response(JSON.stringify({ error: "Invalid signature" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Handle app_mention or DM message events
      const event = payload.event;
      if (
        event &&
        (event.type === "app_mention" ||
          (event.type === "message" && event.channel_type === "im"))
      ) {
        // Ignore bot messages to prevent loops
        if (event.bot_id || event.subtype) {
          return new Response(JSON.stringify({ ok: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const userText: string = event.text ?? "";
        const channel: string = event.channel;
        const eventTs: string = event.ts;

        // Strip mention prefix if present (<@BOTID> text)
        const cleanText = userText.replace(/<@[A-Z0-9]+>/g, "").trim();

        // Call MAVIS
        const context =
          event.type === "app_mention" ? "Slack channel mention" : "Slack DM";
        const response = await callMavis(cleanText, context);

        // Log to mavis_memory
        await supabase.from("mavis_memory").insert({
          role: "assistant",
          content: response,
          session_id: "slack-bot",
          user_id: uid,
        }).then(() => {}).catch(() => {});

        // Post reply in thread
        await postSlackMessage(channel, response, eventTs);
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Unrecognised content type
    return new Response(JSON.stringify({ error: "Unsupported content type" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("mavis-slack-bot error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
