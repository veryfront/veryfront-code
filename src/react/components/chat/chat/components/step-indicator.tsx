import * as React from "react";
import { cn } from "../../theme.ts";
import { CheckCircleIcon } from "../../icons/index.ts";

/** Props accepted by step indicator. */
export interface StepIndicatorProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "className"> {
  stepIndex: number;
  isComplete: boolean;
  className?: string;
  /** Override the complete/pending status glyph. */
  icon?: React.ReactNode;
}

/** Render step indicator. */
export function StepIndicator({
  stepIndex,
  isComplete,
  className,
  icon,
  ...props
}: StepIndicatorProps): React.ReactElement {
  return (
    <div
      {...props}
      className={cn(
        "flex items-center gap-3 py-3 text-xs text-[var(--faint)]",
        className,
      )}
    >
      <div className="flex-1 h-px bg-[var(--edge)]" />
      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-[var(--outline-border)] bg-transparent">
        {icon ?? (isComplete
          ? <CheckCircleIcon className="size-3.5 text-[var(--success)]" />
          : <span className="size-2 rounded-full bg-[var(--faint)] animate-pulse" />)}
        <span className="font-medium">Step {stepIndex + 1}</span>
      </div>
      <div className="flex-1 h-px bg-[var(--edge)]" />
    </div>
  );
}
