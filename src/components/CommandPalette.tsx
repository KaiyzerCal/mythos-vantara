import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty,
  CommandGroup, CommandItem, CommandShortcut, CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutDashboard, User, Target, Cpu, Brain, BrainCircuit,
  Crosshair, Sparkles, BookOpen, BookLock, Package, Heart,
  DollarSign, Clock, Network, BarChart2, Users, Inbox,
  Palette, Globe, Workflow, Video, GraduationCap, Zap,
  UserCheck, Phone, MessageSquare, Mail, TrendingUp, Shield,
  Clapperboard, UserSquare2, Kanban, Trophy, Settings,
  CalendarClock, Flame, ShoppingBag, Medal, Activity,
} from "lucide-react";

const PAGES = [
  { label: "Dashboard", to: "/", icon: LayoutDashboard, group: "Core" },
  { label: "Character", to: "/character", icon: User, group: "Core" },
  { label: "MAVIS Chat", to: "/mavis", icon: Cpu, group: "Core" },
  { label: "Agent Dashboard", to: "/agents", icon: BrainCircuit, group: "Core" },
  { label: "Intelligence", to: "/intelligence", icon: Brain, group: "Core" },
  { label: "Inbox", to: "/inbox", icon: Inbox, group: "Core" },
  { label: "Quests", to: "/quests", icon: Target, group: "Systems" },
  { label: "Goals", to: "/goals", icon: Crosshair, group: "Systems" },
  { label: "Skills", to: "/skills", icon: Sparkles, group: "Systems" },
  { label: "Councils", to: "/councils", icon: Users, group: "Systems" },
  { label: "Energy", to: "/energy", icon: Zap, group: "Systems" },
  { label: "Forms / Transformations", to: "/forms", icon: Flame, group: "Systems" },
  { label: "Knowledge Graph", to: "/knowledge", icon: Network, group: "Systems" },
  { label: "Inventory", to: "/inventory", icon: Package, group: "Systems" },
  { label: "Domain Effects", to: "/domain", icon: Shield, group: "Systems" },
  { label: "Journal", to: "/journal", icon: BookOpen, group: "Systems" },
  { label: "Vault Codex", to: "/vault", icon: BookLock, group: "Systems" },
  { label: "Health", to: "/health", icon: Heart, group: "Intel" },
  { label: "Finance", to: "/finance", icon: DollarSign, group: "Intel" },
  { label: "Contacts", to: "/contacts", icon: UserCheck, group: "Intel" },
  { label: "Analytics", to: "/analytics", icon: BarChart2, group: "Intel" },
  { label: "Social Analytics", to: "/social-analytics", icon: TrendingUp, group: "Intel" },
  { label: "Scheduler", to: "/scheduler", icon: CalendarClock, group: "Intel" },
  { label: "Time Tracker", to: "/time", icon: Clock, group: "Intel" },
  { label: "Meetings", to: "/meetings", icon: Video, group: "Intel" },
  { label: "Study", to: "/study", icon: GraduationCap, group: "Intel" },
  { label: "Email", to: "/email", icon: Mail, group: "Intel" },
  { label: "Phone Calls", to: "/phone", icon: Phone, group: "Intel" },
  { label: "SMS", to: "/sms", icon: MessageSquare, group: "Intel" },
  { label: "Lead Generation", to: "/leads", icon: UserCheck, group: "Intel" },
  { label: "Video Editor", to: "/creator", icon: Clapperboard, group: "Creator" },
  { label: "Avatar Studio", to: "/avatar-studio", icon: UserSquare2, group: "Creator" },
  { label: "Website Builder", to: "/websites", icon: Globe, group: "Creator" },
  { label: "Design Studio", to: "/design-studio", icon: Palette, group: "Creator" },
  { label: "Workflows", to: "/workflows", icon: Workflow, group: "Creator" },
  { label: "Plan Board", to: "/plans", icon: Kanban, group: "Creator" },
  { label: "Repurpose Content", to: "/repurpose", icon: Activity, group: "Creator" },
  { label: "Rankings", to: "/rankings", icon: Trophy, group: "Utilities" },
  { label: "Allies & Store", to: "/allies", icon: ShoppingBag, group: "Utilities" },
  { label: "Achievements", to: "/achievements", icon: Medal, group: "Utilities" },
  { label: "Settings", to: "/settings", icon: Settings, group: "Utilities" },
];

const GROUPS = ["Core", "Systems", "Intel", "Creator", "Utilities"];

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();

  const run = useCallback((to: string) => {
    navigate(to);
    onOpenChange(false);
  }, [navigate, onOpenChange]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Navigate to... (type a page name)" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {GROUPS.map((group, gi) => {
          const items = PAGES.filter(p => p.group === group);
          return (
            <div key={group}>
              {gi > 0 && <CommandSeparator />}
              <CommandGroup heading={group}>
                {items.map(page => (
                  <CommandItem
                    key={page.to}
                    value={page.label}
                    onSelect={() => run(page.to)}
                    className="cursor-pointer"
                  >
                    <page.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                    <span>{page.label}</span>
                    <CommandShortcut className="text-xs font-mono opacity-50">{page.to}</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            </div>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return { open, setOpen };
}
