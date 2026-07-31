// mavis-chat/toolDispatch.ts
// ACTION-block parsing/execution and native tool-calling (Gemini function-
// calling + Claude tool_use) — extracted from index.ts (Stabilization Brief
// Phase 2.6). Parameter-driven; depends on providers.ts for the underlying
// model calls.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { isProviderUnhealthy, callClaude, callGemini } from "./providers.ts";

// ============================================================
// REACT AGENTIC LOOP — ACTION block parsing and execution
// ============================================================

export function parseActionBlocks(text: string): Array<{ type: string; params: Record<string, unknown> }> {
  const blocks: Array<{ type: string; params: Record<string, unknown> }> = [];
  const re = /:::ACTION(\{[\s\S]*?\}):::/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(m[1]) as Record<string, unknown>;
      const type = String(parsed.type ?? parsed.action ?? "");
      if (!type) continue;
      // If the block has an explicit "params" key, use it directly.
      // Otherwise fall back to spreading everything except type/action (flat format).
      const params: Record<string, unknown> =
        parsed.params && typeof parsed.params === "object"
          ? parsed.params as Record<string, unknown>
          : (({ type: _t, action: _a, ...rest }) => rest)(parsed);
      blocks.push({ type, params });
    } catch { /* malformed block — skip */ }
  }
  return blocks;
}

export async function executeAgentAction(
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
  type: string,
  params: Record<string, unknown>,
): Promise<{ ok: boolean; result: unknown }> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/mavis-actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ userId, actions: [{ type, params }] }),
      signal: AbortSignal.timeout(120_000),
    });
    const data = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok) return { ok: false, result: { error: data.error ?? `HTTP ${res.status}` } };
    const firstResult = Array.isArray(data.results) ? (data.results as Array<Record<string, unknown>>)[0] : null;
    if (firstResult?.success === false) {
      return { ok: false, result: { error: firstResult.error ?? "Action returned success=false" } };
    }
    return { ok: true, result: data };
  } catch (e: any) {
    return { ok: false, result: { error: e.message ?? "Action execution failed" } };
  }
}

export function formatToolResults(results: Array<{ type: string; ok: boolean; result: unknown }>): string {
  return results
    .map((r, i) =>
      `[ACTION ${i + 1}: ${r.type}]\nStatus: ${r.ok ? "success" : "error"}\n${JSON.stringify(r.result, null, 2).slice(0, 2000)}`
    )
    .join("\n\n");
}

// ============================================================
// NATIVE TOOL-USE — Gemini function calling + Claude tool_use
// Prymal pattern: validated JSON schemas → no regex parsing errors
// ============================================================

export interface MavToolParam { type: string; desc: string; required?: boolean; enum?: string[] }
export interface MavToolDef { name: string; description: string; params: Record<string, MavToolParam> }

