import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard, User, Target, CheckSquare, Users, Flame,
  Zap, Sparkles, Package, BookOpen, BookLock, ShoppingBag,
  Medal, TowerControl, Activity, Settings, ChevronRight,
  LogOut, Cpu, Shield, HeartPulse, Inbox, Network,
  UserCheck, BarChart2, Repeat2, Heart, DollarSign, CalendarClock,
  Crosshair, GraduationCap, Clock, Video, BookMarked,
  TrendingUp, Mail, Webhook, KeyRound, Archive,
  Clapperboard, Globe, LayoutTemplate, Workflow, Kanban, UserSquare2, Palette, Wand2,
  Users2, LayoutGrid, Trophy, Gauge, Bell, CreditCard, Upload,
  BrainCircuit, Brain, SlidersHorizontal, Phone, MessageSquare, Key, Users2 as UserGroup, Shield as ShieldIcon, PhoneCall,
  PanelLeftClose,
} from "lucide-react";
import { useState, useContext } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { AppDataContext } from "@/contexts/AppDataContext";
import { RANK_COLORS } from "@/types/rpg";
import { NotificationBell } from "@/components/NotificationBell";

const PRIMARY_NAV = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/character", icon: User, label: "Character" },
  { to: "/mavis", icon: Cpu, label: "MAVIS" },
  { to: "/mavis-ui", icon: Sparkles, label: "MavisUI" },
  { to: "/agents", icon: BrainCircuit, label: "Agent Dashboard" },
  { to: "/intelligence", icon: Brain, label: "Intelligence" },
  { to: "/phone", icon: Phone, label: "AI Phone Calls" },
  { to: "/receptionist", icon: PhoneCall, label: "AI Receptionist" },
  { to: "/sms", icon: MessageSquare, label: "SMS & WhatsApp" },
  { to: "/inbox", icon: Inbox, label: "Inbox" },
  { to: "/quests", icon: Target, label: "Quests" },
  { to: "/councils", icon: Users, label: "Councils" },
];

const SECONDARY_NAV = [
  { to: "/knowledge", icon: Network, label: "Knowledge" },
  { to: "/forms", icon: Flame, label: "Forms" },
  { to: "/energy", icon: Zap, label: "Energy" },
  { to: "/skills", icon: Sparkles, label: "Skills" },
  { to: "/inventory", icon: Package, label: "Inventory" },
  { to: "/domain", icon: Shield, label: "Domain Effects" },
  { to: "/journal", icon: BookOpen, label: "Journal" },
  { to: "/vault", icon: BookLock, label: "Vault Codex" },
];

const INTEL_NAV = [
  { to: "/contacts", icon: UserCheck, label: "Contacts" },
  { to: "/analytics", icon: BarChart2, label: "Analytics" },
  { to: "/repurpose", icon: Repeat2, label: "Repurpose" },
  { to: "/health", icon: Heart, label: "Health" },
  { to: "/finance", icon: DollarSign, label: "Finance" },
  { to: "/scheduler", icon: CalendarClock, label: "Scheduler" },
  { to: "/goals", icon: Crosshair, label: "Goals" },
  { to: "/memory", icon: Brain, label: "MAVIS Memory" },
  { to: "/playbooks", icon: BookOpen, label: "Playbooks" },
  { to: "/so-templates", icon: BookMarked, label: "SO Templates" },
  { to: "/study", icon: GraduationCap, label: "Study" },
  { to: "/time", icon: Clock, label: "Time Tracker" },
  { to: "/meetings", icon: Video, label: "Meetings" },
  { to: "/highlights", icon: BookMarked, label: "Highlights" },
  { to: "/social-analytics", icon: TrendingUp, label: "Social Analytics" },
  { to: "/email", icon: Mail, label: "Email" },
  { to: "/leads", icon: UserGroup, label: "Lead Generation" },
  { to: "/competitors", icon: ShieldIcon, label: "Competitor Intel" },
  { to: "/api-keys", icon: Key, label: "API Keys" },
  { to: "/webhooks", icon: Webhook, label: "Webhooks" },
  { to: "/integrations", icon: KeyRound, label: "Integrations" },
  { to: "/export", icon: Archive, label: "Export Data" },
];

const CREATOR_NAV = [
  { to: "/creator", icon: Clapperboard, label: "Video Editor" },
  { to: "/avatar-studio", icon: UserSquare2, label: "Avatar Studio" },
  { to: "/production-intel", icon: Wand2, label: "Production Intel" },
  { to: "/websites", icon: Globe, label: "Website Builder" },
  { to: "/widgets", icon: LayoutTemplate, label: "Widgets" },
  { to: "/design-studio", icon: Palette, label: "Design Studio" },
  { to: "/workflows", icon: Workflow, label: "Workflows" },
  { to: "/plans", icon: Kanban, label: "Plan Board" },
];

