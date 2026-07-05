/**
 * ErrorBanner — Inline error display with optional retry action.
 *
 * @module react/components/chat/composition/error-banner
 */

import * as React from "react";
import { cn } from "../../theme.ts";
import { RefreshCwIcon } from "../../icons/index.ts";
import { Alert, AlertAction, AlertContent } from "../../ui/alert.tsx";
import { Button } from "../../ui/button.tsx";

/** Props accepted by error banner. */
export interface ErrorBannerProps {
  error: Error;
  onRetry?: () => void;
  className?: string;
  /** Override the retry glyph. Defaults to the built-in refresh icon. */
  icon?: React.ReactNode;
  /** Label for the retry button. Defaults to "Retry". */
  retryLabel?: string;
}

/** Render error banner. */
export const ErrorBanner = React.forwardRef<HTMLDivElement, ErrorBannerProps>(
  function ErrorBanner(
    { error, onRetry, className, icon, retryLabel = "Retry" },
    ref,
  ) {
    return (
      <div ref={ref} className={cn("max-w-2xl mx-auto px-4 pb-3", className)}>
        <Alert variant="error">
          <AlertContent>{error.message}</AlertContent>
          {onRetry && (
            <AlertAction>
              <Button variant="link" size="sm" onClick={onRetry}>
                {icon ?? <RefreshCwIcon className="size-3.5" />}
                {retryLabel}
              </Button>
            </AlertAction>
          )}
        </Alert>
      </div>
    );
  },
);
ErrorBanner.displayName = "ErrorBanner";
