// Integration tests for the highest-consequence action types (Stabilization
// Brief Phase 2.7): create_quest, update_quest, delete_quest, award_xp,
// create_vault, delete_vault — everything already CONFIRM-gated in
// actionExecutor.ts, plus their AUTO siblings for contrast.
//
// Each type is covered on three axes:
//   1. valid input executes correctly (handler called, status: "success")
//   2. invalid input is rejected by Zod (ActionSchema.safeParse fails)
//   3. CONFIRM actions never auto-execute (handler never called, status:
//      "pending_confirmation")
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

describe("create_quest", () => {
  it("valid input executes correctly", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    registerActionHandler("create_quest", handler);

    const result = await executeAction(makeAction({ type: "create_quest", title: "Ship the refactor" }));

    expect(handler).toHaveBeenCalledOnce();
    expect(result.status).toBe("success");
  });

  it("invalid input is rejected by Zod", () => {
    expect(ActionSchema.safeParse({ type: "create_quest", title: "" }).success).toBe(false);
    expect(ActionSchema.safeParse({ type: "create_quest" }).success).toBe(false);
  });

  it("is AUTO, not CONFIRM — executes without gating", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    registerActionHandler("create_quest", handler);

    const result = await executeAction(makeAction({ type: "create_quest", title: "Auto quest" }));

    expect(result.status).not.toBe("pending_confirmation");
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe("update_quest", () => {
  it("valid input executes correctly", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    registerActionHandler("update_quest", handler);

    const result = await executeAction(makeAction({ type: "update_quest", id: "quest-1", status: "completed" }));

    expect(handler).toHaveBeenCalledOnce();
    expect(result.status).toBe("success");
  });

  it("invalid input is rejected by Zod (missing id)", () => {
    expect(ActionSchema.safeParse({ type: "update_quest", status: "completed" }).success).toBe(false);
  });

  it("is AUTO — executes without confirmation gating", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    registerActionHandler("update_quest", handler);

    const result = await executeAction(makeAction({ type: "update_quest", id: "quest-1" }));

    expect(result.status).not.toBe("pending_confirmation");
  });
});

describe("delete_quest", () => {
  it("is CONFIRM-gated — never auto-executes", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    registerActionHandler("delete_quest", handler);

    const result = await executeAction(makeAction({ type: "delete_quest", id: "quest-1" }));

    expect(result.status).toBe("pending_confirmation");
    expect(handler).not.toHaveBeenCalled();
  });

  it("invalid input is rejected by Zod (missing id)", () => {
    expect(ActionSchema.safeParse({ type: "delete_quest" }).success).toBe(false);
  });

  it("valid input still passes Zod validation even though CONFIRM-gated", () => {
    // Confirms the CONFIRM gate is a separate concern from Zod shape
    // validation — a well-formed delete_quest is a *valid* action that
    // simply requires operator confirmation before executing.
    expect(ActionSchema.safeParse({ type: "delete_quest", id: "quest-1" }).success).toBe(true);
  });
});