export const MAVIS_TOOL_DEFS: MavToolDef[] = [
  {
    name: "create_quest",
    description: "Create a new quest or task for the operator to track and complete",
    params: {
      title:       { type: "string", desc: "Quest title",                                 required: true },
      description: { type: "string", desc: "What needs to be done" },
      type:        { type: "string", desc: "Quest type",                                  enum: ["daily","side","main","epic"] },
      xp_reward:   { type: "number", desc: "XP to award on completion (default 50)" },
    },
  },
  {
    name: "complete_quest",
    description: "Mark a quest or task as completed",
    params: {
      title: { type: "string", desc: "Title of the quest to complete", required: true },
    },
  },
  {
    name: "create_journal",
    description: "Create a journal entry in the operator's second brain",
    params: {
      title:    { type: "string", desc: "Entry title",          required: true },
      content:  { type: "string", desc: "Full journal content", required: true },
      category: { type: "string", desc: "Entry category",       enum: ["general","reflection","gratitude","focus","dream"] },
      mood:     { type: "string", desc: "Operator mood (optional)" },
    },
  },
  {
    name: "create_vault",
    description: "Save important information to the operator's secure vault",
    params: {
      title:    { type: "string", desc: "Vault entry title", required: true },
      content:  { type: "string", desc: "Content to save",   required: true },
      category: { type: "string", desc: "Vault category",    required: true, enum: ["legal","business","personal","evidence","achievement"] },
    },
  },
  {
    name: "create_note",
    description: "Create a note in the operator's knowledge base",
    params: {
      title:   { type: "string", desc: "Note title",   required: true },
      content: { type: "string", desc: "Note content", required: true },
    },
  },
  {
    name: "log_expense",
    description: "Log a financial expense for the operator",
    params: {
      description: { type: "string", desc: "What was spent on", required: true },
      amount:      { type: "number", desc: "Amount in dollars",  required: true },
      category:    { type: "string", desc: "Expense category",   enum: ["food","transport","entertainment","business","health","other"] },
      date:        { type: "string", desc: "Date (YYYY-MM-DD), defaults to today" },
    },
  },
  {
    name: "create_goal",
    description: "Create a high-level strategic goal for MAVIS to decompose and track",
    params: {
      objective: { type: "string", desc: "The goal objective",             required: true },
      context:   { type: "string", desc: "Background context for the goal" },
    },
  },
  {
    name: "award_xp",
    description: "Award experience points to the operator",
    params: {
      amount: { type: "number", desc: "XP amount to award", required: true },
      reason: { type: "string", desc: "Why XP is being awarded" },
    },
  },
  {
    name: "create_skill",
    description: "Add a new skill to the operator's skill tree",
    params: {
      name:     { type: "string", desc: "Skill name",     required: true },
      category: { type: "string", desc: "Skill category" },
      tier:     { type: "number", desc: "Skill tier 1-5" },
    },
  },
  {
    name: "create_ally",
    description: "Add a person as an ally in the operator's network",
    params: {
      name:         { type: "string", desc: "Ally name",           required: true },
      relationship: { type: "string", desc: "Relationship type",   enum: ["ally","council","rival","contact","mentor","partner"] },
      notes:        { type: "string", desc: "Notes about this person" },
    },
  },
  {
    name: "complete_ritual",
    description: "Mark a ritual or habit as completed for today, incrementing its streak",
    params: {
      name: { type: "string", desc: "Name of the ritual to complete", required: true },
    },
  },
  {
    name: "create_council_member",
    description: "Add a new member to the operator's AI council",
    params: {
      name:      { type: "string", desc: "Council member name",  required: true },
      role:      { type: "string", desc: "Their role or title" },
      specialty: { type: "string", desc: "Area of expertise" },
      class:     { type: "string", desc: "Council class",        enum: ["core","advisory","think-tank","shadows"] },
      notes:     { type: "string", desc: "Personality or background notes" },
    },
  },
  {
    name: "generate_image",
    description: "Generate an AI image based on a description. provider picks a specific backend instead of the automatic cascade: auto | flux-pro | imagen-4 | openai | modelslab | stable-diffusion | lovable | pollinations | promptchan. promptchan is NSFW-capable — only pick it when the operator has explicitly asked for that provider by name or for explicit/adult content, never inferred.",
    params: {
      prompt:       { type: "string", desc: "Image description / prompt", required: true },
      aspect_ratio: { type: "string", desc: "Aspect ratio",               enum: ["1:1","16:9","9:16"] },
      provider:     { type: "string", desc: "auto | flux-pro | imagen-4 | openai | modelslab | stable-diffusion | lovable | pollinations | promptchan. Omit for the automatic cascade." },
    },
  },
  {
    name: "forge_persona",
    description: "Create a new AI persona for the operator to chat with",
    params: {
      description: { type: "string", desc: "Full description of the persona — name, personality, role, backstory", required: true },
    },
  },
  // ── Gmail ──────────────────────────────────────────────────────────────
  {
    name: "get_emails",
    description: "Fetch recent emails from Gmail inbox. Use when the user wants to read, check, or review their email.",
    params: {
      max_results: { type: "number", desc: "Maximum number of emails to return (default 10)" },
      label_ids: { type: "string", desc: "Comma-separated Gmail label IDs to filter by (e.g. INBOX, SENT, UNREAD)" },
      query: { type: "string", desc: "Gmail search query string (e.g. 'from:boss@co.com is:unread')" },
    },
  },
  {
    name: "send_email",
    description: "Send an email via Gmail. Use when the user explicitly asks to send or draft an email.",
    params: {
      to: { type: "string", desc: "Recipient email address", required: true },
      subject: { type: "string", desc: "Email subject line", required: true },
      body: { type: "string", desc: "Plain-text email body", required: true },
      cc: { type: "string", desc: "CC email addresses (comma-separated)" },
      bcc: { type: "string", desc: "BCC email addresses (comma-separated)" },
    },
  },
  {
    name: "get_email_thread",
    description: "Fetch the full conversation thread for a specific Gmail message ID.",
    params: {
      message_id: { type: "string", desc: "Gmail message ID", required: true },
    },
  },
  {
    name: "archive_email",
    description: "Archive (remove from inbox) a Gmail message.",
    params: {
      message_id: { type: "string", desc: "Gmail message ID to archive", required: true },
    },
  },
  {
    name: "delete_email",
    description: "Permanently delete or trash a Gmail message.",
    params: {
      message_id: { type: "string", desc: "Gmail message ID to delete", required: true },
    },
  },
  {
    name: "mark_email",
    description: "Mark a Gmail message as read or unread.",
    params: {
      message_id: { type: "string", desc: "Gmail message ID", required: true },
      read: { type: "string", desc: "Set to 'true' to mark as read, 'false' to mark as unread", enum: ["true", "false"], required: true },
    },
  },
  // ── Google Calendar ────────────────────────────────────────────────────
  {
    name: "get_calendar_events",
    description: "Fetch upcoming events from Google Calendar. Use when user asks about their schedule, upcoming meetings, or what's on their calendar.",
    params: {
      max_results: { type: "number", desc: "Maximum events to return (default 10)" },
      time_min: { type: "string", desc: "Start of time range in ISO 8601 format (default: now)" },
      time_max: { type: "string", desc: "End of time range in ISO 8601 format" },
      calendar_id: { type: "string", desc: "Calendar ID (default: primary)" },
    },
  },
  {
    name: "get_availability",
    description: "Check free/busy availability in Google Calendar for scheduling.",
    params: {
      time_min: { type: "string", desc: "Start of window in ISO 8601 format", required: true },
      time_max: { type: "string", desc: "End of window in ISO 8601 format", required: true },
    },
  },
  {
    name: "create_event",
    description: "Create or schedule an event in Google Calendar.",
    params: {
      title: { type: "string", desc: "Event title/summary", required: true },
      start: { type: "string", desc: "Start time in ISO 8601 format", required: true },
      end: { type: "string", desc: "End time in ISO 8601 format", required: true },
      description: { type: "string", desc: "Event description or notes" },
      location: { type: "string", desc: "Physical or virtual location" },
      attendees: { type: "string", desc: "Comma-separated attendee email addresses" },
      calendar_id: { type: "string", desc: "Calendar ID (default: primary)" },
    },
  },
  {
    name: "update_calendar_event",
    description: "Update an existing Google Calendar event.",
    params: {
      event_id: { type: "string", desc: "Google Calendar event ID", required: true },
      title: { type: "string", desc: "New event title" },
      start: { type: "string", desc: "New start time in ISO 8601 format" },
      end: { type: "string", desc: "New end time in ISO 8601 format" },
      description: { type: "string", desc: "New event description" },
      location: { type: "string", desc: "New event location" },
      calendar_id: { type: "string", desc: "Calendar ID (default: primary)" },
    },
  },
  {
    name: "delete_calendar_event",
    description: "Delete or cancel an event from Google Calendar.",
    params: {
      event_id: { type: "string", desc: "Google Calendar event ID to delete", required: true },
      calendar_id: { type: "string", desc: "Calendar ID (default: primary)" },
    },
  },
  {
    name: "schedule_meet",
    description: "Create a Google Calendar event with an auto-generated Google Meet video link.",
    params: {
      title: { type: "string", desc: "Meeting title", required: true },
      start: { type: "string", desc: "Start time in ISO 8601 format", required: true },
      end: { type: "string", desc: "End time in ISO 8601 format", required: true },
      attendees: { type: "string", desc: "Comma-separated attendee email addresses" },
      description: { type: "string", desc: "Meeting agenda or description" },
    },
  },
  // ── Google Tasks ───────────────────────────────────────────────────────
  {
    name: "list_google_tasks",
    description: "List tasks from Google Tasks. Use when user asks about their to-do list or Google Tasks.",
    params: {
      tasklist_id: { type: "string", desc: "Task list ID (default: @default)" },
      show_completed: { type: "string", desc: "Include completed tasks: true or false", enum: ["true", "false"] },
    },
  },
  {
    name: "complete_google_task",
    description: "Mark a Google Task as completed.",
    params: {
      task_id: { type: "string", desc: "Task ID to mark complete", required: true },
      tasklist_id: { type: "string", desc: "Task list ID (default: @default)" },
    },
  },
  {
    name: "update_google_task",
    description: "Update the title or due date of a Google Task.",
    params: {
      task_id: { type: "string", desc: "Task ID to update", required: true },
      title: { type: "string", desc: "New task title" },
      due: { type: "string", desc: "New due date in ISO 8601 format" },
      tasklist_id: { type: "string", desc: "Task list ID (default: @default)" },
    },
  },
  // ── Google Drive ───────────────────────────────────────────────────────
  {
    name: "list_drive_files",
    description: "List files and folders in Google Drive. Use when user asks what's in their Drive or wants to browse files.",
    params: {
      folder_id: { type: "string", desc: "Folder ID to list (default: root)" },
      max_results: { type: "number", desc: "Maximum files to return (default 20)" },
    },
  },
  {
    name: "search_drive_files",
    description: "Search for files in Google Drive by name or content.",
    params: {
      query: { type: "string", desc: "Search query (e.g. 'name contains budget')", required: true },
      max_results: { type: "number", desc: "Maximum files to return (default 10)" },
    },
  },
  {
    name: "get_file_info",
    description: "Get metadata and details for a specific Google Drive file.",
    params: {
      file_id: { type: "string", desc: "Google Drive file ID", required: true },
    },
  },
  {
    name: "read_drive_file",
    description: "Read the text content of a Google Drive file (Docs, plain text, etc.).",
    params: {
      file_id: { type: "string", desc: "Google Drive file ID", required: true },
    },
  },
  {
    name: "create_drive_folder",
    description: "Create a new folder in Google Drive.",
    params: {
      name: { type: "string", desc: "Folder name", required: true },
      parent_id: { type: "string", desc: "Parent folder ID (default: root)" },
    },
  },
  {
    name: "move_file",
    description: "Move a file or folder to a different location in Google Drive.",
    params: {
      file_id: { type: "string", desc: "File or folder ID to move", required: true },
      new_parent_id: { type: "string", desc: "Destination folder ID", required: true },
    },
  },
  {
    name: "rename_file",
    description: "Rename a file or folder in Google Drive.",
    params: {
      file_id: { type: "string", desc: "File or folder ID to rename", required: true },
      new_name: { type: "string", desc: "New name for the file/folder", required: true },
    },
  },
  {
    name: "share_file",
    description: "Share a Google Drive file with another person or set sharing permissions.",
    params: {
      file_id: { type: "string", desc: "File or folder ID to share", required: true },
      email: { type: "string", desc: "Email address of the person to share with" },
      role: { type: "string", desc: "Permission role", enum: ["reader", "commenter", "writer", "owner"] },
      type: { type: "string", desc: "Share type", enum: ["user", "group", "domain", "anyone"] },
    },
  },
  // ── Google Docs ────────────────────────────────────────────────────────
  {
    name: "read_document",
    description: "Read the full text content of a Google Docs document.",
    params: {
      document_id: { type: "string", desc: "Google Docs document ID", required: true },
    },
  },
  // ── Google Sheets ──────────────────────────────────────────────────────
  {
    name: "create_sheet",
    description: "Create a new Google Spreadsheet with an optional header row.",
    params: {
      title: { type: "string", desc: "Spreadsheet title", required: true },
      headers: { type: "string", desc: "Comma-separated column headers for the first row" },
    },
  },
  {
    name: "read_sheet",
    description: "Read cell data from a Google Spreadsheet.",
    params: {
      spreadsheet_id: { type: "string", desc: "Google Sheets spreadsheet ID", required: true },
      range: { type: "string", desc: "A1 notation range (e.g. Sheet1!A1:D10, default: Sheet1!A1:Z100)" },
    },
  },
  {
    name: "update_sheet",
    description: "Write or update cell values in a Google Spreadsheet.",
    params: {
      spreadsheet_id: { type: "string", desc: "Google Sheets spreadsheet ID", required: true },
      range: { type: "string", desc: "A1 notation range to write to", required: true },
      values: { type: "string", desc: "JSON array of rows (e.g. [[\"a\",\"b\"],[\"c\",\"d\"]])", required: true },
    },
  },
  // ── Google Slides ──────────────────────────────────────────────────────
  {
    name: "create_presentation",
    description: "Create a new Google Slides presentation with a title slide.",
    params: {
      title: { type: "string", desc: "Presentation title", required: true },
      subtitle: { type: "string", desc: "Optional subtitle text for the title slide" },
    },
  },
  {
    name: "read_presentation",
    description: "Read the text content of all slides in a Google Slides presentation.",
    params: {
      presentation_id: { type: "string", desc: "Google Slides presentation ID", required: true },
    },
  },
  // ── Google Contacts ────────────────────────────────────────────────────
  {
    name: "create_contact",
    description: "Create a new contact in Google Contacts.",
    params: {
      name: { type: "string", desc: "Contact full name", required: true },
      email: { type: "string", desc: "Contact email address" },
      phone: { type: "string", desc: "Contact phone number" },
      notes: { type: "string", desc: "Notes or additional information about the contact" },
    },
  },
  {
    name: "list_contacts",
    description: "List contacts from Google Contacts.",
    params: {
      max_results: { type: "number", desc: "Maximum contacts to return (default 20)" },
    },
  },
  {
    name: "search_contacts",
    description: "Search Google Contacts by name, email, or phone number.",
    params: {
      query: { type: "string", desc: "Search query string", required: true },
    },
  },
  {
    name: "update_contact",
    description: "Update an existing Google Contact's details.",
    params: {
      resource_name: { type: "string", desc: "Contact resource name (e.g. people/c12345)", required: true },
      name: { type: "string", desc: "Updated full name" },
      email: { type: "string", desc: "Updated email address" },
      phone: { type: "string", desc: "Updated phone number" },
      notes: { type: "string", desc: "Updated notes" },
      etag: { type: "string", desc: "Contact etag for optimistic locking", required: true },
    },
  },
  {
    name: "delete_contact",
    description: "Delete a contact from Google Contacts.",
    params: {
      resource_name: { type: "string", desc: "Contact resource name (e.g. people/c12345)", required: true },
    },
  },
  // ── HyperFrames video rendering ─────────────────────────────────────────
  {
    name: "render_video",
    description: "Render a short MP4 video from an HTML/CSS composition (e.g. a quest-completion recap, a weekly-stats reel, a persona clip). Write the composition yourself as a single HTML fragment using HyperFrames conventions: a root element with data-composition-id/data-width/data-height, and child elements (video/img/div) with data-start and data-duration (seconds) marking when each appears. This submits an async render job — it does NOT return the finished video immediately; call check_video_render afterward (or on a later turn) with the returned render_id to get the final URL. Only use when the operator actually wants a rendered video, not for describing one.",
    params: {
      composition_html: { type: "string", desc: "The full HTML composition to render, using HyperFrames data-* timing attributes", required: true },
      assets:           { type: "string", desc: "Comma-separated URLs of any images/video/audio referenced by the composition" },
      width:            { type: "number", desc: "Output width in pixels (default 1920)" },
      height:           { type: "number", desc: "Output height in pixels (default 1080)" },
      fps:              { type: "number", desc: "Output frame rate (default 30)" },
    },
  },
  {
    name: "check_video_render",
    description: "Check the status of a video render previously started with render_video. Returns 'rendering', 'ready' (with the final video URL), or 'failed'.",
    params: {
      render_id: { type: "string", desc: "The render_id returned by render_video", required: true },
    },
  },
  // ── Deep web research ──────────────────────────────────────────────────
  {
    name: "deep_research",
    description: "Run a multi-angle deep web research pass — plans several distinct search angles, searches each, and synthesizes a structured, cited report. Use for questions that need real investigation (a topic, product, company, technology, claim, current event) rather than a quick fact lookup — especially when the operator wants a thorough breakdown or to be taught about something in depth. Slower than a normal reply (10-25s); do not use for simple questions you already know the answer to.",
    params: {
      query: { type: "string", desc: "The research question or topic, phrased as a complete, specific query", required: true },
      depth: { type: "number", desc: "Number of distinct search angles to explore, 1-5 (default 3). Use 4-5 for genuinely broad/complex topics." },
    },
  },
  // ── A2A: consult another entity ───────────────────────────────────────────
  {
    name: "consult_entity",
    description: "Invoke another AI persona or council member's LLM in real-time to get their actual perspective on a topic. Use when you genuinely need another entity's unique view — not for simple questions MAVIS can answer directly.",
    params: {
      name:     { type: "string", desc: "Exact name of the persona or council member to consult", required: true },
      question: { type: "string", desc: "The specific question or topic to ask them about",         required: true },
    },
  },
  // ── Google Business Profile ────────────────────────────────────────────
  {
    name: "get_gbp_reviews",
    description: "Fetch reviews from Google Business Profile. Use when user asks about their business reviews or what customers are saying.",
    params: {
      account_id: { type: "string", desc: "GBP account ID", required: true },
      location_id: { type: "string", desc: "GBP location ID", required: true },
      max_results: { type: "number", desc: "Maximum reviews to return (default 10)" },
    },
  },
  {
    name: "respond_to_review",
    description: "Post a reply to a Google Business Profile review.",
    params: {
      account_id: { type: "string", desc: "GBP account ID", required: true },
      location_id: { type: "string", desc: "GBP location ID", required: true },
      review_id: { type: "string", desc: "Review ID to reply to", required: true },
      comment: { type: "string", desc: "Reply text to post", required: true },
    },
  },
  {
    name: "create_gbp_post",
    description: "Create a Google Business Profile post (What's New, Event, Offer, etc.).",
    params: {
      account_id: { type: "string", desc: "GBP account ID", required: true },
      location_id: { type: "string", desc: "GBP location ID", required: true },
      summary: { type: "string", desc: "Post text content", required: true },
      topic_type: { type: "string", desc: "Post type", enum: ["STANDARD", "EVENT", "OFFER", "PRODUCT"], required: true },
      call_to_action_type: { type: "string", desc: "CTA button type", enum: ["LEARN_MORE", "SIGN_UP", "SHOP", "ORDER", "GET_OFFER", "BOOK", "CALL"] },
      call_to_action_url: { type: "string", desc: "URL for the CTA button" },
    },
  },
];

