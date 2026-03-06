/**
 * ErrorBanner — Inline error display with optional retry action.
 *
 * @module ai/react/components/chat/composition/error-banner
 */

import * as React from "react";
import { cn } from "../../theme.ts";
import { RefreshCwIcon } from "../../icons/index.ts";

export interface ErrorBannerProps {
  error: Error;
  onRetry?: () => void;
  className?: string;
}

export const ErrorBanner = React.forwardRef<HTMLDivElement, ErrorBannerProps>(
  function ErrorBanner({ error, onRetry, className }, ref) {
    return (
      <div ref={ref} className={cn("max-w-2xl mx-auto px-4 pb-2", className)}>
        <div className="px-4 py-3 bg-red-50 rounded-2xl text-red-600 text-sm flex items-center justify-between gap-3 border border-red-100">
          <span>{error.message}</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-100 hover:bg-red-200 rounded-full transition-colors"
            >
              <RefreshCwIcon className="size-3" />
              Retry
            </button>
          )}
        </div>
      </div>
    );
  },
);
ErrorBanner.displayName = "ErrorBanner";
