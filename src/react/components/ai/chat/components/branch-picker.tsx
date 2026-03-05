import * as React from "react";
import { cn } from "../../theme.ts";

export interface BranchPickerProps {
  current: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

export function BranchPicker({
  current,
  total,
  onPrev,
  onNext,
}: BranchPickerProps): React.ReactElement | null {
  if (total <= 1) return null;

  return (
    <div className="inline-flex items-center gap-1 text-xs text-neutral-400 dark:text-neutral-500">
      <button
        type="button"
        onClick={onPrev}
        disabled={current <= 1}
        className={cn(
          "size-5 flex items-center justify-center rounded transition-colors",
          "hover:bg-neutral-100 dark:hover:bg-neutral-800",
          "disabled:opacity-30 disabled:cursor-not-allowed",
        )}
        aria-label="Previous variant"
      >
        <svg
          className="size-3"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <span className="tabular-nums min-w-[2ch] text-center">{current}/{total}</span>
      <button
        type="button"
        onClick={onNext}
        disabled={current >= total}
        className={cn(
          "size-5 flex items-center justify-center rounded transition-colors",
          "hover:bg-neutral-100 dark:hover:bg-neutral-800",
          "disabled:opacity-30 disabled:cursor-not-allowed",
        )}
        aria-label="Next variant"
      >
        <svg
          className="size-3"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>
  );
}
