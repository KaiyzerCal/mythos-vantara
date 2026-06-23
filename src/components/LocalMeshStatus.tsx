/**
 * LocalMeshStatus — Status chip for the sidebar showing compute mode.
 *
 * Shows one of three states:
 *   ⬡ LOCAL MESH — local Ollama is online and routing requests
 *   ☁ CLOUD      — standard MAVIS cloud mode (default)
 *   ○ OFFLINE    — no connectivity, serving from cache
 *
 * Clicking opens the mesh config panel (IntegrationsPage anchor).
 */

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Cloud, Wifi, WifiOff } from "lucide-react";
import { checkLocalMeshHealth, type LocalMeshStatus } from "@/mavis/localMesh";
import { getMeshStatus } from "@/mavis/commandMesh";
import { isOffline } from "@/mavis/offlineMode";

interface LocalMeshStatusProps {
  collapsed?: boolean;
  onClick?: () => void;
}

export function LocalMeshStatusChip({ collapsed = false, onClick }: LocalMeshStatusProps) {
  const [status, setStatus] = useState<LocalMeshStatus>("checking");
  const [localActive, setLocalActive] = useState(false);
  const [offline, setOffline] = useState(false);

  const refresh = useCallback(async () => {
    setOffline(isOffline());
    const health = await checkLocalMeshHealth();
    setStatus(health);
    const mesh = getMeshStatus();
    setLocalActive(mesh.localActive);
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30_000);
    const onOnline  = () => { setOffline(false); refresh(); };
    const onOffline = () => setOffline(true);
    window.addEventListener("online",  onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      clearInterval(interval);
      window.removeEventListener("online",  onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [refresh]);

  let icon: React.ReactNode;
  let label: string;
  let colorClass: string;
  let dotClass: string;

  if (offline) {
    icon = <WifiOff size={10} />;
    label = "OFFLINE";
    colorClass = "text-amber-400 border-amber-400/30";
    dotClass = "bg-amber-400";
  } else if (status === "online" && localActive) {
    icon = (
      // Hexagon SVG (matches LocalMeshOverlay's visual language)
      <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
        <polygon points="5,0.5 9,2.75 9,7.25 5,9.5 1,7.25 1,2.75" strokeWidth={0} />
      </svg>
    );
    label = "LOCAL MESH";
    colorClass = "text-primary border-primary/30";
    dotClass = "bg-primary animate-pulse";
  } else {
    icon = <Cloud size={10} />;
    label = "CLOUD";
    colorClass = "text-muted-foreground border-border";
    dotClass = "bg-green-400";
  }

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2 py-1 rounded border ${colorClass} text-xs font-mono transition-colors hover:opacity-80`}
      title={
        offline ? "Offline — running on cached data"
        : status === "online" ? "Local Mesh active — click to configure"
        : "Cloud mode — click to configure local mesh"
      }
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass} shrink-0`} />
      {icon}
      <AnimatePresence mode="wait">
        {!collapsed && (
          <motion.span
            key="label"
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "auto" }}
            exit={{ opacity: 0, width: 0 }}
            className="overflow-hidden whitespace-nowrap tracking-widest"
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}

export { LocalMeshStatus };
