import { createContext, useContext, useEffect, useState, ReactNode } from "react";
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

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