export function toGeminiFunctions(defs: MavToolDef[]): object[] {
  return [{
    functionDeclarations: defs.map(d => ({
      name: d.name,
      description: d.description,
      parameters: {
        type: "OBJECT",
        properties: Object.fromEntries(
          Object.entries(d.params).map(([k, v]) => [k, {
            type: v.type === "number" ? "NUMBER" : v.type === "boolean" ? "BOOLEAN" : "STRING",
            description: v.desc,
            ...(v.enum ? { enum: v.enum } : {}),
          }])
        ),
        required: Object.entries(d.params).filter(([, v]) => v.required).map(([k]) => k),
      },
    })),
  }];
}

export function toClaudeTools(defs: MavToolDef[]): object[] {
  return defs.map(d => ({
    name: d.name,
    description: d.description,
    input_schema: {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(d.params).map(([k, v]) => [k, {
          type: v.type,
          description: v.desc,
          ...(v.enum ? { enum: v.enum } : {}),
        }])
      ),
      required: Object.entries(d.params).filter(([, v]) => v.required).map(([k]) => k),
    },
  }));
}

export async function callGeminiForTools(
  messages: any[], system: string, key: string,
): Promise<Array<{ name: string; args: Record<string, unknown> }>> {
  const contents = messages.slice(-8).map((m: any) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: (typeof m.content === "string" ? m.content : JSON.stringify(m.content)).slice(0, 2000) }],
  }));
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system.slice(0, 4000) }] },
          contents,
          tools: toGeminiFunctions(MAVIS_TOOL_DEFS),
          toolConfig: { functionCallingConfig: { mode: "AUTO" } },
          generationConfig: { maxOutputTokens: 256 },
        }),
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (!res.ok) return [];
    const d = await res.json();
    const parts: any[] = d.candidates?.[0]?.content?.parts ?? [];
    return parts
      .filter((p: any) => p.functionCall)
      .map((p: any) => ({ name: String(p.functionCall.name), args: (p.functionCall.args ?? {}) as Record<string, unknown> }));
  } catch { return []; }
}

