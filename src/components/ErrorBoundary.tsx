import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
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
          <button
            onClick={this.reset}
            className="mt-2 text-xs text-primary underline underline-offset-2 hover:opacity-80"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
