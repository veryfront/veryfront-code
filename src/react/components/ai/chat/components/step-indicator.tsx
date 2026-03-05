import * as React from "react";
import { cn } from "../../theme.ts";
import { CheckCircleIcon } from "../../icons/index.ts";

export interface StepIndicatorProps {
  stepIndex: number;
  isComplete: boolean;
  className?: string;
}

export function StepIndicator({
  stepIndex,
  isComplete,
  className,
}: StepIndicatorProps): React.ReactElement {
  return (
    <div
      className={cn(
        "flex items-center gap-3 py-3 text-xs text-[var(--input-placeholder)]",
        className,
      )}
    >
      <div className="flex-1 h-px bg-[var(--border)]" />
      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--accent)]">
        {isComplete
          ? <CheckCircleIcon className="size-3.5 text-emerald-500" />
          : <span className="size-2 rounded-full bg-violet-500 animate-pulse" />}
        <span className="font-medium">Step {stepIndex + 1}</span>
      </div>
      <div className="flex-1 h-px bg-[var(--border)]" />
    </div>
  );
}