export async function callClaudeForTools(
  messages: any[], system: string, key: string,
): Promise<Array<{ name: string; args: Record<string, unknown> }>> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 256,
        system: system.slice(0, 4000),
        messages: messages.slice(-8).map((m: any) => ({
          role: m.role,
          content: (typeof m.content === "string" ? m.content : JSON.stringify(m.content)).slice(0, 2000),
        })),
        tools: toClaudeTools(MAVIS_TOOL_DEFS),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const d = await res.json();
    return (d.content ?? [])
      .filter((b: any) => b.type === "tool_use")
      .map((b: any) => ({ name: String(b.name), args: (b.input ?? {}) as Record<string, unknown> }));
  } catch { return []; }
}

// Phrases that suggest the operator wants real investigation, not a quick reply —
// shared between hasActionIntent (gates whether the tool pre-pass runs at all) and
// hasResearchIntent (grants deep_research a longer pre-pass timeout budget in index.ts,
// since a real multi-angle research pass routinely runs well past the default 12s).
const RESEARCH_KWS = [
  "research ", "deep dive", "look into", "investigate", "dig into",
  "comprehensive report on", "everything about", "everything on",
  "teach me about", "teach me everything", "break down", "breakdown of",
  "analyze this", "analyze the", "full analysis", "in-depth", "thorough analysis",
];

