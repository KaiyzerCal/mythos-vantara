// mavis-vtube-studio — WebSocket proxy to VTube Studio's local API
//
// VTube Studio runs on Windows with API enabled on port 8001.
// The user exposes it via a public tunnel (ngrok/Cloudflare Tunnel) and sets
// VTUBE_STUDIO_URL to the resulting wss:// address.
//
// POST body fields:
//   action           — required; see ACTION_MAP below
//   plugin_name      — defaults to "MAVIS"
//   plugin_developer — defaults to "Calvin"
//   token            — override the stored VTUBE_AUTH_TOKEN
//   model_id, hotkey_id, expression_file, active,
//   position_x, position_y, time_seconds,
//   parameter_name, parameter_value  — action-specific params
//
// Env vars:
//   VTUBE_STUDIO_URL        — wss://your-ngrok-url  (required)
//   VTUBE_AUTH_TOKEN        — stored auth token from prior get_token approval

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
} as const;

// ---------------------------------------------------------------------------
// VTube Studio message envelope
// ---------------------------------------------------------------------------

function buildEnvelope(
  messageType: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  return {
    apiName: "VTubeStudioPublicAPI",
    apiVersion: "1.0",
    requestID: crypto.randomUUID(),
    messageType,
    data,
  };
}

// ---------------------------------------------------------------------------
// vtsRequest — single send / single receive on one WebSocket
// Used for get_token (no prior auth needed).
// ---------------------------------------------------------------------------

function vtsRequest(
  wsUrl: string,
  message: Record<string, unknown>,
  timeoutMs = 8000,
): Promise<Record<string, unknown>> {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let settled = false;

    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn();
      }
    };

    const timer = setTimeout(() => {
      settle(() => {
        try { ws.close(); } catch { /* ignore */ }
        reject(new Error("VTube Studio request timed out"));
      });
    }, timeoutMs);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify(message));
    });

    ws.addEventListener("message", (event: MessageEvent) => {
      settle(() => {
        try { ws.close(); } catch { /* ignore */ }
        try {
          resolve(JSON.parse(event.data as string) as Record<string, unknown>);
        } catch {
          reject(new Error("Failed to parse VTube Studio response"));
        }
      });
    });

    ws.addEventListener("error", () => {
      settle(() => {
        reject(new Error("WebSocket connection to VTube Studio failed"));
      });
    });

    ws.addEventListener("close", (event: CloseEvent) => {
      settle(() => {
        reject(
          new Error(
            `VTube Studio connection closed before response (code ${event.code})`,
          ),
        );
      });
    });
  });
}

// ---------------------------------------------------------------------------
// authenticatedVtsRequest — auth + command on ONE WebSocket
//
// Flow on a single connection:
//   1. send AuthenticationRequest  →  await auth response  (check authenticated)
//   2. send command message        →  await command response
//   3. close
//
// Messages are collected in order via a simple queue / waiter pattern so we
// don't miss a response that arrives before the next await.
// ---------------------------------------------------------------------------

