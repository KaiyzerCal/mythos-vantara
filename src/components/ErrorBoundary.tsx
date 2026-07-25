import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import * as Sentry from "@sentry/react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /** Label shown in Sentry to identify which boundary caught the error (e.g. "app-root", "route:chat"). */
  boundary?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught render error:", error, info.componentStack);
    Sentry.captureException(error, {
      tags: { boundary: this.props.boundary ?? "unlabeled" },
      contexts: { react: { componentStack: info.componentStack } },
    });
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center min-h-[300px] gap-3 p-8 text-center">
          <AlertTriangle size={32} className="text-amber-400" />
          <p className="text-sm font-medium text-foreground">Something went wrong loading this section.</p>
          {this.state.error?.message && (
            <p className="text-xs text-muted-foreground font-mono max-w-md truncate">
              {this.state.error.message}
            </p>
          )}
          <div className="flex gap-3 mt-2">
            <button
              onClick={this.reset}
              className="text-xs text-primary underline underline-offset-2 hover:opacity-80"
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="text-xs text-muted-foreground underline underline-offset-2 hover:opacity-80"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