const UTILITY_NAV = [
  { to: "/allies", icon: Users2, label: "Allies" },
  { to: "/council-board", icon: LayoutGrid, label: "Council Board" },
  { to: "/achievements", icon: Trophy, label: "Achievements" },
  { to: "/forecast", icon: Gauge, label: "Forecast" },
  { to: "/notifications", icon: Bell, label: "Notifications" },
  { to: "/personas", icon: HeartPulse, label: "Personas" },
  { to: "/persona-relationships", icon: HeartPulse, label: "Relationships" },
  { to: "/rankings", icon: Medal, label: "Rankings" },
  { to: "/tower", icon: TowerControl, label: "Tower" },
  { to: "/scouter", icon: Shield, label: "Scouter" },
  { to: "/bpm", icon: Activity, label: "BPM" },
  { to: "/store", icon: ShoppingBag, label: "Store" },
  { to: "/activity", icon: CheckSquare, label: "Activity Log" },
  { to: "/stripe", icon: CreditCard, label: "Stripe" },
  { to: "/import", icon: Upload, label: "Import Data" },
  { to: "/system-settings", icon: SlidersHorizontal, label: "System Settings" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

function NavItem({ to, icon: Icon, label }: { to: string; icon: any; label: string }) {
  const location = useLocation();
  const isActive = location.pathname === to;

  return (
    <NavLink
      to={to}
      className={`flex items-center gap-3 px-3 py-2 rounded text-sm font-medium transition-all ${
        isActive
          ? "bg-primary/10 text-primary border border-primary/20 glow-subtle"
          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground border border-transparent"
      }`}
    >
      <Icon size={16} className={`shrink-0 ${isActive ? "text-primary" : ""}`} />
      <span className="whitespace-nowrap font-body">{label}</span>
    </NavLink>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <p className="px-3 pt-3 pb-1 text-xs font-mono text-muted-foreground tracking-widest uppercase">
      {label}
    </p>
  );
}

export default function AppSidebar() {
  const [open, setOpen] = useState(true);
  const { signOut } = useAuth();
  const appData = useContext(AppDataContext);
  if (!appData) return null;
  const { profile } = appData;

  const rankColor = RANK_COLORS[profile.rank as keyof typeof RANK_COLORS] ?? "#666";

  return (
    <>
      {/* Floating open button — only visible when sidebar is hidden */}
      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.18 }}
            onClick={() => setOpen(true)}
            className="fixed top-4 left-4 z-50 w-8 h-8 rounded border border-border bg-sidebar shadow-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors"
            title="Open navigation"
          >
            <ChevronRight size={14} />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Sidebar panel */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.aside
            key="sidebar"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 224, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="h-full flex flex-col border-r border-border bg-sidebar overflow-hidden shrink-0"
          >
            {/* Logo / Identity */}
            <div className="p-3 flex items-center gap-2.5 border-b border-border min-h-[60px]">
              <div className="w-8 h-8 rounded bg-primary/15 border border-primary/30 flex items-center justify-center glow-subtle shrink-0">
                <span className="font-display text-primary text-xs font-bold">V</span>
              </div>
              <div className="overflow-hidden flex-1">
                <h1 className="font-display text-primary text-xs font-bold tracking-widest text-glow-gold whitespace-nowrap">
                  VANTARA.EXE
                </h1>
                <p className="text-muted-foreground text-xs font-mono whitespace-nowrap">
                  MAVIS-PRIME // CODEXOS
                </p>
              </div>
              <NotificationBell />
            </div>

            {/* Operator status strip */}
            <div className="px-3 py-2 border-b border-border/50 bg-muted/30">
              <p className="text-xs font-mono text-muted-foreground">OPERATOR</p>
              <p className="text-xs font-display truncate" style={{ color: rankColor }}>
                {profile.inscribed_name}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-xs font-mono" style={{ color: rankColor }}>
                  LV.{profile.level}
                </span>
                <span className="text-xs font-mono text-muted-foreground">
                  [{profile.rank}]
                </span>
                <span className="text-xs font-mono text-muted-foreground ml-auto">
                  {profile.full_cowl_sync}% SYNC
                </span>
              </div>
              <div className="mt-1 h-0.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${Math.round((profile.xp / profile.xp_to_next_level) * 100)}%` }}
                />
              </div>
            </div>

            {/* Nav */}
            <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto scrollbar-thin">
              <SectionLabel label="Core" />
              {PRIMARY_NAV.map((item) => <NavItem key={item.to} {...item} />)}

              <SectionLabel label="Systems" />
              {SECONDARY_NAV.map((item) => <NavItem key={item.to} {...item} />)}

              <SectionLabel label="Intel" />
              {INTEL_NAV.map((item) => <NavItem key={item.to} {...item} />)}

              <SectionLabel label="Creator" />
              {CREATOR_NAV.map((item) => <NavItem key={item.to} {...item} />)}

              <SectionLabel label="Utilities" />
              {UTILITY_NAV.map((item) => <NavItem key={item.to} {...item} />)}
            </nav>

            {/* Cmd+K hint */}
            <button
              onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }))}
              className="mx-2 mb-1 px-3 py-1.5 rounded border border-border/50 text-muted-foreground hover:text-primary hover:border-primary/30 transition-all flex items-center justify-between"
            >
              <span className="text-xs font-mono">Search / Navigate</span>
              <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">⌘K</span>
            </button>

            {/* Sign out */}
            <button
              onClick={signOut}
              className="mx-2 mb-1 px-3 py-2 rounded text-sm font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex items-center gap-3 border border-transparent"
            >
              <LogOut size={16} className="shrink-0" />
              <span className="whitespace-nowrap font-body text-xs">Sign Out</span>
            </button>

          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