describe("award_xp", () => {
  it("valid input under the CONFIRM threshold executes correctly", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    registerActionHandler("award_xp", handler);

    const result = await executeAction(makeAction({ type: "award_xp", amount: 50 }));

    expect(handler).toHaveBeenCalledOnce();
    expect(result.status).toBe("success");
  });

  it("invalid input is rejected by Zod (zero or negative amount)", () => {
    expect(ActionSchema.safeParse({ type: "award_xp", amount: 0 }).success).toBe(false);
    expect(ActionSchema.safeParse({ type: "award_xp", amount: -10 }).success).toBe(false);
  });

  it("is CONFIRM-gated at the large-XP threshold (>= 500) — never auto-executes", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    registerActionHandler("award_xp", handler);

    const result = await executeAction(makeAction({ type: "award_xp", amount: 500 }));

    expect(result.status).toBe("pending_confirmation");
    expect(handler).not.toHaveBeenCalled();
  });

  it("auto-executes just under the large-XP threshold", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    registerActionHandler("award_xp", handler);

    const result = await executeAction(makeAction({ type: "award_xp", amount: 499 }));

    expect(result.status).toBe("success");
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe("create_vault", () => {
  it("valid input executes correctly", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    registerActionHandler("create_vault", handler);

    const result = await executeAction(
      makeAction({ type: "create_vault", title: "Lease agreement", content: "Full text of the lease..." })
    );

    expect(handler).toHaveBeenCalledOnce();
    expect(result.status).toBe("success");
  });

  it("invalid input is rejected by Zod (missing required content)", () => {
    expect(ActionSchema.safeParse({ type: "create_vault", title: "Untitled" }).success).toBe(false);
  });

  it("is AUTO — executes without confirmation gating", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    registerActionHandler("create_vault", handler);

    const result = await executeAction(
      makeAction({ type: "create_vault", title: "Note", content: "Body text" })
    );

    expect(result.status).not.toBe("pending_confirmation");
  });
});

describe("update_vault", () => {
  it("is CONFIRM-gated — never auto-executes (sensitive content)", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    registerActionHandler("update_vault", handler);

    const result = await executeAction(makeAction({ type: "update_vault", id: "vault-1", content: "Revised" }));

    expect(result.status).toBe("pending_confirmation");
    expect(handler).not.toHaveBeenCalled();
  });

  it("is CONFIRM-gated for the realistic entry_id-shaped payload the LLM actually sends (vantara-crud-update-fix-brief.md regression)", async () => {
    // The test above used a bare "id" field, which happened to satisfy the
    // OLD (buggy) UpdateVaultSchema's single required "id" field — but
    // promptBuilder.ts has only ever told the LLM to send "entry_id", never
    // "id". Every real update_vault action therefore failed
    // ActionSchema.safeParse and fell through actionExecutor.ts's legacy
    // path, which calls defaultHandler directly WITHOUT ever consulting
    // classifyAction() — silently bypassing the CONFIRM gate for every real
    // vault edit, the whole time the schema bug existed. This is the test
    // that actually proves the fix: a realistic payload, still gated.
    const handler = vi.fn().mockResolvedValue(undefined);
    registerActionHandler("update_vault", handler);

    const result = await executeAction(makeAction({
      type: "update_vault",
      entry_id: "vault-1",
      content: "Revised",
      category: "legal",
    }));

    expect(result.status).toBe("pending_confirmation");
    expect(handler).not.toHaveBeenCalled();
  });
});

// "fix all problems" follow-up to the vantara-crud-update-fix-brief.md work
// above: EVERY Delete*Schema required a bare "id" field, but promptBuilder.ts
// only ever documents table-specific id fields (quest_id, skill_id,
// member_id, item_id, ally_id, transformation_id, ranking_id, store_item_id,
// energy_id — never bare "id"). Since every delete_* type is
// ALWAYS_CONFIRM-gated, this meant every real deletion in the app has been
// silently auto-executing with no confirmation, the entire time — the single
// most severe bug found this session. This sweep proves the fix: the exact
// realistic, table-specific-id payload promptBuilder.ts tells the LLM to
// send is now (a) valid Zod input and (b) still CONFIRM-gated.
describe("delete_* CONFIRM-gate regression — realistic table-specific id payloads (not bare id)", () => {
  const cases: Array<{ type: string; payload: Record<string, unknown> }> = [
    { type: "delete_quest", payload: { type: "delete_quest", quest_id: "quest-1" } },
    { type: "delete_task", payload: { type: "delete_task", task_id: "task-1" } },
    { type: "delete_skill", payload: { type: "delete_skill", skill_id: "skill-1" } },
    { type: "delete_journal", payload: { type: "delete_journal", entry_id: "entry-1" } },
    { type: "delete_council_member", payload: { type: "delete_council_member", member_id: "member-1" } },
    { type: "delete_inventory_item", payload: { type: "delete_inventory_item", item_id: "item-1" } },
    { type: "delete_energy", payload: { type: "delete_energy", energy_id: "energy-1" } },
    { type: "delete_ally", payload: { type: "delete_ally", ally_id: "ally-1" } },
    { type: "delete_transformation", payload: { type: "delete_transformation", transformation_id: "form-1" } },
    { type: "delete_ranking", payload: { type: "delete_ranking", ranking_id: "rank-1" } },
    { type: "delete_store_item", payload: { type: "delete_store_item", store_item_id: "store-1" } },
  ];

  for (const { type, payload } of cases) {
    it(`${type}: realistic payload parses AND is CONFIRM-gated (never auto-executes)`, async () => {
      expect(ActionSchema.safeParse(payload).success).toBe(true);

      const handler = vi.fn().mockResolvedValue(undefined);
      registerActionHandler(type, handler);

      const result = await executeAction(makeAction(payload));
      expect(result.status).toBe("pending_confirmation");
      expect(handler).not.toHaveBeenCalled();
    });
  }
});

