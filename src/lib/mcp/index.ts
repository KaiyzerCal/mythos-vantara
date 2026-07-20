import { auth, defineMcp } from "@lovable.dev/mcp-js";
import whoamiTool from "./tools/whoami";
import listCouncilsTool from "./tools/list-councils";
import listPersonasTool from "./tools/list-personas";
import listQuestsTool from "./tools/list-quests";
import createQuestTool from "./tools/create-quest";
import listJournalTool from "./tools/list-journal";
import createJournalTool from "./tools/create-journal";

// Direct Supabase issuer (never the .lovable.cloud proxy) built from the
// project ref so this file stays import-safe with no runtime env read.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "vantara-mcp",
  title: "VANTARA.EXE",
  version: "0.1.0",
  instructions:
    "Tools for the VANTARA / CODEXOS RPG life-ops platform. Read and create councils, personas, quests, and journal entries for the signed-in operator. Every call is scoped to that user via Supabase RLS.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    whoamiTool,
    listCouncilsTool,
    listPersonasTool,
    listQuestsTool,
    createQuestTool,
    listJournalTool,
    createJournalTool,
  ],
});