export function hasResearchIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return RESEARCH_KWS.some(kw => lower.includes(kw));
}

export function hasActionIntent(text: string): boolean {
  const lower = text.toLowerCase();
  const kws = [
    ...RESEARCH_KWS,
    "create ","add a ","make a ","log ","track ","record ","save to ",
    "complete ","finish ","mark as done","done with",
    "new quest","new note","new journal","new goal","new skill","new ally",
    "vault entry","journal entry","council member",
    "award xp","give xp","add xp",
    "generate image","create image","forge persona","create persona",
    "render a video","render video","make a video","create a video","video recap","recap video",
    // A2A / cross-entity (explicit names)
    "ask ","consult ","what does","what would","'s thoughts","'s take","'s opinion","'s perspective",
    "have them discuss","get their take","what do they think","let them weigh in",
    // A2A pronoun-based ("I want to know his opinion", "what does he think", "her thoughts on this")
    "his opinion","her opinion","their opinion","his thoughts","her thoughts","their thoughts",
    "his take","her take","their take","his perspective","her perspective","their perspective",
    "what he thinks","what she thinks","what he would","what she would",
    "want to know his","want to know her","want to know their",
    "want his","want her","want their","get his take","get her take","get their input",
    "i want to know","ask him","ask her","ask them",
    // Google Workspace
    "check my email","read my email","my inbox","unread email","email from","send email","send an email",
    "my calendar","my schedule","upcoming event","calendar event","schedule a","book a meeting","create event",
    "google drive","my drive","find file","search drive","share file","move file","rename file",
    "google doc","read document","open doc",
    "spreadsheet","google sheet","read sheet","update sheet",
    "presentation","google slide",
    "my contacts","add contact","find contact","search contact",
    "business review","gbp review","google review","respond to review","business post",
    "google tasks","my tasks","mark task",
    "my emails","new emails","latest email",
  ];
  return kws.some(kw => lower.includes(kw));
}

