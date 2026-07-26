import { AlertTriangle, RefreshCw } from "lucide-react";

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
      <div className="w-12 h-12 rounded-lg bg-destructive/10 border border-destructive/30 flex items-center justify-center text-destructive">
        <AlertTriangle size={20} />
      </div>
      <div>
        <p className="text-sm font-mono text-foreground">{title}</p>
        {message && (
          <p className="text-xs font-mono text-muted-foreground mt-1 max-w-md">
            {message}
          </p>
        )}
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        >
          <RefreshCw size={12} />
          Retry
        </button>
      )}
    </div>
  );
}
