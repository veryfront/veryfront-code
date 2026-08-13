/**
 * ErrorBanner — Inline error display with optional retry action.
 *
 * @module react/components/chat/composition/error-banner
 */

import * as React from "react";
import { cn } from "../../theme.ts";
import { AlertTriangleIcon } from "../../../ui/icons/index.ts";
import { Alert, AlertAction, AlertContent, AlertIcon } from "../../../ui/alert.tsx";
import { Button } from "../../../ui/button.tsx";

/** Props accepted by error banner. */
export interface ErrorBannerProps {
  error: Error;
  onRetry?: () => void;
  className?: string;
  /**
   * Override the leading glyph. Defaults to the built-in warning triangle.
   *
   * Behavior change: this used to render inside the retry button. It now fills
   * the alert's leading icon slot, and the retry button is label-only. Move a
   * button glyph into `retryLabel` to keep it on the button.
   */
  icon?: React.ReactNode;
  /** Label for the retry button. Defaults to "Try again" (was "Retry"). */
  retryLabel?: string;

  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/**
 * Render error banner. Mirrors Studio's inline chat retry banner: an amber
 * `warning` alert with a leading triangle icon and a small filled "Try again"
 * button (not a low-emphasis error pill).
 */
export function ErrorBanner(
  { error, onRetry, className, icon, retryLabel = "Try again", ref }: ErrorBannerProps,
): React.ReactElement {
  return (
    <div ref={ref} className={cn("max-w-2xl mx-auto px-4 pb-3", className)}>
      <Alert variant="warning" role="alert" className="flex-wrap">
        <AlertIcon>{icon ?? <AlertTriangleIcon className="size-4" />}</AlertIcon>
        <AlertContent>{error.message}</AlertContent>
        {onRetry && (
          <AlertAction>
            {
              /* Studio's banner button is 24px tall — one step below the
                smallest `size` variant (32px), so the height is set here. */
            }
            <Button size="sm" className="h-6 px-2.5 text-sm" onClick={onRetry}>
              {retryLabel}
            </Button>
          </AlertAction>
        )}
      </Alert>
    </div>
  );
}
ErrorBanner.displayName = "ErrorBanner";
