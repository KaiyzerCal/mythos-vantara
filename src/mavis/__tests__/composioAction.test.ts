// Tests for composio_action (Execution Blueprint Stage G) — the generic
// third-party-integration action type routed through mavis-composio-agent.
// Since tool_slug is open-ended (Composio exposes 1000+ toolkit actions),
// classification is verb-based rather than a fixed per-type rule like the
// rest of actionExecutor.ts — these tests are the actual safety net for
// that heuristic, so they cover the classification axis specifically, not
// just "does it execute."
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  executeAction,
  registerActionHandler,
  setDefaultHandler,
} from "../actionExecutor";
import { ActionSchema } from "../actionSchemas";
import type { ParsedAction } from "../types";

function makeAction(payload: Record<string, unknown>): ParsedAction {
  return { type: payload.type as string, raw: "", payload };
}

beforeEach(() => {
  setDefaultHandler(vi.fn());
});

describe("composio_action — schema", () => {
  it("valid input passes Zod", () => {
    const result = ActionSchema.safeParse({
      type: "composio_action",
      tool_slug: "GITHUB_LIST_REPOS",
      params: { org: "acme" },
    });
    expect(result.success).toBe(true);
  });

  it("params defaults to {} when omitted", () => {
    const result = ActionSchema.safeParse({ type: "composio_action", tool_slug: "SLACK_LIST_CHANNELS" });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "composio_action") expect(result.data.params).toEqual({});
  });

  it("missing tool_slug is rejected", () => {
    expect(ActionSchema.safeParse({ type: "composio_action", params: {} }).success).toBe(false);
  });

  it("empty tool_slug is rejected", () => {
    expect(ActionSchema.safeParse({ type: "composio_action", tool_slug: "" }).success).toBe(false);
  });
});

describe("composio_action — read-only verbs are AUTO", () => {
  const READONLY_SLUGS = [
    "GITHUB_LIST_REPOS", "SLACK_GET_CHANNEL", "NOTION_SEARCH_PAGE",
    "GMAIL_FETCH_MESSAGE", "LINEAR_FIND_ISSUE", "HUBSPOT_READ_CONTACT",
    "ASANA_QUERY_TASKS", "JIRA_VIEW_ISSUE",
  ];

  for (const tool_slug of READONLY_SLUGS) {
    it(`${tool_slug} executes without confirmation`, async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      registerActionHandler("composio_action", handler);

      const result = await executeAction(makeAction({ type: "composio_action", tool_slug, params: {} }));

      expect(handler).toHaveBeenCalledOnce();
      expect(result.status).toBe("success");
    });
  }
});

describe("composio_action — mutating verbs require confirmation", () => {
  const MUTATING_SLUGS = [
    "GITHUB_CREATE_ISSUE", "SLACK_SEND_MESSAGE", "NOTION_UPDATE_PAGE",
    "GMAIL_DELETE_MESSAGE", "LINEAR_ARCHIVE_ISSUE", "HUBSPOT_ADD_CONTACT",
    "STRIPE_TRANSFER_FUNDS", "GITHUB_MERGE_PULL_REQUEST",
  ];

  for (const tool_slug of MUTATING_SLUGS) {
    it(`${tool_slug} never auto-executes`, async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      registerActionHandler("composio_action", handler);

      const result = await executeAction(makeAction({ type: "composio_action", tool_slug, params: {} }));

      expect(handler).not.toHaveBeenCalled();
      expect(result.status).toBe("pending_confirmation");
    });
  }

  it("a slug containing both a read and a mutating verb still requires confirmation (safety wins ties)", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    registerActionHandler("composio_action", handler);

    // Contrived but plausible: "get the list, then create a summary" style slug
    const result = await executeAction(makeAction({ type: "composio_action", tool_slug: "GITHUB_GET_CREATE_ISSUE_TEMPLATE", params: {} }));

    expect(handler).not.toHaveBeenCalled();
    expect(result.status).toBe("pending_confirmation");
  });
});

describe("composio_action — unrecognized verb defaults to CONFIRM", () => {
  it("a slug with no known verb token requires confirmation, not silent AUTO", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    registerActionHandler("composio_action", handler);

    const result = await executeAction(makeAction({ type: "composio_action", tool_slug: "TWITTER_TWEET", params: {} }));

    expect(handler).not.toHaveBeenCalled();
    expect(result.status).toBe("pending_confirmation");
  });
});
