
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
  constructor(props: AIErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): AIErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[AIErrorBoundary] Caught error:", error, errorInfo);

    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  override render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        if (typeof this.props.fallback === "function") {
          return this.props.fallback(this.state.error, this.reset);
        }
        return this.props.fallback;
      }

      return (
        <div
          className="border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 rounded-2xl p-6"
          role="alert"
        >
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center flex-shrink-0">
              <svg
                className="w-5 h-5 text-red-600 dark:text-red-400"
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
              <h3 className="text-base font-semibold text-red-900 dark:text-red-100">
                {this.props.errorMessage || "An error occurred in the AI component"}
              </h3>

              <p className="mt-1.5 text-sm text-red-700 dark:text-red-300 leading-relaxed">
                {this.state.error.message}
              </p>

              <button
                type="button"
                onClick={this.reset}
                className="mt-4 px-5 py-2.5 text-sm font-medium text-white bg-red-500 hover:bg-red-600 active:scale-[0.98] rounded-full transition-all"
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function useAIErrorHandler() {
  const [error, setError] = React.useState<Error | null>(null);

  const handleError = React.useCallback((error: Error) => {
    console.error("[useAIErrorHandler] Error:", error);
    setError(error);
  }, []);

  const clearError = React.useCallback(() => {
    setError(null);
  }, []);

  return {
    error,
    handleError,
    clearError,
    hasError: error !== null,
  };
}
