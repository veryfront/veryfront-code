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
    <div className={cn("flex items-center gap-3 py-3 text-xs text-neutral-400 dark:text-neutral-500", className)}>
      <div className="flex-1 h-px bg-neutral-200/60 dark:bg-neutral-700/60" />
      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-neutral-100/80 dark:bg-neutral-800/80">
        {isComplete
          ? <CheckCircleIcon className="size-3.5 text-emerald-500 dark:text-emerald-400" />
          : <span className="size-2 rounded-full bg-violet-500 animate-pulse" />}
        <span className="font-medium">Step {stepIndex + 1}</span>
      </div>
      <div className="flex-1 h-px bg-neutral-200/60 dark:bg-neutral-700/60" />
    </div>
  );
}
