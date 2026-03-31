// ============================================================
// VANTARA.EXE — AuthPage, SettingsPage, Index, NotFound
// ============================================================
import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2, LogIn, UserPlus, Settings, Bell, Shield, Crown, Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import { supabase } from "@/integrations/supabase/client";
import { useAppData } from "@/contexts/AppDataContext";
import { PageHeader, HudCard, ProgressBar } from "@/components/SharedUI";
import Dashboard from "./Dashboard";

// ─── ThemeToggle ───────────────────────────────────────────
function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        {isDark ? <Moon size={14} className="text-primary" /> : <Sun size={14} className="text-primary" />}
        <span className="text-xs font-mono">{isDark ? "Dark Mode" : "Light Mode"}</span>
      </div>
      <button
        onClick={() => setTheme(isDark ? "light" : "dark")}
        className={`w-10 h-5 rounded-full transition-all relative ${isDark ? "bg-primary/30" : "bg-muted"}`}
      >
        <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${isDark ? "left-5 bg-primary" : "left-0.5 bg-muted-foreground"}`} />
      </button>
    </div>
  );
}

// ─── AuthPage ──────────────────────────────────────────────
export function AuthPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage("Check your email to confirm your account.");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-xl bg-primary/10 border-2 border-primary/30 flex items-center justify-center mx-auto mb-4 glow-gold">
            <Crown size={32} className="text-primary" />
          </div>
          <h1 className="font-display text-3xl font-bold text-glow-gold">VANTARA.EXE</h1>
          <p className="text-xs font-mono text-muted-foreground mt-1">MAVIS-PRIME // CODEXOS PLATFORM</p>
        </div>

        <HudCard>
          <div className="flex gap-2 mb-6">
            {(["login", "signup"] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={`flex-1 flex items-center justify-center gap-2 py-2 rounded text-xs font-mono uppercase transition-all ${mode === m ? "bg-primary/10 border border-primary/30 text-primary" : "border border-border text-muted-foreground hover:border-border/80"}`}>
                {m === "login" ? <LogIn size={12} /> : <UserPlus size={12} />}
                {m === "login" ? "Login" : "Sign Up"}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Operator email" className="w-full bg-muted/30 border border-border rounded px-3 py-2.5 text-sm font-body focus:outline-none focus:border-primary/50 placeholder:font-mono placeholder:text-xs placeholder:text-muted-foreground" />
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Access code" onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              className="w-full bg-muted/30 border border-border rounded px-3 py-2.5 text-sm font-body focus:outline-none focus:border-primary/50 placeholder:font-mono placeholder:text-xs placeholder:text-muted-foreground"
            />
            {error && <p className="text-xs font-mono text-destructive">{error}</p>}
            {message && <p className="text-xs font-mono text-green-400">{message}</p>}
            <button onClick={handleSubmit} disabled={loading || !email || !password} className="w-full py-2.5 bg-primary/10 border border-primary/30 text-primary rounded font-mono text-sm hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2">
              {loading ? <Loader2 size={14} className="animate-spin" /> : null}
              {mode === "login" ? "ACCESS VANTARA.EXE" : "INITIALIZE PROFILE"}
            </button>
          </div>

          <p className="text-[10px] font-mono text-muted-foreground text-center mt-4">
            MAVIS-PRIME systems ready // CODEXOS v21.1
          </p>
        </HudCard>
      </motion.div>
    </div>
  );
}

// ─── SettingsPage ──────────────────────────────────────────
export function SettingsPage() {
  const { profile, updateProfile } = useAppData();
  const [saved, setSaved] = useState(false);
  const [localProfile, setLocalProfile] = useState({
    inscribed_name: profile.inscribed_name,
    arc_story: profile.arc_story,
    current_form: profile.current_form,
    current_bpm: profile.current_bpm,
  });

  const handleSave = async () => {
    await updateProfile(localProfile);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const toggleNotification = async (key: string) => {
    const updated = {
      notification_settings: {
        ...profile.notification_settings,
        [key]: !profile.notification_settings[key as keyof typeof profile.notification_settings],
      },
    };
    await updateProfile(updated);
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <PageHeader title="Settings" subtitle="VANTARA.EXE system configuration" icon={<Settings size={18} />} />

      {/* Identity settings */}
      <HudCard>
        <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
          <Crown size={10} className="text-primary" /> Operator Identity
        </h3>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-mono text-muted-foreground uppercase mb-1 block">Inscribed Name</label>
            <input value={localProfile.inscribed_name} onChange={(e) => setLocalProfile((p) => ({ ...p, inscribed_name: e.target.value }))} className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary/40" />
          </div>
          <div>
            <label className="text-[10px] font-mono text-muted-foreground uppercase mb-1 block">Arc Story</label>
            <input value={localProfile.arc_story} onChange={(e) => setLocalProfile((p) => ({ ...p, arc_story: e.target.value }))} className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary/40" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-mono text-muted-foreground uppercase mb-1 block">Current Form</label>
              <input value={localProfile.current_form} onChange={(e) => setLocalProfile((p) => ({ ...p, current_form: e.target.value }))} className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-mono text-muted-foreground uppercase mb-1 block">Current BPM</label>
              <input type="number" value={localProfile.current_bpm} onChange={(e) => setLocalProfile((p) => ({ ...p, current_bpm: Number(e.target.value) }))} className="w-full bg-muted/30 border border-border rounded px-3 py-1.5 text-sm focus:outline-none" />
            </div>
          </div>
          <button onClick={handleSave} className="px-4 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 transition-all">
            {saved ? "✓ Saved" : "Save Changes"}
          </button>
        </div>
      </HudCard>

      {/* Notifications */}
      <HudCard>
        <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
          <Bell size={10} className="text-primary" /> Notifications
        </h3>
        <div className="space-y-3">
          {Object.entries(profile.notification_settings).map(([key, val]) => (
            <div key={key} className="flex items-center justify-between">
              <span className="text-xs font-mono capitalize">{key.replace(/([A-Z])/g, " $1").trim()}</span>
              <button onClick={() => toggleNotification(key)} className={`w-10 h-5 rounded-full transition-all relative ${val ? "bg-primary/30" : "bg-muted"}`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${val ? "left-5 bg-primary" : "left-0.5 bg-muted-foreground"}`} />
              </button>
            </div>
          ))}
        </div>
      </HudCard>

      {/* Theme */}
      <HudCard>
        <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
          <Sun size={10} className="text-primary" /> Appearance
        </h3>
        <ThemeToggle />
      </HudCard>

      {/* System info */}
      <HudCard className="border-primary/10">
        <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
          <Shield size={10} className="text-primary" /> System
        </h3>
        <div className="space-y-1">
          {[
            ["Platform", "VANTARA.EXE (Lovable)"],
            ["Framework", "MAVIS-PRIME v21.1"],
            ["Database", "Supabase / PostgreSQL"],
            ["AI Node", "ARCHITECTURE (Claude)"],
            ["Build", "CODEXOS Integration"],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between text-xs">
              <span className="font-mono text-muted-foreground">{k}</span>
              <span className="font-mono text-foreground/80">{v}</span>
            </div>
          ))}
        </div>
      </HudCard>
    </div>
  );
}

// ─── Index (re-export Dashboard) ──────────────────────────
export { default as IndexPage } from "./Dashboard";

// ─── NotFound ──────────────────────────────────────────────
export function NotFound() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
      <p className="font-display text-4xl font-bold text-muted-foreground/30">404</p>
      <p className="text-xs font-mono text-muted-foreground">Route not found in CODEXOS map</p>
      <a href="/" className="text-xs font-mono text-primary hover:underline">← Return to Dashboard</a>
    </div>
  );
}