function authenticatedVtsRequest(
  wsUrl: string,
  token: string,
  pluginName: string,
  pluginDeveloper: string,
  command: Record<string, unknown>,
  timeoutMs = 8000,
): Promise<Record<string, unknown>> {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const authMessage = buildEnvelope("AuthenticationRequest", {
      pluginName,
      pluginDeveloper,
      authenticationToken: token,
    });

    const ws = new WebSocket(wsUrl);
    let settled = false;
    const messageQueue: Record<string, unknown>[] = [];
    const messageWaiters: Array<(msg: Record<string, unknown>) => void> = [];

    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        try { ws.close(); } catch { /* ignore */ }
        fn();
      }
    };

    const timer = setTimeout(() => {
      settle(() => {
        // Drain any pending waiters so their promises don't hang in the
        // async IIFE; the outer reject ends the consumer's interest anyway.
        messageWaiters.length = 0;
        reject(new Error("VTube Studio authenticated request timed out"));
      });
    }, timeoutMs);

    // Returns a promise that resolves with the next incoming message.
    // If a message is already queued it resolves immediately.
    function nextMessage(): Promise<Record<string, unknown>> {
      if (messageQueue.length > 0) {
        return Promise.resolve(messageQueue.shift()!);
      }
      return new Promise<Record<string, unknown>>((res) => {
        messageWaiters.push(res);
      });
    }

    ws.addEventListener("message", (event: MessageEvent) => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(event.data as string) as Record<string, unknown>;
      } catch {
        return; // skip unparseable frames
      }
      if (messageWaiters.length > 0) {
        messageWaiters.shift()!(parsed);
      } else {
        messageQueue.push(parsed);
      }
    });

    ws.addEventListener("error", () => {
      settle(() => {
        reject(new Error("WebSocket connection to VTube Studio failed"));
      });
    });

    ws.addEventListener("close", (event: CloseEvent) => {
      settle(() => {
        reject(
          new Error(
            `VTube Studio connection closed unexpectedly (code ${event.code})`,
          ),
        );
      });
    });

    ws.addEventListener("open", () => {
      (async () => {
        try {
          // Step 1 — authenticate
          ws.send(JSON.stringify(authMessage));
          const authResp = await nextMessage();
          const authData = (authResp.data ?? {}) as Record<string, unknown>;

          if (!authData.authenticated) {
            throw new Error(
              `VTube Studio authentication failed: ${JSON.stringify(authResp)}`,
            );
          }

          // Step 2 — send actual command
          ws.send(JSON.stringify(command));
          const cmdResp = await nextMessage();

          settle(() => {
            resolve(cmdResp);
          });
        } catch (err) {
          settle(() => {
            reject(err instanceof Error ? err : new Error(String(err)));
          });
        }
      })();
    });
  });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const wsUrl = Deno.env.get("VTUBE_STUDIO_URL");
  if (!wsUrl) {
    return new Response(
      JSON.stringify({ ok: false, error: "VTUBE_STUDIO_URL not configured" }),
      {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // Parse request body
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: "Invalid JSON body" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // Extract common fields
  const action =
    typeof body.action === "string" ? body.action : undefined;
  const pluginName =
    typeof body.plugin_name === "string" ? body.plugin_name : "MAVIS";
  const pluginDeveloper =
    typeof body.plugin_developer === "string"
      ? body.plugin_developer
      : "Calvin";

  if (!action) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing required field: action" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // Action-specific params (presence validated per-action inside the switch)
  const tokenOverride =
    typeof body.token === "string" ? body.token : undefined;
  const storedToken =
    tokenOverride ?? Deno.env.get("VTUBE_AUTH_TOKEN") ?? "";

  const modelId =
    typeof body.model_id === "string" ? body.model_id : undefined;
  const hotkeyId =
    typeof body.hotkey_id === "string" ? body.hotkey_id : undefined;
  const expressionFile =
    typeof body.expression_file === "string"
      ? body.expression_file
      : undefined;
  // Callers (e.g. the Telegram bot) send these as strings — coerce so both
  // native-typed and stringified inputs work.
  const toBool = (v: unknown): boolean | undefined =>
    typeof v === "boolean" ? v
    : v === "1" || v === "true" || v === "on" || v === "yes" ? true
    : v === "0" || v === "false" || v === "off" || v === "no" ? false
    : undefined;
  const toNum = (v: unknown): number | undefined => {
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
    return undefined;
  };
  const active      = toBool(body.active);
  const positionX   = toNum(body.position_x);
  const positionY   = toNum(body.position_y);
  const timeSeconds = toNum(body.time_seconds);
  const parameterName =
    typeof body.parameter_name === "string"
      ? body.parameter_name
      : undefined;
  const parameterValue = toNum(body.parameter_value);

  try {
    let vtsResponse: Record<string, unknown>;

    if (action === "get_token") {
      // No prior auth needed — this request makes VTS show the approval popup.
      const message = buildEnvelope("AuthenticationTokenRequest", {
        pluginName,
        pluginDeveloper,
        pluginIcon: "",
      });
      // VTS replies only after the operator clicks "Allow" in the GUI — wait up to 60s.
      vtsResponse = await vtsRequest(wsUrl, message, 60_000);
    } else {
      // All other actions require authenticating on the same connection first.
      let command: Record<string, unknown>;

      switch (action) {
        case "authenticate":
          command = buildEnvelope("AuthenticationRequest", {
            pluginName,
            pluginDeveloper,
            authenticationToken: storedToken,
          });
          break;

        case "list_models":
          command = buildEnvelope("AvailableModelsRequest", {});
          break;

        case "load_model":
          if (!modelId) {
            return new Response(
              JSON.stringify({
                ok: false,
                error: "load_model requires model_id",
              }),
              {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              },
            );
          }
          command = buildEnvelope("ModelLoadRequest", { modelID: modelId });
          break;

        case "list_hotkeys":
          command = buildEnvelope("HotkeysInCurrentModelRequest", {});
          break;

        case "trigger_hotkey":
          if (!hotkeyId) {
            return new Response(
              JSON.stringify({
                ok: false,
                error: "trigger_hotkey requires hotkey_id",
              }),
              {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              },
            );
          }
          command = buildEnvelope("HotkeyTriggerRequest", {
            hotkeyID: hotkeyId,
          });
          break;

        case "list_expressions":
          command = buildEnvelope("ExpressionStateRequest", { details: true });
          break;

        case "set_expression":
          if (expressionFile === undefined || active === undefined) {
            return new Response(
              JSON.stringify({
                ok: false,
                error: "set_expression requires expression_file and active",
              }),
              {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              },
            );
          }
          command = buildEnvelope("ExpressionActivationRequest", {
            expressionFile,
            active,
          });
          break;

        case "move_model":
          command = buildEnvelope("MoveModelRequest", {
            timeInSeconds: timeSeconds ?? 0,
            valuesAreRelativeToModel: false,
            positionX: positionX ?? 0,
            positionY: positionY ?? 0,
          });
          break;

        case "inject_parameter":
          if (parameterName === undefined || parameterValue === undefined) {
            return new Response(
              JSON.stringify({
                ok: false,
                error:
                  "inject_parameter requires parameter_name and parameter_value",
              }),
              {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              },
            );
          }
          command = buildEnvelope("InjectParameterDataRequest", {
            faceFound: true,
            mode: "set",
            parameterValues: [{ id: parameterName, value: parameterValue }],
          });
          break;

        case "get_stats":
          command = buildEnvelope("StatisticsRequest", {});
          break;

        default:
          return new Response(
            JSON.stringify({ ok: false, error: `Unknown action: ${action}` }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
      }

      vtsResponse = await authenticatedVtsRequest(
        wsUrl,
        storedToken,
        pluginName,
        pluginDeveloper,
        command,
      );
    }

    // Extract the inner data payload from the VTS envelope
    const responseData =
      (vtsResponse.data as Record<string, unknown> | undefined) ??
      vtsResponse;

    return new Response(
      JSON.stringify({ ok: true, action, data: responseData }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ ok: false, error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
