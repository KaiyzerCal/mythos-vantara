import { supabase } from "@/integrations/supabase/client";

// Read-only voice tools (web search, app search, reading a stored entry) all go through mavis-actions and must hand
// the model the actual text back — not just {success:true}. Shared by the tap-to-speak overlay and realtime voice.
export const VOICE_READ_TOOLS: Record<string, string> = { web_search: "search_web", search_app: "search_app", read_entry: "read_entry" };

export async function runVoiceReadTool(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Not signed in");
    const { data, error } = await supabase.functions.invoke("mavis-actions", {
      body: { actions: [{ type: VOICE_READ_TOOLS[name], params: { ...args, query: String(args.query ?? ""), max_results: 5, limit: 5 } }] },
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (error) throw error;
    const r = (data as any)?.results?.[0];
    const d = r?.data ?? {};
    if (r?.success === false || d.error) throw new Error(String(r?.error ?? d.error ?? "Search failed"));
    if (name === "read_entry") {
      return {
        success: true, title: d.title, kind: d.kind, total_chars: d.total_chars, offset: d.offset, next_offset: d.next_offset ?? null,
        content: String(d.content ?? "").slice(0, 6500), note: d.note, other_matches: (d.other_matches ?? []).slice(0, 5),
      };
    }
    const trim = (x: any) => Object.fromEntries(Object.entries(x ?? {}).filter(([, v]) => typeof v === "string" || typeof v === "number").map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 300) : v]));
    return {
      success: true, answer: d.answer ?? null, note: d.note ?? undefined, matched: d.matched ?? undefined,
      results: (Array.isArray(d.results) ? d.results : []).slice(0, 5).map(trim),
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
