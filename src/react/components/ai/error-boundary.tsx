import * as React from "react";

export interface AIErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode | ((error: Error, reset: () => void) => React.ReactNode);
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  errorMessage?: string;
}

interface AIErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class AIErrorBoundary extends React.Component<
  AIErrorBoundaryProps,
  AIErrorBoundaryState
> {
  override state: AIErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): AIErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error("[AIErrorBoundary] Caught error:", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  reset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  override render(): React.ReactNode {
    const { hasError, error } = this.state;
    if (!hasError || !error) return this.props.children;

    const { fallback, errorMessage } = this.props;

    if (fallback) {
      if (typeof fallback === "function") return fallback(error, this.reset);
      return fallback;
    }

    return (
      <div
        className="border border-[var(--destructive)]/20 bg-[var(--destructive)]/5 rounded-2xl p-6"
        role="alert"
      >
        <div className="flex items-start gap-4">
          <div className="size-10 rounded-full bg-[var(--destructive)]/10 flex items-center justify-center flex-shrink-0">
            <svg
              className="size-5 text-[var(--destructive)]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-[var(--foreground)]">
              {errorMessage ?? "An error occurred in the AI component"}
            </h3>

            <p className="mt-1.5 text-sm text-[var(--destructive)] leading-relaxed">
              {error.message}
            </p>

            <button
              type="button"
              onClick={this.reset}
              className="mt-4 px-5 py-2.5 text-sm font-medium bg-[var(--destructive)] text-[var(--destructive-foreground)] hover:opacity-90 active:scale-[0.98] rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export function useAIErrorHandler(): {
  error: Error | null;
  handleError: (error: Error) => void;
  clearError: () => void;
  hasError: boolean;
} {
  const [error, setError] = React.useState<Error | null>(null);

  const handleError = React.useCallback((err: Error) => {
    console.error("[useAIErrorHandler] Error:", err);
    setError(err);
  }, []);

  const clearError = React.useCallback(() => {
    setError(null);
  }, []);

  return { error, handleError, clearError, hasError: error !== null };
}
