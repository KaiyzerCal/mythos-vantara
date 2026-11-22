import { describe, it, expect } from "vitest";
import { buildDriveQuery, COMPOSIO_GOOGLE_ACTIONS } from "../../../supabase/functions/_shared/googleQuery";

describe("Google reads via Composio", () => {
  it("searches name and content for plain words and escapes quotes", () => {
    expect(buildDriveQuery({ query: "OTF PSL" })).toBe("(name contains 'OTF PSL' or fullText contains 'OTF PSL') and trashed = false");
    expect(buildDriveQuery({ query: "Calvin's budget" })).toContain("Calvin\\'s budget");
  });
  it("passes raw Drive queries through and always excludes trash", () => {
    expect(buildDriveQuery({ query: "name contains 'budget'" })).toBe("name contains 'budget' and trashed = false");
    expect(buildDriveQuery({ query: "name contains 'x' and trashed = false" })).toBe("name contains 'x' and trashed = false");
  });
  it("supports name/text fields and file-type filters", () => {
    expect(buildDriveQuery({ name: "offer", text: "pay", file_type: "pdf" })).toBe("name contains 'offer' and fullText contains 'pay' and trashed = false and mimeType = 'application/pdf'");
    expect(buildDriveQuery({ file_type: "sheet" })).toContain("application/vnd.google-apps.spreadsheet");
  });
  it("covers the Google read tools chat advertises", () => {
    for (const t of ["search_drive_files", "list_drive_files", "get_file_info", "read_drive_file", "read_document", "read_sheet", "get_emails", "get_calendar_events"]) expect(COMPOSIO_GOOGLE_ACTIONS).toContain(t);
    expect(COMPOSIO_GOOGLE_ACTIONS).not.toContain("create_quest");
  });
});
