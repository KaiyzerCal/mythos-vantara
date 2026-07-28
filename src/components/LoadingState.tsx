import { Loader2 } from "lucide-react";

interface LoadingStateProps {
  label?: string;
  size?: "sm" | "md" | "lg";
}

export function LoadingState({ label = "Loading…", size = "md" }: LoadingStateProps) {
  const iconSize = size === "sm" ? 14 : size === "lg" ? 24 : 18;
  const padY = size === "sm" ? "py-4" : size === "lg" ? "py-16" : "py-8";
  return (
    <div className={`flex flex-col items-center justify-center ${padY} text-center gap-2`}>
      <Loader2 size={iconSize} className="animate-spin text-primary" />
      <p className="text-xs font-mono text-muted-foreground">{label}</p>
    </div>
  );
}
