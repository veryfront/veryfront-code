/**
 * Error Boundary for AI Components
 *
 * React error boundary specifically designed for AI component errors.
 */

import * as React from "react";

export interface AIErrorBoundaryProps {
  /** Children to wrap */
  children: React.ReactNode;

  /** Fallback UI when error occurs */
  fallback?: React.ReactNode | ((error: Error, reset: () => void) => React.ReactNode);

  /** Callback when error occurs */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;

  /** Custom error message */
  errorMessage?: string;
}

interface AIErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * AIErrorBoundary - Error boundary for AI components
 *
 * @example
 * ```tsx
 * import { AIErrorBoundary } from 'veryfront/ai/components';
 *
 * <AIErrorBoundary
 *   fallback={(error, reset) => (
 *     <div>
 *       <p>Error: {error.message}</p>
 *       <button onClick={reset}>Try Again</button>
 *     </div>
 *   )}
 * >
 *   <Chat {...chat} />
 * </AIErrorBoundary>
 * ```
 */
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
    // Log error
    console.error("[AIErrorBoundary] Caught error:", error, errorInfo);

    // Call error callback
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  override render() {
    if (this.state.hasError && this.state.error) {
      // Custom fallback
      if (this.props.fallback) {
        if (typeof this.props.fallback === "function") {
          return this.props.fallback(this.state.error, this.reset);
        }
        return this.props.fallback;
      }

      // Default fallback UI
      return (
        <div
          className="border border-red-200 bg-red-50 dark:bg-red-900/20 rounded-lg p-6"
          role="alert"
        >
          <div className="flex items-start gap-3">
            <svg
              className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5"
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

            <div className="flex-1">
              <h3 className="text-sm font-semibold text-red-900 dark:text-red-100">
                {this.props.errorMessage || "An error occurred in the AI component"}
              </h3>

              <p className="mt-2 text-sm text-red-700 dark:text-red-300">
                {this.state.error.message}
              </p>

              <button
                type="button"
                onClick={this.reset}
                className="mt-4 px-4 py-2 text-sm font-medium text-red-900 dark:text-red-100 bg-red-100 dark:bg-red-900/40 hover:bg-red-200 dark:hover:bg-red-900/60 rounded-lg transition-colors"
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

/**
 * Hook version of error boundary
 */
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
