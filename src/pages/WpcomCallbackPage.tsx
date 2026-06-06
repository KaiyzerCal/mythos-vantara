// ============================================================
// WordPress.com OAuth callback page
// WP.com redirects here with ?code=...&state=...
// Exchanges the code via edge function, then relays result
// to the parent window (popup mode) or redirects (tab mode).
// ============================================================
import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase as _supabase } from "@/integrations/supabase/client";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
const supabase = _supabase as any;

export default function WpcomCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    const code  = params.get("code");
    const state = params.get("state");
    const err   = params.get("error");

    if (err) {
      setStatus("error");
      setDetail(err);
      relay({ type: "wpcom_oauth_error", error: err });
      return;
    }
    if (!code) {
      setStatus("error");
      setDetail("No authorization code received from WordPress.com.");
      relay({ type: "wpcom_oauth_error", error: "No code" });
      return;
    }

    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

        const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-wpcom-oauth`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token ?? ""}`,
          },
          body: JSON.stringify({ action: "exchange_code", code, state }),
        });

        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error ?? "Token exchange failed");

        setStatus("success");
        setDetail(data.wpcom_site_domain ?? "Connected");
        relay({ type: "wpcom_oauth_success", ...data });

        // In non-popup mode, redirect back after a moment
        if (!window.opener) setTimeout(() => navigate("/websites"), 2500);
      } catch (e: any) {
        setStatus("error");
        setDetail(e.message ?? "Unknown error");
        relay({ type: "wpcom_oauth_error", error: e.message });
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-5 bg-background text-foreground p-8">
      {status === "loading" && (
        <>
          <Loader2 size={40} className="animate-spin text-primary" />
          <p className="text-sm font-mono text-muted-foreground">Connecting to WordPress.com...</p>
        </>
      )}
      {status === "success" && (
        <>
          <CheckCircle2 size={40} className="text-emerald-400" />
          <p className="text-lg font-semibold">Connected!</p>
          <p className="text-sm font-mono text-muted-foreground">{detail}</p>
          {!window.opener && (
            <p className="text-xs text-muted-foreground">Redirecting back to Website Builder…</p>
          )}
        </>
      )}
      {status === "error" && (
        <>
          <XCircle size={40} className="text-destructive" />
          <p className="text-lg font-semibold">Connection Failed</p>
          <p className="text-sm font-mono text-muted-foreground text-center max-w-sm">{detail}</p>
          {!window.opener && (
            <button
              onClick={() => navigate("/websites")}
              className="mt-2 text-xs text-primary underline"
            >
              Back to Website Builder
            </button>
          )}
        </>
      )}
    </div>
  );
}

function relay(msg: Record<string, unknown>) {
  try {
    if (window.opener) {
      window.opener.postMessage(msg, window.location.origin);
      setTimeout(() => window.close(), 800);
    }
  } catch { /* cross-origin guard */ }
}
