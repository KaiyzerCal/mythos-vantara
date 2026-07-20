import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Check, X, Shield } from "lucide-react";

type AuthDetails = {
  client?: { name?: string; client_name?: string; redirect_uri?: string } | null;
  scopes?: string[] | string | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
};

// Narrow typed wrapper around beta supabase.auth.oauth namespace.
const oauth = (supabase.auth as unknown as {
  oauth: {
    getAuthorizationDetails: (id: string) => Promise<{ data: AuthDetails | null; error: { message: string } | null }>;
    approveAuthorization: (id: string) => Promise<{ data: { redirect_url?: string; redirect_to?: string } | null; error: { message: string } | null }>;
    denyAuthorization: (id: string) => Promise<{ data: { redirect_url?: string; redirect_to?: string } | null; error: { message: string } | null }>;
  };
}).oauth;

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<AuthDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError("Missing authorization_id");
        setLoading(false);
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        // Stay on this URL — the app's auth gate will render the login screen
        // over it, and once the user signs in, App re-renders <Routes> at the
        // same URL and returns to this consent page.
        setLoading(false);
        setError("Please sign in to continue.");
        return;
      }
      try {
        const res = await oauth.getAuthorizationDetails(authorizationId);
        if (!active) return;
        if (res.error) {
          setError(res.error.message);
        } else {
          const immediate = res.data?.redirect_url ?? res.data?.redirect_to;
          if (immediate && !res.data?.client) {
            window.location.href = immediate;
            return;
          }
          setDetails(res.data);
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = approve
        ? await oauth.approveAuthorization(authorizationId)
        : await oauth.denyAuthorization(authorizationId);
      if (res.error) {
        setError(res.error.message);
        setBusy(false);
        return;
      }
      const target = res.data?.redirect_url ?? res.data?.redirect_to;
      if (!target) {
        setError("No redirect returned by the authorization server.");
        setBusy(false);
        return;
      }
      window.location.href = target;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const clientName = details?.client?.name ?? details?.client?.client_name ?? "an app";
  const scopeList = Array.isArray(details?.scopes)
    ? details?.scopes
    : typeof details?.scopes === "string"
      ? details.scopes.split(/\s+/).filter(Boolean)
      : [];

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md border border-border rounded-lg bg-card p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center">
            <Shield className="text-primary" size={18} />
          </div>
          <div>
            <h1 className="font-display text-lg font-bold">Connect {clientName} to VANTARA.EXE</h1>
            <p className="text-xs font-mono text-muted-foreground">This lets {clientName} use this app as you.</p>
          </div>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="animate-spin" size={16} /> Loading authorization…
          </div>
        )}

        {!loading && error && (
          <div className="text-sm text-destructive font-mono">{error}</div>
        )}

        {!loading && details && (
          <>
            {details.client?.redirect_uri && (
              <div className="text-xs font-mono text-muted-foreground break-all">
                Redirect: {details.client.redirect_uri}
              </div>
            )}

            {scopeList.length > 0 && (
              <div>
                <p className="text-xs font-mono uppercase text-muted-foreground mb-1">Requested access</p>
                <ul className="text-sm space-y-1">
                  {scopeList.map((s) => (
                    <li key={s} className="font-mono text-xs">• {s}</li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              This does not bypass this app's permissions or backend policies. The client will only see data your account can already access.
            </p>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => decide(false)}
                disabled={busy}
                className="flex-1 py-2.5 border border-border rounded font-mono text-sm text-muted-foreground hover:border-border/80 disabled:opacity-40 flex items-center justify-center gap-2"
              >
                <X size={14} /> Cancel
              </button>
              <button
                onClick={() => decide(true)}
                disabled={busy}
                className="flex-1 py-2.5 bg-primary/10 border border-primary/30 text-primary rounded font-mono text-sm hover:bg-primary/20 disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Approve
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
