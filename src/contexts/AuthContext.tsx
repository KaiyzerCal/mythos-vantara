import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { withTransientRetry } from "@/lib/retryTransientFetch";

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
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
    });

    // Failsafe: never get stuck on the init screen if the auth backend is
    // unreachable (network error, refresh-token failure, 504, etc.).
    const failsafe = setTimeout(() => setLoading(false), 4000);

    // Resuming from a long background suspend, Android/Capacitor's WebView
    // can hand control back before its network stack is actually reachable
    // again -- the first getSession() call fails with a plain "Failed to
    // fetch" even though a valid session is sitting right there in storage.
    // Without this retry that transient failure drops a still-logged-in
    // user back to the login screen. One short retry rides it out, well
    // inside the 4s failsafe above.
    withTransientRetry(() => supabase.auth.getSession())
      .then(({ data: { session } }) => {
        setSession(session);
        setLoading(false);
      })
      .catch((err) => {
        console.warn("[Auth] getSession failed, continuing unauthenticated:", err);
        setLoading(false);
      })
      .finally(() => clearTimeout(failsafe));

    return () => {
      subscription.unsubscribe();
      clearTimeout(failsafe);
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
