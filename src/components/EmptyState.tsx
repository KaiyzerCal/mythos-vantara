import { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
      <div className="w-12 h-12 rounded-lg bg-muted/30 border border-border flex items-center justify-center text-muted-foreground">
        <Icon size={20} />
      </div>
      <div>
        <p className="text-sm font-mono text-muted-foreground">{title}</p>
        {description && <p className="text-xs font-mono text-muted-foreground/60 mt-1">{description}</p>}
      </div>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-1 px-3 py-1.5 text-xs font-mono rounded border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
