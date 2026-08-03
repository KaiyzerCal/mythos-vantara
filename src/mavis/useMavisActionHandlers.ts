// Registers every MAVIS action handler shared between the primary chat
// client (MavisChat.tsx, /mavis) and its alternate UI (MavisDemo.tsx,
// /mavis-ui and /demo). This used to be duplicated in both files, and the
// two copies drifted independently more than once — composio_action was
// added to one and not the other, then spotify_*/terminal_exec the same
// way in reverse, each time leaving real user-facing actions silently
// failing with "unknown action type" on whichever page was missed. One
// registration site, called from both pages, so it can't drift again.
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { setDefaultHandler, registerActionHandler } from "@/mavis/actionExecutor";

export function useMavisActionHandlers() {
  useEffect(() => {
    setDefaultHandler(async (payload) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not authenticated — please sign in again");
      const { data: actionData, error: actionError } = await supabase.functions.invoke("mavis-actions", {
        body: { actions: [payload] },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (actionError) throw actionError;
      const failed = Array.isArray(actionData?.results)
        ? actionData.results.filter((r: any) => r?.success === false)
        : [];
      if (failed.length > 0) {
        throw new Error(failed.map((r: any) => `${r.type}: ${r.error || "Unknown error"}`).join(" | "));
      }
    });

    // propose_product — queues create_product task for operator approval in Inbox
    registerActionHandler("propose_product", async (payload) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("Not authenticated");
      const { error } = await supabase.from("mavis_tasks").insert({
        user_id: session.user.id,
        type: "create_product",
        description: `Product proposal: "${payload.title}" — $${((Number(payload.price_cents) || 2900) / 100).toFixed(2)}`,
        payload: payload as any,
        status: "requires_confirmation",
      } as any);
      if (error) throw error;
    });

    // nora_tweet — queues a tweet for Nora Vale for operator approval
    registerActionHandler("nora_tweet", async (payload) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("Not authenticated");
      const { error } = await supabase.from("mavis_tasks").insert({
        user_id: session.user.id,
        type: "nora_tweet",
        description: `Nora tweet: "${String(payload.content).slice(0, 60)}…"`,
        payload: payload as any,
        status: "requires_confirmation",
      } as any);
      if (error) throw error;
    });

    // create_skill_definition — MAVIS writes a new runtime skill to the DB
    registerActionHandler("create_skill_definition", async (payload) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("Not authenticated");
      const { error } = await supabase.from("mavis_skill_definitions").upsert({
        user_id: session.user.id,
        name: payload.name,
        description: payload.description,
        keywords: payload.keywords,
        prompt_template: payload.prompt_template,
        is_active: true,
        updated_at: new Date().toISOString(),
      } as any, { onConflict: "user_id,name" });
      if (error) throw error;
    });

    // composio_action — any third-party integration routed through Composio
    // (Execution Blueprint Stage G), not mavis-actions' own switch dispatcher.
    registerActionHandler("composio_action", async (payload) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not authenticated — please sign in again");
      const { data, error } = await supabase.functions.invoke("mavis-composio-agent", {
        body: { tool_slug: payload.tool_slug, params: payload.params ?? {} },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) throw error;
      if (data?.successful === false) throw new Error(data?.error || "Composio action failed");
    });

    // ── Spotify playback control ───────────────────────────────
    const callSpotify = async (action: string, extra?: Record<string, unknown>) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not authenticated");
      const res = await supabase.functions.invoke("mavis-spotify-control", {
        body: { action, ...extra },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.error) throw new Error(res.error.message ?? "Spotify control failed");
      return res.data;
    };

    registerActionHandler("spotify_play", (p) => callSpotify("play", { query: p.query as string | undefined, type: p.type as string | undefined }));
    registerActionHandler("spotify_pause", () => callSpotify("pause"));
    registerActionHandler("spotify_skip", () => callSpotify("skip"));
    registerActionHandler("spotify_previous", () => callSpotify("previous"));
    registerActionHandler("spotify_volume", (p) => callSpotify("volume", { percent: p.percent }));
    registerActionHandler("spotify_shuffle", (p) => callSpotify("shuffle", { enabled: p.enabled !== false }));
    registerActionHandler("spotify_now_playing", () => callSpotify("now_playing"));

    // ── Terminal / persistent shell ────────────────────────────
    registerActionHandler("terminal_exec", async (payload) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not authenticated");
      const res = await supabase.functions.invoke("mavis-terminal", {
        body: {
          action: "exec",
          command: payload.command,
          session_id: payload.session_id === "auto" ? undefined : payload.session_id,
          timeout: payload.timeout ?? 30,
        },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.error) throw new Error(res.error.message ?? "Terminal exec failed");
      return res.data;
    });

    // mavis-plans / mavis-chain-builder / mavis-signal-watcher expect
    // {userId, action, ...params} rather than mavis-actions' {actions: [...]}
    // shape, so they need their own routing — same pattern as composio_action
    // above, just applied to a whole family of types at once instead of one.
    const registerEdgeFunctionProxy = (edgeFunction: string, actionTypes: string[]) => {
      for (const actionType of actionTypes) {
        registerActionHandler(actionType, async (payload) => {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session?.user) throw new Error("Not authenticated — please sign in again");
          const { type: _type, ...params } = payload;
          const { data, error } = await supabase.functions.invoke(edgeFunction, {
            body: { userId: session.user.id, action: actionType, ...params },
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (error) throw error;
          if (data?.error) throw new Error(data.error);
        });
      }
    };
    registerEdgeFunctionProxy("mavis-plans", [
      "generate_plan", "create_plan", "get_plans", "get_plan", "update_plan",
      "advance_step", "update_session", "complete_plan", "delete_plan",
    ]);
    registerEdgeFunctionProxy("mavis-chain-builder", [
      "auto_link_quest_chains", "auto_link_skill_chains", "get_quest_chains", "get_skill_chains",
      "create_quest_chain", "create_skill_chain", "update_quest_chain", "update_skill_chain",
      "delete_quest_chain", "delete_skill_chain", "add_quest_to_chain", "add_skill_to_chain", "remove_from_chain",
    ]);
    registerEdgeFunctionProxy("mavis-signal-watcher", [
      "get_signal_configs", "upsert_signal_config", "delete_signal_config",
    ]);
  }, []);
}