// mavis-deep-research always responds as an SSE stream (even on its own error/config
// paths) — this drains it server-side and concatenates the `token` fields into one report.
async function runDeepResearch(
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
  query: string,
  depth: number,
): Promise<string> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/mavis-deep-research`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ query, depth, user_id: userId }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok || !res.body) return "";
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let report = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const evt = JSON.parse(payload);
          if (typeof evt.token === "string") report += evt.token;
        } catch { /* skip malformed event */ }
      }
    }
    return report.trim();
  } catch {
    return "";
  }
}

async function callHyperframes(
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${supabaseUrl}/functions/v1/mavis-hyperframes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({ ...body, user_id: userId }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(data.error ?? `mavis-hyperframes ${res.status}`));
  return data;
}

export async function resolveActionsNative(
  messages: any[],
  system: string,
  aiKeys: { gemini: string; claude: string; openai: string; grok: string },
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
): Promise<string> {
  let calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  if (aiKeys.gemini && !isProviderUnhealthy("gemini-2.0-flash")) {
    calls = await callGeminiForTools(messages, system, aiKeys.gemini);
  }
  if (calls.length === 0 && aiKeys.claude) {
    calls = await callClaudeForTools(messages, system, aiKeys.claude);
  }
  if (calls.length === 0) return "";

  const lines: string[] = [];
  for (const call of calls.slice(0, 6)) {
    try {
      // render_video / check_video_render are handled inline — call mavis-hyperframes directly
      if (call.name === "render_video") {
        const html = String(call.args.composition_html ?? "").trim();
        if (!html) continue;
        try {
          const result = await callHyperframes(supabaseUrl, serviceKey, userId, {
            action: "render",
            composition_html: html,
            assets: String(call.args.assets ?? "").split(",").map(s => s.trim()).filter(Boolean),
            width: call.args.width, height: call.args.height, fps: call.args.fps,
          });
          lines.push(`✓ render_video: started (render_id=${result.id}). Rendering in the background — call check_video_render(render_id="${result.id}") in a bit to get the finished video.`);
        } catch (e: any) {
          lines.push(`✗ render_video: ${e.message ?? "failed to start"}`);
        }
        continue;
      }
      if (call.name === "check_video_render") {
        const renderId = String(call.args.render_id ?? "").trim();
        if (!renderId) continue;
        try {
          const result = await callHyperframes(supabaseUrl, serviceKey, userId, { action: "status", id: renderId });
          lines.push(`✓ check_video_render(${renderId}): status=${result.status}${result.render_url ? ` url=${result.render_url}` : ""}${result.error_message ? ` error=${result.error_message}` : ""}`);
        } catch (e: any) {
          lines.push(`✗ check_video_render(${renderId}): ${e.message ?? "failed"}`);
        }
        continue;
      }
      // deep_research is handled inline — calls mavis-deep-research directly, never reaches executor
      if (call.name === "deep_research") {
        const query = String(call.args.query ?? "").trim();
        if (!query) continue;
        const rawDepth = Number(call.args.depth ?? 3);
        const depth = Math.max(1, Math.min(5, isNaN(rawDepth) ? 3 : rawDepth));
        const report = await runDeepResearch(supabaseUrl, serviceKey, userId, query, depth);
        if (report) {
          lines.push(`✓ deep_research("${query}"):\n${report.slice(0, 6000)}\n[This is a real, cited multi-source research report — synthesize it into a complete, well-organized answer for the operator, don't just paste it verbatim or summarize in one sentence.]`);
        } else {
          lines.push(`✗ deep_research("${query}"): no results (web search may not be configured, or the research pass timed out — tell the operator and offer to try again or answer from existing knowledge)`);
        }
        continue;
      }
      // consult_entity is handled inline — calls the entity's LLM, never reaches executor
      if (call.name === "consult_entity") {
        const entityName = String(call.args.name ?? "");
        const question   = String(call.args.question ?? "");
        if (!entityName || !question) continue;
        const adminSb = createClient(supabaseUrl, serviceKey);
        const [pRes, cRes] = await Promise.all([
          adminSb.from("personas").select("id,name,role,system_prompt,bio,archetype,model,agent_folders").eq("user_id",userId).ilike("name",`%${entityName}%`).limit(1),
          adminSb.from("councils").select("id,name,role,specialty,personality_prompt,notes,model,agent_folders").eq("user_id",userId).ilike("name",`%${entityName}%`).limit(1),
        ]);
        const persona = pRes.data?.[0] as any;
        const council = cRes.data?.[0] as any;
        const entity  = persona ?? council;
        if (!entity) {
          lines.push(`✗ consult_entity(${entityName}): Entity not found`);
          continue;
        }
        const label = entity.name as string;
        const af = (entity.agent_folders ?? {}) as Record<string,string>;
        const afBlock = [af.identity, af.memory_notes, af.prompts].filter(Boolean).join("\n\n");
        const entitySystem = persona
          ? `You are ${label}${entity.role ? `, ${entity.role}` : ""}. ${entity.archetype ? `Archetype: ${entity.archetype}.` : ""} ${entity.bio ? `Background: ${entity.bio}.` : ""} ${entity.system_prompt ?? ""}${afBlock ? `\n\n${afBlock}` : ""} Respond in 3-6 sentences — in character, direct, specific.`.trim()
          : `You are ${label}${entity.role ? `, ${entity.role}` : ""}${entity.specialty ? ` specialising in ${entity.specialty}` : ""}. ${entity.notes ?? ""} ${entity.personality_prompt ?? ""}${afBlock ? `\n\n${afBlock}` : ""} 3-6 sentences — direct, from your expertise.`.trim();

        let entityHistory: { role: string; content: string }[] = [];
        try {
          if (persona) {
            const { data: eh } = await adminSb.from("persona_conversations").select("role,content").eq("user_id",userId).eq("persona_id",entity.id).order("created_at",{ascending:false}).limit(10);
            entityHistory = ((eh ?? []) as any[]).reverse();
          } else {
            const { data: eh } = await adminSb.from("council_chat_messages").select("role,content").eq("user_id",userId).eq("council_member_id",entity.id).order("created_at",{ascending:false}).limit(10);
            entityHistory = ((eh ?? []) as any[]).reverse();
          }
        } catch { /* non-critical */ }

        const entityMsgs = [
          ...entityHistory.slice(-8).map((m: any) => ({ role: m.role as "user"|"assistant", content: String(m.content ?? "").slice(0,300) })),
          { role: "user" as const, content: `MAVIS is consulting you on behalf of the operator. Question: ${question}` },
        ];
        const entityModel = entity.model ?? "gemini-2.0-flash";
        const entityResp = await Promise.race([
          (entityModel.includes("claude")
            ? callClaude(entityMsgs, entitySystem, (await (async () => {
                const { data } = await adminSb.from("mavis_user_integrations").select("key_value").eq("user_id",userId).eq("provider","anthropic").eq("key_name","API Key").maybeSingle();
                return data?.key_value ?? "";
              })()))
            : callGemini(entityMsgs, entitySystem, (await (async () => {
                const { data } = await adminSb.from("mavis_user_integrations").select("key_value").eq("user_id",userId).eq("provider","gemini").eq("key_name","API Key").maybeSingle();
                return data?.key_value ?? "";
              })()))),
          new Promise<string>(r => setTimeout(() => r(""), 8_000)),
        ]);
        if (entityResp?.trim()) {
          lines.push(`✓ consult_entity(${label}): "${entityResp.trim().slice(0, 400)}"`);
        }
        continue;
      }
      // All other tools go through the executor
      const { ok, result } = await executeAgentAction(supabaseUrl, serviceKey, userId, call.name, call.args);
      lines.push(ok
        ? `✓ ${call.name}(${Object.entries(call.args).map(([k,v]) => `${k}=${JSON.stringify(v)}`).join(", ")}): ${JSON.stringify(result).slice(0, 200)}`
        : `✗ ${call.name}: ${JSON.stringify(result).slice(0, 100)}`
      );
    } catch { /* non-critical */ }
  }
  if (lines.length === 0) return "";

  return `\n\n═══ PRE-RESOLVED TOOL CALLS (already executed — reference these naturally) ═══\n${lines.join("\n")}\nDo NOT emit :::ACTION::: blocks for these — they are already complete.\n═══ END PRE-RESOLVED ═══`;
}
