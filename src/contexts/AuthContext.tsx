import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { withTransientRetry } from "@/lib/retryTransientFetch";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
    });

    // Failsafe: never get stuck on the init screen if the auth backend is
    // unreachable (network error, refresh-token failure, 504, etc.).
    const failsafe = setTimeout(() => {
      if (active) setLoading(false);
    }, 12_000);

    // Resuming from a long background suspend, Android/Capacitor's WebView
    // can hand control back before its network stack is actually reachable
    // again -- the first getSession() call fails with a plain "Failed to
    // fetch" even though a valid session is sitting right there in storage.
    // Without this retry that transient failure drops a still-logged-in
    // user back to the login screen. Bounded exponential retries give a cold
    // radio/DNS stack time to recover without retrying real credential errors.
    withTransientRetry(() => supabase.auth.getSession())
      .then(({ data: { session } }) => {
        if (!active) return;
        setSession(session);
        setLoading(false);
      })
      .catch((err) => {
        console.warn("[Auth] getSession failed, continuing unauthenticated:", err);
        if (active) setLoading(false);
      })
      .finally(() => clearTimeout(failsafe));

    // Supabase's browser visibility integration is not sufficient when an
    // Android WebView is suspended. Drive token refresh from Capacitor's real
    // native lifecycle and allow the network stack to warm before recovery.
    let removeAppStateListener: (() => Promise<void>) | undefined;
    if (Capacitor.isNativePlatform()) {
      void App.addListener("appStateChange", ({ isActive }) => {
        if (resumeTimer) clearTimeout(resumeTimer);
        if (!isActive) {
          supabase.auth.stopAutoRefresh();
          return;
        }
        supabase.auth.startAutoRefresh();
        resumeTimer = setTimeout(() => {
          void withTransientRetry(() => supabase.auth.getSession())
            .then(({ data: { session } }) => {
              if (active && session) setSession(session);
            })
            .catch((err) => console.warn("[Auth] resume recovery failed:", err));
        }, 500);
      }).then((handle) => {
        removeAppStateListener = () => handle.remove();
      });
    }

    return () => {
      active = false;
      subscription.unsubscribe();
      clearTimeout(failsafe);
      if (resumeTimer) clearTimeout(resumeTimer);
      void removeAppStateListener?.();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  // supabase-js hands back a freshly-constructed session (and therefore a
  // new `user` object) on every TOKEN_REFRESHED event — its background
  // auto-refresh timer, roughly hourly, and (on native) the appStateChange
  // resume path above unconditionally does the same on every foreground
  // resume, whether or not the token actually needed refreshing.
  //
  // Every one of useDataHooks.ts's ~17 hooks depends on `user` in its fetch
  // useCallback, and AppDataContext's realtime subscription effect depends
  // on ~16 of their `refetch` functions. Without this memo, a same-user
  // token refresh gave `user` a new identity, which gave every `fetch` a new
  // identity, which re-fired every hook's initial-load effect (17 refetches)
  // AND tore down and rebuilt the entire Supabase realtime channel — on
  // every resume, not just sign-in. That is the shape of "freezing or slow
  // when loading a page" a user would actually notice: reopen the app,
  // eat a full reload of every table plus a WebSocket resubscribe.
  //
  // Nothing downstream reads anything off `user` besides `.id` (verified:
  // no `updateUser()` calls, no `user_metadata`/`app_metadata` reads
  // anywhere in the app) — profile data lives in `public.profiles`, not
  // Supabase Auth metadata — so keying the memo on the id alone is safe and
  // loses no real update.
  // Deliberately narrower than `session?.user`: keying on the id, not the
  // object, is the entire fix. Depending on `session?.user` itself would
  // recompute this memo every time supabase-js hands back a new session
  // object for the SAME user, which is exactly the churn described above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const user = useMemo(() => session?.user ?? null, [session?.user?.id]);

  const value = useMemo(
    () => ({ session, user, loading, signOut }),
    [session, user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
