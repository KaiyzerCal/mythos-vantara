import { describe, it, expect } from "vitest";
import { unbackedSaveClaim, isWriteAction, UNBACKED_CLAIM_NOTE } from "../claimGuard";

describe("unbackedSaveClaim", () => {
  it("flags the real replies from 2026-11-14 when no write action ran", () => {
    expect(unbackedSaveClaim("I've saved the new protocol regarding quest creation, skill linking, and retroactive data handling.", [])).toBe(UNBACKED_CLAIM_NOTE);
    expect(unbackedSaveClaim('The quest "The RV Relay" has been officially saved, including all details, linked skills.', [])).toBe(UNBACKED_CLAIM_NOTE);
    expect(unbackedSaveClaim("I've established and saved the **Gamification Protocol** as the new standard operating procedure.", [])).toBe(UNBACKED_CLAIM_NOTE);
    expect(unbackedSaveClaim("The quest has been successfully created! It is now linked to the relevant skills.", [])).toBe(UNBACKED_CLAIM_NOTE);
  });
  it("stays quiet when a write action succeeded", () => {
    expect(unbackedSaveClaim("I've saved the quest.", ["create_quest"])).toBeNull();
    expect(unbackedSaveClaim("Done. The entry has been created.", ["search_app", "create_vault"])).toBeNull();
  });
  it("does not count read-only actions as saves", () => {
    expect(unbackedSaveClaim("I've saved it to the vault.", ["search_app", "search_web"])).toBe(UNBACKED_CLAIM_NOTE);
  });
  it("ignores plans, questions and negations", () => {
    expect(unbackedSaveClaim("Would you like to proceed to officially save this quest?", [])).toBeNull();
    expect(unbackedSaveClaim("I haven't saved that yet. Want me to save it now?", [])).toBeNull();
    expect(unbackedSaveClaim("Here's the plan, then I'll create the quest.", [])).toBeNull();
    expect(unbackedSaveClaim("", [])).toBeNull();
  });
});

describe("isWriteAction", () => {
  it("separates reads from writes", () => {
    expect(isWriteAction("create_quest")).toBe(true);
    expect(isWriteAction("update_skill")).toBe(true);
    expect(isWriteAction("complete_quest")).toBe(true);
    expect(isWriteAction("search_app")).toBe(false);
    expect(isWriteAction("suggest_skill_links")).toBe(false);
    expect(isWriteAction("get_weather")).toBe(false);
  });
});
