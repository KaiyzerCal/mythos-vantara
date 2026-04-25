import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard, User, Target, CheckSquare, Users, Flame,
  Zap, Sparkles, Package, BookOpen, BookLock, ShoppingBag,
  Medal, TowerControl, Activity, Settings, ChevronLeft, ChevronRight,
  LogOut, Cpu, Shield, HeartPulse,
} from "lucide-react";
import { useState, useContext } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { AppDataContext } from "@/contexts/AppDataContext";
import { RANK_COLORS } from "@/types/rpg";

const PRIMARY_NAV = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/character", icon: User, label: "Character" },
  { to: "/mavis", icon: Cpu, label: "MAVIS" },
  { to: "/quests", icon: Target, label: "Quests" },
  { to: "/councils", icon: Users, label: "Councils" },
];

const SECONDARY_NAV = [
  { to: "/forms", icon: Flame, label: "Forms" },
  { to: "/energy", icon: Zap, label: "Energy" },
  { to: "/skills", icon: Sparkles, label: "Skills" },
  { to: "/inventory", icon: Package, label: "Inventory" },
  { to: "/journal", icon: BookOpen, label: "Journal" },
  { to: "/vault", icon: BookLock, label: "Vault Codex" },
];

const UTILITY_NAV = [
  { to: "/personas", icon: HeartPulse, label: "Personas" },
  { to: "/persona-relationships", icon: HeartPulse, label: "Relationships" },
  { to: "/rankings", icon: Medal, label: "Rankings" },
  { to: "/tower", icon: TowerControl, label: "Tower" },
  { to: "/scouter", icon: Shield, label: "Scouter" },
  { to: "/bpm", icon: Activity, label: "BPM" },
  { to: "/store", icon: ShoppingBag, label: "Store" },
  { to: "/activity", icon: CheckSquare, label: "Activity Log" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

function NavItem({ to, icon: Icon, label, collapsed }: { to: string; icon: any; label: string; collapsed: boolean }) {
  const location = useLocation();
  const isActive = location.pathname === to;

  return (
    <NavLink
      to={to}
      className={`flex items-center gap-3 px-3 py-2 rounded text-sm font-medium transition-all group ${
        isActive
          ? "bg-primary/10 text-primary border border-primary/20 glow-subtle"
          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground border border-transparent"
      }`}
    >
      <Icon size={16} className={`shrink-0 ${isActive ? "text-primary" : ""}`} />
      <AnimatePresence>
        {!collapsed && (
          <motion.span
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "auto" }}
            exit={{ opacity: 0, width: 0 }}
            className="whitespace-nowrap font-body overflow-hidden"
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </NavLink>
  );
}

function SectionLabel({ label, collapsed }: { label: string; collapsed: boolean }) {
  if (collapsed) return <div className="h-px bg-border/50 mx-2 my-1" />;
  return (
    <p className="px-3 pt-3 pb-1 text-[9px] font-mono text-muted-foreground tracking-widest uppercase">
      {label}
    </p>
  );
}

export default function AppSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const { signOut } = useAuth();
  const appData = useContext(AppDataContext);
  if (!appData) return null;
  const { profile } = appData;

  const rankColor = RANK_COLORS[profile.rank as keyof typeof RANK_COLORS] ?? "#666";

  return (
    <motion.aside
      animate={{ width: collapsed ? 64 : 224 }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
      className="h-screen flex flex-col border-r border-border bg-sidebar sticky top-0 overflow-hidden shrink-0"
    >
      {/* Logo / Identity */}
      <div className="p-3 flex items-center gap-2.5 border-b border-border min-h-[60px]">
        <div className="w-8 h-8 rounded bg-primary/15 border border-primary/30 flex items-center justify-center glow-subtle shrink-0">
          <span className="font-display text-primary text-xs font-bold">V</span>
        </div>
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="overflow-hidden"
            >
              <h1 className="font-display text-primary text-xs font-bold tracking-widest text-glow-gold whitespace-nowrap">
                VANTARA.EXE
              </h1>
              <p className="text-muted-foreground text-[9px] font-mono whitespace-nowrap">
                MAVIS-PRIME // CODEXOS
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Operator status strip */}
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="px-3 py-2 border-b border-border/50 bg-muted/30"
          >
            <p className="text-[10px] font-mono text-muted-foreground">OPERATOR</p>
            <p className="text-xs font-display truncate" style={{ color: rankColor }}>
              {profile.inscribed_name}
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[9px] font-mono" style={{ color: rankColor }}>
                LV.{profile.level}
              </span>
              <span className="text-[9px] font-mono text-muted-foreground">
                [{profile.rank}]
              </span>
              <span className="text-[9px] font-mono text-muted-foreground ml-auto">
                {profile.full_cowl_sync}% SYNC
              </span>
            </div>
            {/* XP bar */}
            <div className="mt-1 h-0.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${Math.round((profile.xp / profile.xp_to_next_level) * 100)}%` }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Nav */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto scrollbar-thin">
        <SectionLabel label="Core" collapsed={collapsed} />
        {PRIMARY_NAV.map((item) => <NavItem key={item.to} {...item} collapsed={collapsed} />)}

        <SectionLabel label="Systems" collapsed={collapsed} />
        {SECONDARY_NAV.map((item) => <NavItem key={item.to} {...item} collapsed={collapsed} />)}

        <SectionLabel label="Utilities" collapsed={collapsed} />
        {UTILITY_NAV.map((item) => <NavItem key={item.to} {...item} collapsed={collapsed} />)}
      </nav>

      {/* Sign out */}
      <button
        onClick={signOut}
        className="mx-2 mb-1 px-3 py-2 rounded text-sm font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex items-center gap-3 border border-transparent"
      >
        <LogOut size={16} className="shrink-0" />
        <AnimatePresence>
          {!collapsed && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="whitespace-nowrap font-body text-xs">
              Sign Out
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="p-3 border-t border-border text-muted-foreground hover:text-primary transition-colors flex items-center justify-center"
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>
    </motion.aside>
  );
}