// mavis-actions/index.ts's ACTION_ALIASES normalizes alternate type
// spellings (e.g. "remove_quest" → "delete_quest") — but only on the
// backend, AFTER this frontend gate. actionExecutor.ts now mirrors that
// normalization before Zod validation and classification (see its own
// ACTION_ALIASES comment) specifically so aliases can't bypass the CONFIRM
// gate the way missing lookup fields used to. delete_ranking_profile is the
// one confirmed live case: promptBuilder.ts documents it — never
// "delete_ranking" — as what the LLM should actually send.
describe("alias normalization — CONFIRM-gate regression for delete_* aliases", () => {
  it("delete_ranking_profile (the type promptBuilder.ts actually documents) is CONFIRM-gated exactly like delete_ranking", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    registerActionHandler("delete_ranking", handler);

    const result = await executeAction(makeAction({ type: "delete_ranking_profile", ranking_id: "rank-1" }));
    expect(result.status).toBe("pending_confirmation");
    expect(handler).not.toHaveBeenCalled();
  });

  it("remove_quest (alias) is CONFIRM-gated exactly like delete_quest", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    registerActionHandler("delete_quest", handler);

    const result = await executeAction(makeAction({ type: "remove_quest", quest_id: "quest-1" }));
    expect(result.status).toBe("pending_confirmation");
    expect(handler).not.toHaveBeenCalled();
  });

  it("remove_ally (alias) is CONFIRM-gated exactly like delete_ally", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    registerActionHandler("delete_ally", handler);

    const result = await executeAction(makeAction({ type: "remove_ally", ally_id: "ally-1" }));
    expect(result.status).toBe("pending_confirmation");
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("delete_vault", () => {
  it("is CONFIRM-gated — never auto-executes", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    registerActionHandler("delete_vault", handler);

    const result = await executeAction(makeAction({ type: "delete_vault", id: "vault-1" }));

    expect(result.status).toBe("pending_confirmation");
    expect(handler).not.toHaveBeenCalled();
  });

  it("invalid input is rejected by Zod (missing id)", () => {
    expect(ActionSchema.safeParse({ type: "delete_vault" }).success).toBe(false);
  });

  it("remains CONFIRM-gated even with a well-formed payload", async () => {
    // Guards against a regression where only *invalid* deletes get caught —
    // the gate must fire on valid, well-formed delete requests too.
    const handler = vi.fn().mockResolvedValue(undefined);
    registerActionHandler("delete_vault", handler);
    const parsed = ActionSchema.safeParse({ type: "delete_vault", id: "vault-1" });
    expect(parsed.success).toBe(true);

    const result = await executeAction(makeAction({ type: "delete_vault", id: "vault-1" }));
    expect(result.status).toBe("pending_confirmation");
    expect(handler).not.toHaveBeenCalled();
  });
});
