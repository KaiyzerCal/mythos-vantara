// MAVIS Personal Agents — internal operator-only page
// BOUND_OPERATORS: Calvin & Caliyah only
import { useState } from "react";
import { motion } from "framer-motion";
import { Bot, Mail, Share2, Cpu } from "lucide-react";
import AgentWidget from "@/components/AgentWidget";
import { cn } from "@/lib/utils";

const AGENTS = [
  {
    id:      "google" as const,
    label:   "Google Agent",
    icon:    Mail,
    color:   "#4285f4",
    desc:    "Gmail · Calendar · Drive · Docs · Sheets · Tasks · Contacts",
  },
  {
    id:      "social" as const,
    label:   "Social Agent",
    icon:    Share2,
    color:   "#e1306c",
    desc:    "Instagram · X / Twitter · LinkedIn · Facebook",
  },
  {
    id:      "general" as const,
    label:   "General Agent",
    icon:    Cpu,
    color:   "#00c8ff",
    desc:    "Research · Drafting · Planning · Analysis · Brainstorming",
  },
];

export default function MyAgents() {
  const [active, setActive] = useState<"google" | "social" | "general">("google");
  const agent = AGENTS.find((a) => a.id === active)!;

  return (
    <div className="flex flex-col h-full bg-[#060810] text-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/8 shrink-0">
        <div className="flex items-center gap-3">
          <Bot size={18} className="text-cyan-400" />
          <div>
            <h1 className="text-[15px] font-semibold">My Agents</h1>
            <p className="text-[10px] font-mono text-white/30">Personal AI agents · Operator access only</p>
          </div>
        </div>
      </div>

      {/* Tab strip */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-white/5 shrink-0">
        {AGENTS.map((a) => {
          const Icon = a.icon;
          const isActive = a.id === active;
          return (
            <button
              key={a.id}
              onClick={() => setActive(a.id)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-mono transition-all",
                isActive
                  ? "text-white/90 bg-white/8"
                  : "text-white/35 hover:text-white/60 hover:bg-white/5"
              )}
            >
              <Icon size={12} style={isActive ? { color: a.color } : {}} />
              {a.label}
            </button>
          );
        })}

        <div className="ml-auto text-[9px] font-mono text-white/20">{agent.desc}</div>
      </div>

      {/* Widget */}
      <div className="flex-1 overflow-hidden p-4">
        <motion.div
          key={active}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="h-full"
        >
          <AgentWidget agentType={active} className="h-full" />
        </motion.div>
      </div>
    </div>
  );
}
