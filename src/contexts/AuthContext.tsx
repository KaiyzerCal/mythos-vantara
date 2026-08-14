import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

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
    // again -- the first getSession() call throws a plain "Failed to fetch"
    // even though a valid session is sitting right there in storage. Without
    // this retry that transient throw drops a still-logged-in user back to
    // the login screen. One short retry rides it out, well inside the 4s
    // failsafe above.
    const getSessionWithRetry = (attempt = 0): ReturnType<typeof supabase.auth.getSession> =>
      supabase.auth.getSession().catch((err) => {
        if (attempt >= 1) throw err;
        return new Promise((resolve) => setTimeout(resolve, 800)).then(() => getSessionWithRetry(attempt + 1));
      });

    getSessionWithRetry()
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
