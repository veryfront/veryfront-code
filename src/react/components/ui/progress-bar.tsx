/**
 * ProgressBar — ported 1:1 from Veryfront Studio. A determinate or
 * indeterminate progress track. The presentation helpers (clamp / accessible
 * name) are inlined; tokens remapped to veryfront's `[var(--token)]`
 * vocabulary. The `progress-indeterminate` keyframes + `.animate-progress-
 * indeterminate` utility ship via chat `theme.ts`. Private to the chat module.
 *
 * @module react/components/ui/progress-bar
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";

const MIN_PROGRESS = 0;
const MAX_PROGRESS = 100;
const DEFAULT_PROGRESS_LABEL = "Progress";

function clampProgressPercent(percent: number): number {
  if (!Number.isFinite(percent)) return MIN_PROGRESS;
  return Math.min(MAX_PROGRESS, Math.max(MIN_PROGRESS, percent));
}

function getProgressAccessibleName(
  ariaLabel?: string,
  ariaLabelledBy?: string,
): string | undefined {
  return ariaLabel ?? (ariaLabelledBy ? undefined : DEFAULT_PROGRESS_LABEL);
}

/** Props accepted by `<ProgressBar>`. */
export interface ProgressBarProps extends React.ComponentProps<"div"> {
  /** Completion percentage (0–100). */
  percent: number;
  /** Render an indeterminate looping bar instead of a fixed width. */
  indeterminate?: boolean;
}

/** Render a progress track. */
export function ProgressBar({
  percent,
  indeterminate = false,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ...props
}: ProgressBarProps): React.ReactElement {
  const clampedPercent = clampProgressPercent(percent);
  const accessibleName = getProgressAccessibleName(ariaLabel, ariaLabelledBy);

  return (
    <div
      {...props}
      className={cn(
        "w-full bg-[var(--accent)] rounded-full h-2.5 overflow-hidden",
        className,
      )}
      role="progressbar"
      aria-label={accessibleName}
      aria-labelledby={ariaLabelledBy}
      aria-valuemin={MIN_PROGRESS}
      aria-valuemax={MAX_PROGRESS}
      aria-valuenow={indeterminate ? undefined : clampedPercent}
    >
      {indeterminate
        ? (
          <div className="relative h-full w-full overflow-hidden">
            <div className="h-full w-[32%] rounded-full bg-[var(--primary)] animate-progress-indeterminate" />
          </div>
        )
        : (
          <div
            className="bg-[var(--primary)] h-2.5 rounded-full origin-left transition-all duration-1000 ease-out"
            style={{ width: `${clampedPercent}%` }}
          />
        )}
    </div>
  );
}
